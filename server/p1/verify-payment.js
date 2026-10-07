const crypto = require("crypto");
const {
  createCreditCode,
  getKeyFingerprint,
  getSigningPublicKey,
  getSupabaseAdmin,
  markPurchasePaid,
  normalizeMachineId,
  issueOrExtendLicense,
  parseEntitlementNote,
  razorpayRequest,
  sendJson,
} = require("./_helpers");

/**
 * Confirms a purchase against Razorpay and issues the entitlement.
 *
 * The client is never trusted: the amount, currency and machine binding are all
 * read back from the payment link we created, and the entitlement itself is
 * recovered from a note we signed at creation time. That means a price change
 * cannot retroactively invalidate a payment already in flight.
 *
 * Idempotent. The desktop app polls every few seconds, so a second successful
 * call for the same link must return the same key without granting extra time.
 */
module.exports = async function verifyPayment(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const { paymentLinkId } = request.body || {};
  if (!/^plink_[a-zA-Z0-9]+$/.test(paymentLinkId || "")) {
    return sendJson(response, 400, { error: "Invalid payment verification data." });
  }

  try {
    const paymentLink = await razorpayRequest(`/v1/payment_links/${paymentLinkId}`);

    // Read what was bought from the note we signed, before anything else: the
    // note, not the request, decides whether a machine id is even relevant.
    const entitlement = parseEntitlementNote(paymentLink.notes?.ent, getSigningPublicKey());
    if (!entitlement) {
      return sendJson(response, 400, { error: "This payment link is not a GetPcHealth purchase." });
    }
    if (paymentLink.status !== "paid") {
      return sendJson(response, 409, { error: "Payment is not verified yet." });
    }
    if (paymentLink.currency !== "INR" || paymentLink.amount !== entitlement.amountPaise) {
      return sendJson(response, 400, { error: "The payment amount does not match the purchase." });
    }

    const supabase = getSupabaseAdmin();

    // A credit pack is not tied to a buyer machine - the key is activated on each
    // machine later, and the server records those machine ids on redemption.
    if (entitlement.kind === "credits") {
      const result = await grantCreditPack(supabase, paymentLinkId, entitlement);
      await settlePurchase(supabase, paymentLinkId, { creditBatchId: result.batchId });
      return sendJson(response, 200, result);
    }

    const machineId = normalizeMachineId((request.body || {}).machineId);
    if (!machineId) {
      return sendJson(response, 400, { error: "A valid machine ID is required." });
    }
    // The note was written by us, so normalise before comparing: a machine id
    // that differs only in case is the same machine, not a mismatch.
    if (normalizeMachineId(paymentLink.notes?.machine_id) !== machineId) {
      return sendJson(response, 403, { error: "This payment does not match the machine ID." });
    }

    // Already issued for this exact link - hand back the same key, do not extend.
    const { data: current } = await supabase
      .from("licenses")
      .select("access_key, expires_at, payment_link_id")
      .eq("machine_id", machineId)
      .maybeSingle();
    if (current && current.payment_link_id === paymentLinkId) {
      await settlePurchase(supabase, paymentLinkId, { machineId });
      return sendJson(response, 200, {
        kind: "individual",
        machineId,
        accessKey: current.access_key,
        expiresAt: current.expires_at,
        alreadyIssued: true,
      });
    }

    const license = await issueOrExtendLicense(supabase, {
      machineId,
      plan: "individual",
      reference: paymentLinkId,
      days: entitlement.days,
    });

    await settlePurchase(supabase, paymentLinkId, { machineId, licenseId: license.id });

    return sendJson(response, 200, {
      kind: "individual",
      machineId,
      accessKey: license.access_key,
      expiresAt: license.expires_at,
      days: entitlement.days,
    });
  } catch (error) {
    return sendJson(response, 502, { error: error.message });
  }
};

/**
 * Marks the history row paid and links it to whatever entitlement it bought.
 *
 * Best-effort on purpose: the customer is standing at a QR code waiting for
 * their key, and a history write failing is not a reason to withhold the
 * licence. `reconcile-purchases.js` repairs anything missed.
 */
async function settlePurchase(supabase, paymentLinkId, { machineId, licenseId, creditBatchId } = {}) {
  try {
    const row = await markPurchasePaid(supabase, paymentLinkId);
    const patch = {};
    if (machineId) patch.machine_id = machineId;
    if (licenseId) patch.license_id = licenseId;
    if (creditBatchId) patch.credit_batch_id = creditBatchId;
    if (Object.keys(patch).length === 0) return row;
    await supabase
      .from("purchases")
      .update({ ...patch, synced: true, updated_at: new Date().toISOString() })
      .eq("payment_link_id", paymentLinkId);
  } catch {}
}

/**
 * Creates the credit batch for a paid pack and mints its transferable code.
 *
 * No machine is involved: the pack is not bought for a machine, it is activated
 * on machines later. `payment_link_id` is unique, so a duplicate call collides
 * and we fall back to returning the code that already exists. That keeps the
 * code stable no matter how many times the client polls.
 */
async function grantCreditPack(supabase, paymentLinkId, entitlement) {
  const batchId = crypto.randomUUID();
  const { longCode, shortCode } = createCreditCode(batchId, entitlement.credits, crypto.randomBytes(12).toString("hex"));

  const { data, error } = await supabase
    .from("credit_batches")
    .insert({
      id: batchId,
      code: longCode,
      short_code: shortCode,
      code_fingerprint: getKeyFingerprint(),
      credits_total: entitlement.credits,
      credits_used: 0,
      days_per_credit: entitlement.days,
      amount_paise: entitlement.amountPaise,
      price_per_credit_paise: entitlement.perCreditPaise,
      payment_link_id: paymentLinkId,
      purchaser_machine_id: null,
      source: "payment",
    })
    .select("id, code, short_code, credits_total, days_per_credit, amount_paise")
    .single();

  if (!error && data) {
    return {
      kind: "credits",
      code: data.code,
      shortCode: data.short_code,
      credits: data.credits_total,
      daysPerCredit: data.days_per_credit,
      amountPaise: data.amount_paise,
      batchId: data.id,
    };
  }

  const isConflict = error && (error.code === "23505" || /duplicate key/i.test(error.message || ""));
  if (!isConflict) throw new Error(`Could not save credit pack: ${error.message}`);

  const { data: existing, error: readError } = await supabase
    .from("credit_batches")
    .select("id, code, short_code, credits_total, days_per_credit, amount_paise")
    .eq("payment_link_id", paymentLinkId)
    .single();
  if (readError) throw new Error(`Could not read credit pack: ${readError.message}`);

  return {
    kind: "credits",
    code: existing.code,
    shortCode: existing.short_code,
    credits: existing.credits_total,
    daysPerCredit: existing.days_per_credit,
    amountPaise: existing.amount_paise,
    batchId: existing.id,
    alreadyIssued: true,
  };
}
