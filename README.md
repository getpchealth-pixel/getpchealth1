## Razorpay P1 webhook

The P1 flow creates a Razorpay Payment Link for the individual plan (`4800` paise, i.e. ₹48, by default). Pricing is set with `P1_INDIVIDUAL_AMOUNT_PAISE` and `P1_CREDIT_AMOUNT_PAISE` (paise per credit, default `2400` = ₹24) — see the pricing block in `.env`. Deploy the Supabase Edge Function in `supabase/functions/razorpay-webhook`, then configure this webhook in Razorpay:

```text
https://voofqluoyxneqjyywjmj.supabase.co/functions/v1/razorpay-webhook
```

Subscribe to `payment_link.paid` and store `RAZORPAY_WEBHOOK_SECRET` as a Supabase Edge Function secret. The webhook validates Razorpay's signature and the image ID/₹1 payment metadata; `/api/p1/verify-payment` performs the final server-side confirmation before returning the access key. Keep `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `P1_SPECIAL_KEY` server-side.

## P1 records

Run `supabase/migrations/20260908_create_p1_records.sql` in the Supabase SQL Editor. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as server-only Vercel environment variables. The verification endpoint saves the machine ID, generated access key, verification date, payment link ID, and a SHA-256 fingerprint of `P1_SPECIAL_KEY`; the raw secret is never stored. Authenticated users can view the records in the dashboard.

Authenticated dashboard users can also create a manual key by entering a machine ID. The `/api/p1/create-manual-key` endpoint validates the Supabase bearer token before generating and saving the key.
