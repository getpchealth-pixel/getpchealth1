-- Buyer email on `purchases`, captured at checkout so the admin can deliver the
-- key to the right inbox while manual sending is the delivery method.
--
-- Additive to 20261001 and written to be re-runnable like its siblings.
alter table public.purchases
  add column if not exists email text;

comment on column public.purchases.email is
  'Email given at checkout. Not the delivery channel yet - the key is still shown on screen and the admin sends it manually from this list.';

create index if not exists purchases_email_idx
  on public.purchases (email) where email is not null;