import "./Dashboard.css";

const STEPS = [
  {
    title: "Every computer has its own code",
    body: "Think of each PC like a car. Just as every car has a different number plate, every computer has a different code. This code is called the Machine ID, and you can see it inside the GetPcHealth app.",
  },
  {
    title: "The app asks you to unlock it",
    body: "When someone opens GetPcHealth for the first time, the app shows its code on screen and asks to be unlocked. The app cannot be used fully until it is unlocked.",
  },
  {
    title: "Pay for that computer, once",
    body: "To unlock it, enter the computer's code on this page and pay ₹48. This covers 90 days of Pro access for that computer.",
  },
  {
    title: "The system checks your payment",
    body: "After you pay, the system automatically checks with the bank to confirm the money was really received. This usually happens within a few seconds.",
  },
  {
    title: "You get a secret key",
    body: "Once the payment is confirmed, the system gives you a secret key. This key works only with that exact computer and its code. Nothing else can use it.",
  },
  {
    title: "The app unlocks forever",
    body: "Copy the key into the app, and the app works fully forever — even without internet. The app checks the key by itself on the computer, so it does not need our server again.",
  },
  {
    title: "The key cannot be shared",
    body: "The key is locked to one computer. If someone tries to use your key on a different computer, it will not work. So treat it like a house key and keep it safe.",
  },
  {
    title: "The same computer never pays again",
    body: "If the same computer comes back later (for example, after reinstalling Windows), the system remembers it already paid and gives the same key back automatically. No new payment needed.",
  },
];

