-- Purchase history, complimentary credit codes, and credit top-ups.
--
-- Three additions, all additive to 20260930:
--
--   1. `purchases`  - a durable record of every payment, so purchase history
--                      survives the fact that `licenses` keeps only the *first*
--                      receipt per machine and renewals overwrite it in place.
--   2. Manual codes - the owner can mint a credit code by hand (a giveaway, a
--                      replacement, a reseller allocation). These carry no
--                      payment, so the money columns must tolerate 0.
--   3. Top-ups     - credits can be added to a code the customer already holds.
--                      That is only possible if the *database* is the balance
--                      authority, which means the signed code must no longer
--                      commit to a credit count (see redeem-credit.js).
--
-- The migration is written to be re-runnable and safe against existing rows.

-- ---------------------------------------------------------------------------
-- 1. credit_batches: support hand-issued packs and tracked top-ups
-- ---------------------------------------------------------------------------

-- A manual pack has no payment, so ₹0 must be storable. Both columns keep
-- their NOT NULL: 0 is meaningful ("complimentary"), NULL would be ambiguous.
alter table public.credit_batches
  drop constraint if exists credit_batches_amount_paise_check;
alter table public.credit_batches
  add constraint credit_batches_amount_paise_check check (amount_paise >= 0);

alter table public.credit_batches
  drop constraint if exists credit_batches_price_per_credit_paise_check;
alter table public.credit_batches
  add constraint credit_batches_price_per_credit_paise_check
  check (price_per_credit_paise >= 0 and price_per_credit_paise <= amount_paise);

-- A manual pack has no payment link. Uniqueness is kept (it is what makes
-- verify-payment idempotent); a unique index already permits many NULLs, so
-- dropping NOT NULL is all that is required.
alter table public.credit_batches
  alter column payment_link_id drop not null;

alter table public.credit_batches
  add column if not exists source text not null default 'payment';
alter table public.credit_batches
  add column if not exists credits_granted integer not null default 0;
alter table public.credit_batches
  add column if not exists created_by text;
alter table public.credit_batches
  add column if not exists note text;

alter table public.credit_batches
  drop constraint if exists credit_batches_source_check;
alter table public.credit_batches
  add constraint credit_batches_source_check check (source in ('payment', 'manual'));

-- A paid pack has granted 0 free credits. Invariant: you can never have handed
-- out more free credits than the pack contains in total.
alter table public.credit_batches
  drop constraint if exists credit_batches_credits_granted_check;
alter table public.credit_batches
  add constraint credit_batches_credits_granted_check
  check (credits_granted >= 0 and credits_granted <= credits_total);

create index if not exists credit_batches_source_idx on public.credit_batches (source);

comment on column public.credit_batches.source is
  'payment = bought through Razorpay. manual = issued by an admin, no payment.';
comment on column public.credit_batches.credits_granted is
  'Credits added by admins after issue. `credits_total - credits_granted` is what the customer actually paid for.';
comment on column public.credit_batches.created_by is
  'Email of the admin who issued a manual pack. NULL for purchased packs.';
comment on column public.credit_batches.note is
  'Free-text reason a human attached to a manual pack or a top-up.';

-- ---------------------------------------------------------------------------
-- 2. credit_topups: audit trail for credits added after issue
-- ---------------------------------------------------------------------------
create table if not exists public.credit_topups (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.credit_batches (id) on delete cascade,
  credits_added integer not null check (credits_added > 0),
  credits_total_after integer not null check (credits_total_after > 0),
  note text,
  created_by text not null,
  created_at timestamptz not null default now()
);

comment on table public.credit_topups is
  'Append-only log of credits granted after a code was issued. Written only by public.topup_credit_batch(), in the same transaction as the balance change.';

create index if not exists credit_topups_batch_idx on public.credit_topups (batch_id, created_at desc);
create index if not exists credit_topups_created_at_idx on public.credit_topups (created_at desc);

