const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const LICENSE_PREFIX = "gph1-";
const CREDIT_PREFIX = "gphc-";

// Alphabet for short codes: uppercase alphanumeric excluding ambiguous chars
const SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SHORT_CODE_LENGTH = 12;

/** Used for entitlements with no expiry (admin-issued manual keys). */
const NEVER_EXPIRES = 4102444800; // 2100-01-01T00:00:00Z

function sendJson(response, status, body) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.status(status).json(body);
}

function safeSignatureMatch(value, expected) {
  if (!value || !expected) return false;
  const received = Buffer.from(value, "utf8");
  const valid = Buffer.from(expected, "utf8");
  return received.length === valid.length && crypto.timingSafeEqual(received, valid);
}

function getRazorpayAuth() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay credentials are not configured.");
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

/**
 * Machine IDs are the Windows MachineGuid, i.e. a canonical 8-4-4-4-12 hex GUID.
 *
 * Normalising to upper case is not cosmetic: `licenses.machine_id` is unique, so
 * storing the same GUID as both `4c4c...` and `4C4C...` would create two separate
 * entitlements for one machine. Every machine id that reaches the database goes
 * through here, so casing can never fork a licence.
 */
const MACHINE_ID_PATTERN = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

function normalizeMachineId(machineId) {
  if (typeof machineId !== "string") return null;
  const value = machineId.trim().toUpperCase();
  return MACHINE_ID_PATTERN.test(value) ? value : null;
}

function isValidMachineId(machineId) {
  return normalizeMachineId(machineId) !== null;
}