const TECHNICAL = [
  {
    title: "1. Two product types",
    body: "The system supports two distinct licensing models: Individual (machine-bound Pro access) and Institutional Credits (transferable credit packs). Each has its own purchase and redemption flow.",
    code: "Individual:  fixed-duration Pro access bound to ONE machine\n  amount:  ₹48 (configurable via P1_INDIVIDUAL_AMOUNT_PAISE)\n  duration: 90 days (configurable via P1_INDIVIDUAL_DAYS)\n\nCredits:  transferable code holding N credits\n  per credit: 30 days Pro access (configurable via P1_CREDIT_DAYS)\n  price/credit: ₹24 (configurable via P1_CREDIT_AMOUNT_PAISE)\n  min/max credits per pack: 1–500",
  },
  {
    title: "2. Machine ID (client identifier)",
    body: "The desktop app reads the Windows MachineGuid (Win32_ComputerSystemProduct.UUID) and sends it to the server. Server normalises to uppercase and validates format before any processing.",
    code: "source      = Win32_ComputerSystemProduct.UUID (Windows)\nnormalised  = upper-case, hyphens preserved\nallowed     = ^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$",
  },
  {
    title: "3. Create Individual payment — POST /api/p1/create-payment",
    body: "Checks if machine already has active Individual license. If yes, returns existing key (alreadyActive: true). Otherwise creates a Razorpay Payment Link with a signed entitlement note in notes.ent — the note commits to amount, duration, and product type so price changes can't affect in-flight payments.",
    code: "if active Individual license exists -> 200 { alreadyActive: true, accessKey, expiresAt }\n\nelse Razorpay Payment Link:\n  amount        = 4800 paise (configurable)\n  currency      = INR\n  accept_partial= false\n  reference_id  = gph_<sha256(machineId_kind_nonce)[:30]>\n  notes.ent     = base64url(payload).Ed25519sig   // signed entitlement\n  notes.machine_id = machineId\n\nresponse -> { paymentLinkId, paymentUrl, qrCodeUrl, amountPaise, days }",
  },
  {
    title: "4. Create Credit pack payment — POST /api/p1/create-payment (kind=credits)",
    body: "No machine ID required (credits are not bound to buyer's machine). Creates Razorpay link for N credits × price. Signed entitlement note includes credits count, days per credit, total amount. Records a 'created' row in purchases table immediately so abandoned checkouts are visible.",
    code: "Razorpay Payment Link:\n  amount        = credits * P1_CREDIT_AMOUNT_PAISE\n  currency      = INR\n  reference_id  = gph_<sha256(\"pack\"_credits_nonce)[:30]>\n  notes.ent     = base64url(payload).Ed25519sig  // kind=credits, credits=N\n\nPurchases row inserted with status='created'\n\nresponse -> { paymentLinkId, paymentUrl, qrCodeUrl, credits, daysPerCredit, amountPaise }",
  },
  {
    title: "5. Verify payment — POST /api/p1/verify-payment (client polls)",
    body: "Client polls every few seconds. Server re-reads payment link from Razorpay, verifies status=paid, amount/currency match signed entitlement note. For Individual: checks machine_id matches. For Credits: no machine check. Issues entitlement and marks purchase 'paid'.",
    code: "GET https://api.razorpay.com/v1/payment_links/{paymentLinkId}\n\nvalidate: paymentLink.status === 'paid'\nvalidate: paymentLink.currency === 'INR'\nvalidate: paymentLink.amount === entitlement.amountPaise\nvalidate: entitlement = parseEntitlementNote(paymentLink.notes.ent)\n\nif Individual:\n  validate: paymentLink.notes.machine_id === machineId\n  issueOrExtendLicense(machineId, plan='individual', days=entitlement.days)\n\nif Credits:\n  grantCreditPack()  // creates credit_batches row with signed code + short_code\n  no machine binding\n\nmarkPurchasePaid(paymentLinkId, { licenseId | creditBatchId })",
  },
  {
    title: "6. Webhook — payment_link.paid (Supabase Edge Function)",
    body: "Razorpay can notify server directly. Validates HMAC-SHA256 signature, event type, then re-verifies entitlement note and amount/currency. Acknowledges only; actual entitlement issuance happens in verify-payment to avoid duplicate grants.",
    code: "event      = payment_link.paid (others ignored)\nsignature  = HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)\nconstant-time compare with x-razorpay-signature header\n\nentitlement = parseEntitlementNote(paymentLink.notes.ent)\nvalidate:   amount == entitlement.amountPaise\nvalidate:   currency == INR, status == paid\n\nreturns JSON with paymentLinkId, machineId, kind, credits, days",
  },
  {
    title: "7. Key generation — Ed25519 digital signatures",
    body: "Two key formats, both signed with server's Ed25519 private key (P1_SIGNING_PRIVATE_KEY). Public key compiled into desktop app for offline verification. Server stores SHA-256 fingerprint of public key (key_fingerprint) to detect rotation.",
    code: "Individual access key (gph1-):\n  payload = machineId + ':' + reference + ':' + expiresAtEpoch\n  signature = Ed25519_sign(payload, privateKey)\n  access_key = 'gph1-' + base64url(payload) + '.' + base64url(signature)\n\nCredit code (gphc-):\n  payload = batchId + ':' + creditsTotal + ':' + nonce\n  signature = Ed25519_sign(payload, privateKey)\n  code = 'gphc-' + base64url(payload) + '.' + base64url(signature)\n  short_code = 12-char alphanumeric (ABCDEFGHJKLMNPQRSTUVWXYZ23456789)\n\nBoth verified offline in desktop app using embedded public key",
  },
  {
    title: "8. Database schema (PostgreSQL via Supabase)",
    body: "Four core tables with RLS (admin-only reads via app_metadata.role). Service-role writes bypass RLS. Key tables:",
    code: "licenses (one per machine, unique machine_id):\n  machine_id, plan (individual|credit|manual), access_key, key_fingerprint\n  starts_at, expires_at, payment_link_id, credit_batch_id, archived\n\ncredit_batches (one per credit pack purchase):\n  id, code, short_code (unique), code_fingerprint\n  credits_total, credits_used, credits_granted, days_per_credit\n  amount_paise, price_per_credit_paise, payment_link_id (nullable)\n  purchaser_machine_id, source (payment|manual), created_by, note\n  CHECK: credits_used <= credits_total\n\ncredit_redemptions (append-only audit):\n  batch_id, machine_id, license_id, days_granted, expires_at\n\npurchases (durable history, survives license renewal):\n  payment_link_id (unique), kind, status (created|paid|failed|refunded)\n  amount_paise, days, credits, machine_id, credit_batch_id, license_id\n  razorpay_payment_id, synced, paid_at\n\ncredit_topups (audit for complimentary credits):\n  batch_id, credits_added, credits_total_after, note, created_by\n\nTrigger: credit_batches.credits_total only modifiable via topup_credit_batch() RPC",
  },
  {
    title: "9. Credit redemption — POST /api/p1/redeem-credit",
    body: "Public endpoint (no auth). Accepts either short code (12-char) or long cryptographic code. For short code: DB lookup by short_code. For long code: verify Ed25519 signature, then verify code matches DB row. Atomic compare-and-swap decrement credits_used. Issues/extends license on machine (plan='credit').",
    code: "if code matches /^[A-Z0-9]{12}$/i:\n  batch = SELECT * FROM credit_batches WHERE short_code = code\nelse:\n  parsed = parseCreditCode(code)  // verify Ed25519 sig\n  batch = SELECT * FROM credit_batches WHERE id = parsed.batchId AND code = code\n\nconsumeCredit(batch.id)  -- CAS loop: UPDATE ... SET credits_used = n+1 WHERE credits_used = n\n\nissueOrExtendLicense(machineId, plan='credit', days=batch.days_per_credit, creditBatchId=batch.id)\nINSERT INTO credit_redemptions(...)\n\nreturns: { accessKey, expiresAt, daysGranted, creditsRemaining }",
  },
  {
    title: "10. Credit top-up — POST /api/p1/topup-credit (admin only)",
    body: "Admin can add complimentary credits to existing pack. Uses topup_credit_batch() RPC (single transaction: increments credits_total + credits_granted, writes credit_topups row). Database trigger rejects direct UPDATE to credits_total. Returns updated totals + short_code.",
    code: "topup_credit_batch(p_batch_id, p_credits, p_admin_email, p_note):\n  SELECT credits_total FOR UPDATE\n  SET credits_total = credits_total + p_credits\n  SET credits_granted = credits_granted + p_credits\n  INSERT INTO credit_topups(...)\n  RETURN updated batch row\n\ntrigger guard_credit_batches_total() rejects any UPDATE credits_total\n  not coming from this RPC (session flag gph.credit_total_writable=on)",
  },
  {
    title: "11. Purchase reconciliation — POST /api/p1/reconcile-purchases",
    body: "Admin-triggered backfill from Razorpay. Fetches all payment links, upserts/updates purchases rows with real Razorpay status (paid/failed/refunded). Recreates license rows for Individual renewals that were overwritten in licenses table (purchases preserves full history).",
    code: "for each Razorpay payment_link:\n  upsert purchases (payment_link_id) with status=map(status)\n  if paid and Individual and license missing:\n    issueOrExtendLicense(machineId, reference=payment_link_id, days=entitlement.days)\n    update purchases set license_id=...\n  if paid and Credits and credit_batch missing:\n    grantCreditPack()\n    update purchases set credit_batch_id=...\n\nreturns summary: { created, updated, skipped, errors }",
  },
  {
    title: "12. Admin dashboard — Supabase direct reads + API",
    body: "Dashboard uses Supabase client (anon key + user JWT) for direct reads on licenses, credit_batches, credit_redemptions (RLS: app_metadata.role=admin). Purchase list uses service-role API endpoint /api/p1/purchases for server-side pagination + purchase_summary() RPC.",
    code: "RLS policies (all tables):\n  USING ((SELECT auth.jwt()->'app_metadata'->>'role') = 'admin')\n  -- app_metadata set by service role only, not user-editable\n\nis_admin() helper function (STABLE, security definer)\n\npurchase_summary() RPC:\n  returns totals: paid_count, revenue_paise, credits_sold, days_sold\n  only paid rows count as revenue",
  },
  {
    title: "13. Manual admin actions (bypass Razorpay)",
    body: "Two endpoints for support/giveaways: create-manual-key (machine-bound Individual, any days, 0=never expires) and create-manual-credit (credit pack with ₹0 amount, source='manual'). Both use same Ed25519 signing, indistinguishable from paid keys to desktop app.",
    code: "POST /api/p1/create-manual-key  (admin)\n  body: { machineId, days }\n  -> issueOrExtendLicense(plan='individual', neverExpires=(days===0))\n  -> returns { accessKey, expiresAt }\n\nPOST /api/p1/create-manual-credit  (admin)\n  body: { credits, days, note }\n  -> insert credit_batches (source='manual', amount_paise=0, price_per_credit_paise=0)\n  -> returns { code, shortCode, credits, daysPerCredit }",
  },
  {
    title: "14. App-side validation (fully offline)",
    body: "Desktop app compiles Ed25519 public key. On launch: parses access key, verifies signature, checks signed machineId == current MachineGuid, checks expiry. For credits: redeems via API, then validates returned access key same way. Zero server dependency after activation.",
    code: "parse       -> must start with 'gph1-'\ndecode      -> payload_b64 . sig_b64 (base64url)\npayload     -> machineId : reference : expiresAtEpoch\nverify      -> Ed25519_verify(payload, signature, EMBEDDED_PUBLIC_KEY)\nwill_activate -> verified AND payload.machineId == current device GUID\n              AND payload.expiresAtEpoch > now()\n\nany key from another machine fails machineId check",
  },
  {
    title: "15. Activation storage on machine",
    body: "After successful payment/redemption, app stores license locally. Trial system (trial/trial.js) tracks first run, activation state. License data stored via license.js saveLicense().",
    code: "Trial state:\n  Location: C:\\Users\\<you>\\AppData\\Roaming\\GetPcHealth\\trial-state.json\n  Fields: installedAt, firstRunAt, lastSeenAt, deviceId, hostname, salt\n          activated (boolean), activatedAt (ISO string)\n\nLicense state (license.json):\n  Location: C:\\Users\\<you>\\AppData\\Roaming\\GetPcHealth\\license.json\n  Fields: machineId, accessKey, plan (individual|credit), expiresAt (ISO),\n          activatedAt (ISO)\n\n(source: app.getPath('userData') in Electron)",
  },
];

export default function Info() {
  return (
    <>
      <section className="dashboard-info" aria-labelledby="info-heading">
        <div className="dashboard-info-heading">
          <p className="dashboard-kicker">Simple explanation</p>
          <h1 id="info-heading">How the unlock flow works</h1>
        </div>
        <ol className="dashboard-info-list">
          {STEPS.map((step, index) => (
            <li className="dashboard-info-step" key={step.title}>
              <span className="dashboard-info-number">{index + 1}</span>
              <div>
                <h2>{step.title}</h2>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="dashboard-info-note">
          <p>
            In one line: pay once for a computer, get a key that works only on that computer,
            and it is unlocked forever.
          </p>
        </div>
      </section>

      <section className="dashboard-info" aria-labelledby="tech-heading">
        <div className="dashboard-info-heading">
          <p className="dashboard-kicker">For developers</p>
          <h1 id="tech-heading">Technical flow — exact details</h1>
        </div>
        <ol className="dashboard-tech-list">
          {TECHNICAL.map((item) => (
            <li className="dashboard-tech-item" key={item.title}>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
              <pre className="dashboard-tech-block">{item.code}</pre>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}