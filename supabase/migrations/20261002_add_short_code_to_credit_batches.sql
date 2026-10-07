-- Add short_code column for human-enterable institutional credit codes (<=16 alphanumeric chars)
-- Allows customers to manually type codes on different systems without copy-paste.

alter table public.credit_batches
  add column if not exists short_code text;

-- Unique index for short_code (allows multiple NULLs, enforces uniqueness for non-NULL)
create unique index if not exists credit_batches_short_code_idx
  on public.credit_batches (short_code)
  where short_code is not null;

-- 12-char alphanumeric (A-Z, 0-9) = 36^12 ≈ 4.7e18 possibilities, negligible collision risk
-- Format: uppercase alphanumeric, no ambiguous chars (I, O, 1, 0 removed for readability)
comment on column public.credit_batches.short_code is
  'Short human-enterable code (12 chars, A-Z0-9 excluding I/O/1/0). Used alongside the long cryptographic code for manual entry.';