async function razorpayRequest(path, options = {}) {
  const response = await fetch(`https://api.razorpay.com${path}`, {
    ...options,
    headers: {
      Authorization: getRazorpayAuth(),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.description || "Razorpay request failed.");
  return body;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

function getSigningPrivateKey() {
  const b64 = process.env.P1_SIGNING_PRIVATE_KEY;
  if (!b64) throw new Error("P1_SIGNING_PRIVATE_KEY is not configured.");
  return crypto.createPrivateKey({
    key: Buffer.from(b64, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

function getSigningPublicKey() {
  return crypto.createPublicKey(getSigningPrivateKey());
}

function toBase64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64Url(value) {
  return Buffer.from(value, "base64url");
}

function signPayload(payload) {
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), getSigningPrivateKey());
  return toBase64Url(signature);
}

/**
 * Verifies a `prefix-<payload>.<signature>` token. Returns the payload string or
 * null. Deliberately self-contained so the desktop app can run the same shape of
 * check against a public key.
 */
function verifyToken(token, prefix, publicKey) {
  try {
    if (typeof token !== "string") return null;
    const trimmed = token.trim();
    if (!trimmed.startsWith(prefix)) return null;
    const body = trimmed.slice(prefix.length);
    const dot = body.indexOf(".");
    if (dot <= 0 || dot === body.length - 1) return null;
    const payload = fromBase64Url(body.slice(0, dot)).toString("utf8");
    const signature = fromBase64Url(body.slice(dot + 1));
    const ok = crypto.verify(null, Buffer.from(payload, "utf8"), publicKey, signature);
    return ok ? payload : null;
  } catch {
    return null;
  }
}

/**
 * The machine-bound entitlement key handed to the desktop app.
 * Payload is `machineId:reference:expiresAtEpoch` so the client can enforce the
 * expiry entirely offline, and cannot extend it without the private key.
 */
function createAccessKey(machineId, reference, expiresAtEpoch) {
  const expiresAt = Number(expiresAtEpoch) || NEVER_EXPIRES;
  const payload = `${machineId}:${reference}:${expiresAt}`;
  return `${LICENSE_PREFIX}${toBase64Url(Buffer.from(payload, "utf8"))}.${signPayload(payload)}`;
}

function parseAccessKey(accessKey, publicKey) {
  const payload = verifyToken(accessKey, LICENSE_PREFIX, publicKey);
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  const [rawMachineId, reference, expiresAt] = parts;
  const machineId = normalizeMachineId(rawMachineId);
  if (!machineId) return null;
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(reference)) return null;
  const expiry = Number(expiresAt);
  if (!Number.isInteger(expiry) || expiry <= 0) return null;
  return { machineId, reference, expiresAt: expiry };
}

/**
 * The transferable institutional credit code.
 * Payload is `batchId:creditsTotal:nonce`. The nonce stops two batches from
 * producing an identical payload (and therefore an identical code).
 */
function createCreditCode(batchId, creditsTotal, nonce) {
  const payload = `${batchId}:${creditsTotal}:${nonce}`;
  const longCode = `${CREDIT_PREFIX}${toBase64Url(Buffer.from(payload, "utf8"))}.${signPayload(payload)}`;
  const shortCode = generateShortCode();
  return { longCode, shortCode };
}

function parseCreditCode(code, publicKey) {
  const payload = verifyToken(code, CREDIT_PREFIX, publicKey);
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  const [batchId, creditsTotal, nonce] = parts;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) return null;
  const credits = Number(creditsTotal);
  if (!Number.isInteger(credits) || credits <= 0) return null;
  if (!/^[a-f0-9]{16,64}$/.test(nonce)) return null;
  return { batchId, creditsTotal: credits, nonce };
}

function generateShortCode() {
  let code = "";
  const bytes = crypto.randomBytes(SHORT_CODE_LENGTH);
  for (let i = 0; i < SHORT_CODE_LENGTH; i += 1) {
    code += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length];
  }
  return code;
}

async function findBatchByShortCode(supabase, shortCode) {
  const value = String(shortCode || "").trim().toUpperCase();
  if (!value) return null;
  if (!/^[A-Z0-9]{12}$/.test(value)) return null;

  const { data, error } = await supabase
    .from("credit_batches")
    .select("id, code, source, credits_total, credits_used, credits_granted, days_per_credit, amount_paise, note, short_code")
    .eq("short_code", value)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function getKeyFingerprint() {
  const spki = getSigningPublicKey().export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(spki).digest("hex");
}

// ---------------------------------------------------------------------------
// Pricing
//
// Every knob is an env var so the price can be changed on Vercel without a code
// deploy. The values used for a purchase are snapshotted into the Razorpay
// payment-link notes (see `buildEntitlementNote`), so changing a price mid-flight
// can never invalidate a payment that is already in progress.
// ---------------------------------------------------------------------------

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

function getPricing() {
  return {
    individualAmountPaise: intFromEnv("P1_INDIVIDUAL_AMOUNT_PAISE", 4800),
    individualDays: intFromEnv("P1_INDIVIDUAL_DAYS", 90),
    creditAmountPaise: intFromEnv("P1_CREDIT_AMOUNT_PAISE", 2400),
    creditDays: intFromEnv("P1_CREDIT_DAYS", 30),
    creditMin: intFromEnv("P1_CREDIT_MIN", 1),
    creditMax: intFromEnv("P1_CREDIT_MAX", 500),
  };
}

/**
 * Snapshots a purchase into a signed, self-describing note. Signing means the
 * verify/webhook paths can trust the amount without re-reading live pricing and
 * without depending on Razorpay preserving several separate note fields.
 */
function buildEntitlementNote(entitlement) {
  const payload = [
    entitlement.kind,
    entitlement.amountPaise,
    entitlement.days,
    entitlement.credits || 0,
    entitlement.perCreditPaise || 0,
  ].join(":");
  return `${toBase64Url(Buffer.from(payload, "utf8"))}.${signPayload(payload)}`;
}

function parseEntitlementNote(note, publicKey) {
  const payload = verifyToken(note, "", publicKey);
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 5) return null;
  const [kind, amountPaise, days, credits, perCreditPaise] = parts;
  if (kind !== "individual" && kind !== "credits") return null;
  const amount = Number(amountPaise);
  const duration = Number(days);
  const creditCount = Number(credits);
  const perCredit = Number(perCreditPaise);
  if (!Number.isInteger(amount) || amount <= 0) return null;
  if (!Number.isInteger(duration) || duration <= 0) return null;
  if (!Number.isInteger(creditCount) || creditCount < 0) return null;
  if (!Number.isInteger(perCredit) || perCredit < 0) return null;
  // Credits must be internally consistent: the charged amount is always derived,
  // never trusted from the note, and must match what the buyer was quoted.
  if (kind === "credits" && (creditCount <= 0 || creditCount * perCredit !== amount)) return null;
  if (kind === "individual" && (creditCount !== 0 || perCredit !== 0)) return null;
  return { kind, amountPaise: amount, days: duration, credits: creditCount, perCreditPaise: perCredit };
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server credentials are not configured.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getBearerToken(request) {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/**
 * Resolves the caller and requires the admin role. Authorisation reads
 * `app_metadata`, which only the service role can set - `user_metadata` is
 * user-editable and would be trivially self-service.
 */
async function requireAdmin(request) {
  const accessToken = getBearerToken(request);
  if (!accessToken) return { error: { status: 401, message: "You must be logged in." } };
  const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);
  if (error || !data || !data.user) {
    return { error: { status: 401, message: "You must be logged in." } };
  }
  if (data.user.app_metadata?.role !== "admin") {
    return { error: { status: 403, message: "This action requires an administrator." } };
  }
  return { user: data.user };
}

// ---------------------------------------------------------------------------
// Purchase history
//
// `licenses` deliberately keeps only a machine's *first* receipt, because
// renewing overwrites the row in place. That is right for the app and useless
// for reporting, so every payment gets its own row here instead.
// ---------------------------------------------------------------------------

/**
 * Maps a Razorpay payment-link status onto `purchases.status`.
 *
 * Razorpay only ever reports `created`, `paid`, `expired` or `cancelled` for a
 * link. An expired or cancelled link is a failed purchase as far as history is
 * concerned. `refunded` has no Razorpay link status, but a refund can arrive as
 * a payment event, so the state is still accepted on the way in.
 */
const PAYMENT_LINK_STATUS = {
  created: "created",
  paid: "paid",
  expired: "failed",
  cancelled: "failed",
};

function mapPaymentLinkStatus(status) {
  return PAYMENT_LINK_STATUS[String(status || "").toLowerCase()] || "created";
}

/**
 * Inserts a `purchases` row, or updates the existing one for the same payment
 * link. `payment_link_id` is unique, so re-running this (the client polls
 * verify-payment, and reconciliation re-reads every link) converges on one row
 * instead of duplicating the sale.
 *
 * `onConflict: "payment_link_id"` upserts, but only the columns named in the
 * payload are touched - so the "created" pass writes amount/days/credits and
 * the "paid" pass can add a payment id without erasing them.
 */
async function recordPurchase(supabase, entry) {
  const { paymentLinkId, ...rest } = entry;
  if (!paymentLinkId) throw new Error("recordPurchase needs a paymentLinkId.");

  const row = { payment_link_id: paymentLinkId, updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined && value !== null) {
      // Callers pass camelCase (machineId, amountPaise); the table is snake_case.
      // PostgREST rejects unknown columns, so translate before upserting.
      const column = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
      row[column] = value;
    }
  }

  const { data, error } = await supabase
    .from("purchases")
    .upsert(row, { onConflict: "payment_link_id" })
    .select("id, payment_link_id, kind, status, amount_paise, credits, days, machine_id, email, credit_batch_id, razorpay_payment_id, synced, paid_at, created_at")
    .single();
  if (error) throw new Error(`Could not record purchase: ${error.message}`);
  return data;
}

/**
 * Records a completed payment. Kept separate from `recordPurchase` because a
 * refund must be able to move a row to `refunded` without restating the sale.
 */
async function markPurchasePaid(supabase, paymentLinkId, { razorpayPaymentId, status, paidAt } = {}) {
  const finalStatus = status === "refunded" ? "refunded" : "paid";
  const patch = {
    status: finalStatus,
    paid_at: paidAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (razorpayPaymentId) patch.razorpay_payment_id = razorpayPaymentId;

  const { data, error } = await supabase
    .from("purchases")
    .update(patch)
    .eq("payment_link_id", paymentLinkId)
    .select("id, payment_link_id, kind, status, razorpay_payment_id, paid_at")
    .maybeSingle();
  if (error) throw new Error(`Could not update purchase: ${error.message}`);
  return data;
}

/**
 * Adds complimentary credits to a code the customer is already holding.
 *
 * The increment, the audit row and the returned balance all happen inside
 * `topup_credit_batch()`, one database transaction. Doing read-then-write here
 * instead would let two simultaneous top-ups lose one another, and would let
 * the audit row be written without the balance change it describes.
 *
 * Returns `{ ok: false, reason }` for the conditions the API maps to a status
 * code, and throws only for genuinely unexpected failures.
 */
async function topUpCreditBatch(supabase, { batchId, credits, adminEmail, note }) {
  const { data, error } = await supabase.rpc("topup_credit_batch", {
    p_batch_id: batchId,
    p_credits: credits,
    p_admin_email: adminEmail,
    p_note: note || null,
  });
  if (error) {
    const message = error.message || "";
    // Postgres surfaces the function's `raise exception` messages verbatim.
    if (/credit batch not found/i.test(message)) return { ok: false, reason: "missing" };
    if (/credits must be between/i.test(message)) return { ok: false, reason: "invalid" };
    if (/credits_granted_check|credit_batches_.*_check/i.test(message)) {
      return { ok: false, reason: "invalid" };
    }
    throw new Error(`Could not add credits: ${message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, reason: "missing" };
  return { ok: true, batch: row };
}

/**
 * Resolves a submitted credit code to its batch, for the admin top-up form.
 * Accepts either the full `gphc-...` code or a bare batch id, so an admin can
 * paste whatever the customer sent them.
 */
async function findBatchByCodeOrId(supabase, reference) {
  const value = String(reference || "").trim();
  if (!value) return null;

  if (value.startsWith(CREDIT_PREFIX)) {
    // Verify the signature too, so the admin form rejects a typo'd or tampered
    // code with a clear message instead of silently matching nothing.
    const parsed = parseCreditCode(value, getSigningPublicKey());
    if (!parsed) return null;
    const { data } = await supabase
      .from("credit_batches")
      .select("id, code, source, credits_total, credits_used, credits_granted, days_per_credit, amount_paise, note")
      .eq("id", parsed.batchId)
      .maybeSingle();
    return data || null;
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    const { data } = await supabase
      .from("credit_batches")
      .select("id, code, source, credits_total, credits_used, credits_granted, days_per_credit, amount_paise, note")
      .eq("id", value.toLowerCase())
      .maybeSingle();
    return data || null;
  }
  return null;
}

/** Credit-pack search terms are interpolated into a PostgREST `.or()` filter. */
function sanitizeSearchTerm(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/[,()*%\\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// Entitlement issuing
// ---------------------------------------------------------------------------

const DAY_SECONDS = 86400;

/**
 * Grants or extends the entitlement for a machine.
 *
 * There is at most one `licenses` row per machine. Renewing extends `expires_at`
 * from the existing expiry rather than from now, so a buyer who redeems on day 29
 * of a 30-day window gets a full 30 more days instead of losing a day. A lapsed
 * license restarts from now.
 */
async function issueOrExtendLicense(
  supabase,
  { machineId, plan, reference, days, creditBatchId = null, neverExpires = false }
) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const { data: existing, error: readError } = await supabase
    .from("licenses")
    .select("id, expires_at")
    .eq("machine_id", machineId)
    .maybeSingle();
  if (readError) throw readError;

  const existingExpiry = existing ? Math.floor(new Date(existing.expires_at).getTime() / 1000) : 0;
  const base = existingExpiry > nowSeconds ? existingExpiry : nowSeconds;
  const expiresAt = neverExpires ? NEVER_EXPIRES : base + Math.round(days) * DAY_SECONDS;

  const row = {
    machine_id: machineId,
    plan,
    access_key: createAccessKey(machineId, reference, expiresAt),
    key_fingerprint: getKeyFingerprint(),
    starts_at: new Date((existingExpiry > nowSeconds ? existingExpiry : nowSeconds) * 1000).toISOString(),
    expires_at: new Date(expiresAt * 1000).toISOString(),
    payment_link_id: null,
    credit_batch_id: creditBatchId,
    archived: false,
    updated_at: new Date().toISOString(),
  };

  // payment_link_id is intentionally not carried over on extension: a machine can
  // accumulate several purchases and only the first one is its original receipt.
  if (!existing) row.payment_link_id = reference;

  const { data, error } = await supabase
    .from("licenses")
    .upsert(row, { onConflict: "machine_id" })
    .select("id, machine_id, plan, access_key, expires_at, credit_batch_id")
    .single();
  if (error) throw new Error(`Could not save license: ${error.message}`);
  return { ...data, extendsExisting: !!existing };
}

// ---------------------------------------------------------------------------
// Credit consumption
// ---------------------------------------------------------------------------

/**
 * Spends one credit from a batch using an optimistic compare-and-swap.
 *
 * PostgREST cannot express `SELECT ... FOR UPDATE`, so instead we only accept
 * the update if `credits_used` still holds the value we read. A losing racer
 * gets zero rows back, re-reads, and retries. The `credits_used <= credits_total`
 * CHECK constraint on the table is the final backstop, so concurrent redemptions
 * can never oversell a pack.
 */
async function consumeCredit(supabase, batchId) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: current, error: readError } = await supabase
      .from("credit_batches")
      .select("id, credits_used, credits_total, days_per_credit")
      .eq("id", batchId)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return { ok: false, reason: "missing" };
    if (current.credits_used >= current.credits_total) return { ok: false, reason: "exhausted" };

    const next = current.credits_used + 1;
    const { data: updated, error: writeError } = await supabase
      .from("credit_batches")
      .update({ credits_used: next })
      .eq("id", batchId)
      .eq("credits_used", current.credits_used)
      .lt("credits_used", current.credits_total)
      .select("id, credits_used, credits_total, days_per_credit")
      .maybeSingle();
    if (writeError) throw writeError;
    if (updated) {
      return {
        ok: true,
        // The exact value this call wrote. A caller that has to undo the spend
        // must CAS on this, not on a value it read earlier: a losing racer may
        // have advanced the counter in between.
        creditsUsed: updated.credits_used,
        daysPerCredit: updated.days_per_credit,
        creditsRemaining: updated.credits_total - updated.credits_used,
      };
    }
  }
  return { ok: false, reason: "contended" };
}

module.exports = {
  CREDIT_PREFIX,
  LICENSE_PREFIX,
  NEVER_EXPIRES,
  SHORT_CODE_ALPHABET,
  SHORT_CODE_LENGTH,
  buildEntitlementNote,
  consumeCredit,
  createAccessKey,
  createCreditCode,
  findBatchByCodeOrId,
  findBatchByShortCode,
  fromBase64Url,
  generateShortCode,
  getBearerToken,
  getKeyFingerprint,
  getPricing,
  getSigningPrivateKey,
  getSigningPublicKey,
  getSupabaseAdmin,
  isValidMachineId,
  issueOrExtendLicense,
  mapPaymentLinkStatus,
  markPurchasePaid,
  normalizeMachineId,
  parseAccessKey,
  parseCreditCode,
  parseEntitlementNote,
  razorpayRequest,
  recordPurchase,
  requireAdmin,
  safeSignatureMatch,
  sanitizeSearchTerm,
  sendJson,
  signPayload,
  toBase64Url,
  topUpCreditBatch,
  verifyToken,
};
