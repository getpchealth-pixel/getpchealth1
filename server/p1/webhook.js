const crypto = require("crypto");
const {
  getSigningPublicKey,
  getSupabaseAdmin,
  markPurchasePaid,
  normalizeMachineId,
  parseEntitlementNote,
  safeSignatureMatch,
  sendJson,
} = require("./_helpers");

/**
 * Returns the exact bytes Razorpay signed, or `null` when they are unrecoverable.
 *
 * A webhook signature covers the raw request body, so it can only be checked
 * against bytes that have not been parsed yet. The host decides whether those
 * bytes survive:
 *   - `request.rawBody` present  -> Next.js with `bodyParser: false`, and the
 *     local dev server, which mounts this handler with no JSON parser at all.
 *   - stream still readable      -> anything that has not consumed the body.
 *   - `request.body` already an object -> Vercel's Node runtime, which parses
 *     `application/json` for us and leaves nothing to re-serialise. The HMAC
 *     cannot be recomputed, and re-serialising the object would not reproduce
 *     the original bytes anyway (key order and whitespace), so this returns
 *     `null` rather than reporting a signature mismatch that never happened.
 */
async function readRawBody(request) {
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (typeof request.rawBody === "string") return Buffer.from(request.rawBody);

  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length > 0) return Buffer.concat(chunks);

  return request.body === undefined || request.body === null
    ? Buffer.alloc(0)
    : null;
}

/**
 * Razorpay callback. Verifies the HMAC signature, then re-derives what was
 * actually bought from the entitlement note we signed at purchase time - so
 * there is no hardcoded amount to drift when the price changes.
 *
 * This handler validates and acknowledges only. Entitlement is issued by
 * `verify-payment`, which re-checks the link against Razorpay's API and is the
 * path the client drives.
 */
module.exports = async function razorpayWebhook(request, response) {
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) return sendJson(response, 500, { error: "Webhook secret is not configured." });

  try {
    const rawBody = await readRawBody(request);
    if (rawBody === null) {
      // Fail closed. The signature is checked before anything else below, and it
      // cannot be checked here, so this endpoint is only safe to leave pointed at
      // a host that preserves the raw body. The documented receiver is the
      // Supabase Edge Function in supabase/functions/razorpay-webhook, which
      // reads the bytes straight off the request and needs none of this.
      return sendJson(response, 500, {
        error:
          "The raw request body is not available on this host, so the Razorpay " +
          "signature cannot be verified. Point the Razorpay webhook at the " +
          "Supabase Edge Function instead.",
      });
    }
    if (rawBody.length === 0) {
      return sendJson(response, 400, { error: "Empty webhook payload." });
    }

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (!safeSignatureMatch(request.headers["x-razorpay-signature"], expectedSignature)) {
      return sendJson(response, 400, { error: "Invalid webhook signature." });
    }

    const payload = JSON.parse(rawBody.toString("utf8"));
    if (payload.event !== "payment_link.paid") {
      return sendJson(response, 200, { received: true, ignored: true });
    }

    const paymentLink = payload.payload?.payment_link?.entity;
    if (!paymentLink) {
      return sendJson(response, 400, { error: "Invalid payment link payload." });
    }

    // The signed note is the source of truth for what was bought, and it is also
    // what tells us whether a machine id was ever involved. A credit pack has
    // none; an individual purchase must match the machine it was created for.
    const entitlement = parseEntitlementNote(paymentLink.notes?.ent, getSigningPublicKey());
    if (!entitlement) {
      return sendJson(response, 400, { error: "Payment link is not a GetPcHealth purchase." });
    }

    const machineId = normalizeMachineId(paymentLink.notes?.machine_id);
    if (entitlement.kind === "individual" && !machineId) {
      return sendJson(response, 400, { error: "Individual purchase is missing its machine ID." });
    }

    if (
      paymentLink.status !== "paid" ||
      paymentLink.currency !== "INR" ||
      paymentLink.amount !== entitlement.amountPaise
    ) {
      return sendJson(response, 400, { error: "Payment link does not match its entitlement." });
    }

    // The buyer's browser may never come back to finish the poll, so this is the
    // only path that records a sale the client walked away from. Best-effort: the
    // webhook's job is to acknowledge Razorpay, and a history write must not turn
    // a valid payment into a retry storm. Reconciliation repairs any gap.
    try {
      const supabase = getSupabaseAdmin();
      const razorpayPaymentId = payload.payload?.payment?.entity?.id || null;
      await markPurchasePaid(supabase, paymentLink.id, {
        razorpayPaymentId,
        paidAt: payload.payload?.payment?.entity?.created_at,
      });
      await supabase
        .from("purchases")
        .update({
          machine_id: machineId || null,
          synced: true,
          updated_at: new Date().toISOString(),
        })
        .eq("payment_link_id", paymentLink.id);
    } catch {}

    return sendJson(response, 200, {
      received: true,
      paymentLinkId: paymentLink.id,
      machineId: machineId || null,
      kind: entitlement.kind,
      credits: entitlement.credits,
      days: entitlement.days,
    });
  } catch (error) {
    return sendJson(response, 400, { error: "Invalid webhook payload." });
  }
};

module.exports.config = {
  api: { bodyParser: false },
};