-- ---------------------------------------------------------------------------
-- 3. purchases: the purchase history list
-- ---------------------------------------------------------------------------

-- A row per payment, not per entitlement. This is what the dashboard lists.
-- Rows are created when the payment link is created, marked paid when the
-- money lands, and can be back-filled/refreshed from Razorpay at any time
-- (see api/p1/reconcile-purchases.js) - which is also how the individual
-- renewals that `licenses` discarded become visible.
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  payment_link_id text not null unique,
  reference_id text,
  kind text not null check (kind in ('individual', 'credits')),
  -- created = link issued, not yet paid. paid/failed/refunded are what
  -- Razorpay reports back for the link.
  status text not null default 'created'
    check (status in ('created', 'paid', 'failed', 'refunded')),
  amount_paise integer not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  days integer not null check (days > 0),
  credits integer not null default 0 check (credits >= 0),
  machine_id text,
  credit_batch_id uuid references public.credit_batches (id) on delete set null,
  license_id uuid references public.licenses (id) on delete set null,
  razorpay_payment_id text,
  -- true once Razorpay's own status for this link has been read back.
  synced boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A credit pack always has credits; an individual purchase never does.
  constraint purchases_shape_check check (
    (kind = 'credits' and credits > 0) or (kind = 'individual' and credits = 0)
  )
);

comment on table public.purchases is
  'Durable purchase history, one row per payment link. Survives the in-place renewal of `licenses`, which only remembers a machine''s first receipt.';

create index if not exists purchases_created_at_idx on public.purchases (created_at desc);
create index if not exists purchases_status_idx on public.purchases (status);
create index if not exists purchases_machine_id_idx on public.purchases (machine_id, created_at desc);
create index if not exists purchases_razorpay_payment_id_idx
  on public.purchases (razorpay_payment_id) where razorpay_payment_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Balance integrity
--
-- The credit code no longer commits to a credit count (that is what makes
-- top-ups possible), so the database is the only balance authority. These two
-- objects keep it an honest one: a balance can only grow through
-- topup_credit_batch(), which always writes an audit row in the same
-- transaction, and a direct UPDATE that skips the audit is rejected.
-- ---------------------------------------------------------------------------

-- Session flag the top-up function sets to authorise its own write. `set ... local`
-- scopes it to the current transaction, so it cannot leak to a later request.
create or replace function public.guard_credit_batches_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.credits_total is distinct from old.credits_total
     and coalesce(current_setting('gph.credit_total_writable', true), '') <> 'on' then
    raise exception
      'credit_batches.credits_total can only be changed by public.topup_credit_batch()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_credit_batches_total() is
  'Rejects credit_batches.credits_total updates that did not come from topup_credit_batch(), so credits_granted can never drift from credit_topups.';

drop trigger if exists credit_batches_total_guard on public.credit_batches;
create trigger credit_batches_total_guard
  before update of credits_total on public.credit_batches
  for each row execute function public.guard_credit_batches_total();

