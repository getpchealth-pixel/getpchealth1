-- GetPcHealth licensing rewrite.
--
-- Replaces the single-tier `p1_records` table (which had 0 rows) with two
-- products:
--   * Individual  - machine-bound, fixed duration, bought from inside the app.
--   * Credit pack - one transferable code holding N credits, bought on the web.
--                   Each redemption costs 1 credit and grants a fixed window on
--                   the redeeming machine.
--
-- Exactly one entitlement row per machine (`licenses.machine_id` is unique), so
-- the desktop client only ever has to reason about a single key.

-- ---------------------------------------------------------------------------
-- credit_batches: a purchased block of credits, addressed by one signed code.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_batches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  code_fingerprint text not null,
  credits_total integer not null check (credits_total > 0),
  credits_used integer not null default 0 check (credits_used >= 0),
  days_per_credit integer not null check (days_per_credit > 0),
  amount_paise integer not null check (amount_paise > 0),
  price_per_credit_paise integer not null check (price_per_credit_paise > 0),
  payment_link_id text not null unique,
  purchaser_machine_id text,
  created_at timestamptz not null default now(),
  -- Backstop for the optimistic (compare-and-swap) decrement in redeem-credit.js.
  -- Even if the CAS retry loop is exhausted this makes over-redemption impossible.
  constraint credit_batches_not_overspent check (credits_used <= credits_total)
);

comment on table public.credit_batches is
  'A purchased block of institutional credits. One row per payment; `code` is the transferable key the buyer distributes.';

-- ---------------------------------------------------------------------------
-- licenses: the machine-bound entitlement actually enforced by the app.
-- ---------------------------------------------------------------------------
create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null unique,
  plan text not null check (plan in ('individual', 'credit', 'manual')),
  access_key text not null,
  key_fingerprint text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  payment_link_id text,
  credit_batch_id uuid references public.credit_batches (id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.licenses is
  'One active entitlement per machine. Renewing extends `expires_at` in place rather than adding rows, so days are never wasted on a part-used window.';

-- ---------------------------------------------------------------------------
-- credit_redemptions: append-only audit trail of every credit spent.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_redemptions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.credit_batches (id) on delete cascade,
  machine_id text not null,
  license_id uuid references public.licenses (id) on delete set null,
  days_granted integer not null check (days_granted > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.credit_redemptions is
  'Append-only log of credit spends. Never decremented, so a batch can always be reconciled against its payment.';

create index if not exists licenses_expires_at_idx on public.licenses (expires_at desc);
create index if not exists licenses_plan_idx on public.licenses (plan);
create index if not exists credit_batches_created_at_idx on public.credit_batches (created_at desc);
create index if not exists credit_redemptions_batch_idx on public.credit_redemptions (batch_id);
create index if not exists credit_redemptions_machine_idx on public.credit_redemptions (machine_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
--
-- All three tables are read by the admin dashboard through the browser client,
-- so each needs a SELECT policy. Authorisation comes from `app_metadata.role`,
-- which is admin-only and server-set. `user_metadata` is deliberately NOT used:
-- users can edit their own `user_metadata`, which would make it self-service.
--
-- Writes only ever happen through the service-role client, which bypasses RLS,
-- so no INSERT/UPDATE/DELETE policies are granted to anon or authenticated.
-- ---------------------------------------------------------------------------
alter table public.licenses enable row level security;
alter table public.credit_batches enable row level security;
alter table public.credit_redemptions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['licenses', 'credit_batches', 'credit_redemptions']
  loop
    execute format('drop policy if exists "Admins can read %s" on public.%I', t, t);
    execute format(
      'create policy "Admins can read %s" on public.%I for select to authenticated
         using ((select (auth.jwt() -> ''app_metadata'' ->> ''role'')) = ''admin'')',
      t, t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Retire the old single-tier table. It is empty, so this is a clean drop.
-- Re-create it only if you need to audit historical ₹1 sales.
-- ---------------------------------------------------------------------------
drop table if exists public.p1_records;