-- Adds credits to an existing pack and records the grant, atomically.
--
-- Takes `for update` rather than doing read-then-write in the API, so two
-- simultaneous top-ups cannot lose one another's increment, and the audit row
-- can never be written without the balance change it describes (or vice versa).
create or replace function public.topup_credit_batch(
  p_batch_id uuid,
  p_credits integer,
  p_admin_email text,
  p_note text default null
)
returns table (
  id uuid,
  code text,
  credits_total integer,
  credits_used integer,
  credits_granted integer,
  days_per_credit integer,
  amount_paise integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  if p_credits is null or p_credits <= 0 or p_credits > 100000 then
    raise exception 'credits must be between 1 and 100000' using errcode = '22023';
  end if;

  -- Qualified because `credits_total` is also an OUT parameter name, and
  -- plpgsql's default variable_conflict = error would reject the ambiguity.
  select b.credits_total into v_total
  from public.credit_batches b
  where b.id = p_batch_id
  for update;

  if not found then
    raise exception 'credit batch not found' using errcode = 'P0002';
  end if;

  perform set_config('gph.credit_total_writable', 'on', true);

  -- The alias is not decoration: `credits_total` and `credits_granted` are also
  -- OUT parameter names, so an unqualified reference in SET is ambiguous and
  -- the function would fail to execute.
  update public.credit_batches as b
     set credits_total = b.credits_total + p_credits,
         credits_granted = b.credits_granted + p_credits
   where b.id = p_batch_id;

  insert into public.credit_topups (batch_id, credits_added, credits_total_after, note, created_by)
  values (p_batch_id, p_credits, v_total + p_credits, p_note, coalesce(p_admin_email, 'unknown'));

  return query
  select b.id, b.code, b.credits_total, b.credits_used,
         b.credits_granted, b.days_per_credit, b.amount_paise
  from public.credit_batches b
  where b.id = p_batch_id;
end;
$$;

comment on function public.topup_credit_batch(uuid, integer, text, text) is
  'Adds complimentary credits to a code the customer already holds, with an audit row. The only permitted way to raise credit_batches.credits_total.';

-- Only the service role (i.e. our API handlers) may mint or top up. `public`
-- is revoked because EXECUTE is granted to PUBLIC by default on functions.
revoke execute on function public.topup_credit_batch(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.topup_credit_batch(uuid, integer, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Purchase totals
--
-- The dashboard header needs lifetime revenue, but summing a filtered set with
-- PostgREST means shipping every row to the browser to add up. This keeps the
-- arithmetic in the database.
-- ---------------------------------------------------------------------------
create or replace function public.purchase_summary()
returns table (
  total_count bigint,
  paid_count bigint,
  pending_count bigint,
  failed_count bigint,
  revenue_paise bigint,
  credits_sold bigint,
  days_sold bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*),
    count(*) filter (where status = 'paid'),
    count(*) filter (where status = 'created'),
    count(*) filter (where status in ('failed', 'refunded')),
    -- Only settled money counts as revenue; `refunded` is deliberately excluded
    -- rather than netted, so a refund cannot quietly inflate the figure.
    coalesce(sum(amount_paise) filter (where status = 'paid'), 0),
    coalesce(sum(credits) filter (where status = 'paid' and kind = 'credits'), 0),
    coalesce(sum(days) filter (where status = 'paid'), 0)
  from public.purchases;
$$;

comment on function public.purchase_summary() is
  'Lifetime purchase totals for the dashboard header. Counts every row; revenue counts only paid rows.';

revoke execute on function public.purchase_summary() from public, anon, authenticated;
grant execute on function public.purchase_summary() to service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS
--
-- New tables follow the same rule as the 20260930 tables: admins may read
-- through the browser client, and nobody but the service role may write.
-- ---------------------------------------------------------------------------
alter table public.purchases enable row level security;
alter table public.credit_topups enable row level security;

-- Wrapped in a subselect so it is evaluated once per query rather than once per
-- row, and marked STABLE so the planner can hoist it.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

comment on function public.is_admin() is
  'True when the caller''s JWT carries app_metadata.role = ''admin''. app_metadata is service-role only; user_metadata is user-editable and deliberately not used.';

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['purchases', 'credit_topups']
  loop
    execute format('drop policy if exists "Admins can read %s" on public.%I', t, t);
    execute format(
      'create policy "Admins can read %s" on public.%I for select to authenticated
         using ((select public.is_admin()))',
      t, t
    );
  end loop;
end
$$;

-- The 20260930 policies inline the JWT read. Point them at the same helper so
-- every table has one definition of "is an admin" to audit.
do $$
declare
  t text;
begin
  foreach t in array array['licenses', 'credit_batches', 'credit_redemptions']
  loop
    execute format('drop policy if exists "Admins can read %s" on public.%I', t, t);
    execute format(
      'create policy "Admins can read %s" on public.%I for select to authenticated
         using ((select public.is_admin()))',
      t, t
    );
  end loop;
end
$$;
