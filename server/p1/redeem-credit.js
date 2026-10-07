const {
  consumeCredit,
  findBatchByShortCode,
  getSigningPublicKey,
  getSupabaseAdmin,
  normalizeMachineId,
  issueOrExtendLicense,
  parseCreditCode,
  sendJson,
} = require("./_helpers");

/**
 * Redeems one institutional credit.
 *
 * Public by design: the desktop app has no user account, so the signed code is
 * the credential. Authority comes from three independent checks, all of which
 * must pass:
 *   1. the code's Ed25519 signature (proves we issued it and binds it to a batch id)
 *   2. the batch row's stored code matches the submitted code (proves the row was
 *      not edited server-side)
 *   3. an atomic compare-and-swap decrement (proves a credit was actually available)
 *
 * Check 3 is what stops a single code being spent N+1 times by concurrent
 * redemptions; the table's `credits_used <= credits_total` CHECK is the backstop.
 *
 * Note on the credit count: the code's signature commits to a batch id, but NOT
 * to a credit total. It used to, and that made top-ups impossible - raising
 * `credits_total` on a code the customer already held would have invalidated
 * their signature and locked them out of credits they had paid for. The balance
 * is therefore the database's, and its integrity is enforced in the schema
 * instead: only `topup_credit_batch()` may raise `credits_total` (enforced by a
 * trigger), it always writes a `credit_topups` audit row in the same
 * transaction, and the service role is the only writer.
 */
module.exports = async function redeemCredit(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const { code } = request.body || {};
  const machineId = normalizeMachineId((request.body || {}).machineId);
  if (!machineId || typeof code !== "string" || !code.trim()) {
    return sendJson(response, 400, { error: "A valid credit key and machine ID are required." });
  }

  const trimmedCode = code.trim();
  let batch = null;
  let parsed = null;

  // First try short code lookup (12-char alphanumeric)
  if (/^[A-Z0-9]{12}$/i.test(trimmedCode)) {
    const supabase = getSupabaseAdmin();
    const shortCodeBatch = await findBatchByShortCode(supabase, trimmedCode);
    if (shortCodeBatch) {
      batch = shortCodeBatch;
    }
  }

  // Fall back to long code signature verification
  if (!batch) {
    parsed = parseCreditCode(trimmedCode, getSigningPublicKey());
    if (!parsed) {
      return sendJson(response, 400, { error: "That credit key is not valid." });
    }

    try {
      const supabase = getSupabaseAdmin();

      const { data: batchData, error: batchError } = await supabase
        .from("credit_batches")
        .select("id, code, credits_total, credits_used, days_per_credit")
        .eq("id", parsed.batchId)
        .maybeSingle();
      if (batchError) throw batchError;
      if (!batchData) {
        return sendJson(response, 404, { error: "That credit key was not found." });
      }
      if (batchData.code !== trimmedCode) {
        return sendJson(response, 400, { error: "That credit key is not valid." });
      }
      batch = batchData;
    } catch (error) {
      return sendJson(response, 502, { error: error.message });
    }
  }

  // At this point we have a valid batch (from either short or long code)
  try {
    const supabase = getSupabaseAdmin();

    const spend = await consumeCredit(supabase, batch.id);
    if (!spend.ok) {
      if (spend.reason === "exhausted") {
        return sendJson(response, 410, {
          error: "This credit key has no credits remaining. Buy a new pack to continue.",
          creditsRemaining: 0,
        });
      }
      if (spend.reason === "missing") {
        return sendJson(response, 404, { error: "That credit key was not found." });
      }
      return sendJson(response, 503, { error: "The credit service is busy. Try again in a moment." });
    }

    const reference = `credit_${batch.id}_${Date.now()}`;
    let license;
    try {
      license = await issueOrExtendLicense(supabase, {
        machineId,
        plan: "credit",
        reference,
        days: spend.daysPerCredit,
        creditBatchId: batch.id,
      });
    } catch (error) {
      // Never strand a spent credit: hand it straight back. The guard is the exact
      // counter value this request wrote, so a concurrent redemption that has
      // already advanced it further is left untouched rather than clobbered.
      await supabase
        .from("credit_batches")
        .update({ credits_used: spend.creditsUsed - 1 })
        .eq("id", batch.id)
        .eq("credits_used", spend.creditsUsed);
      throw error;
    }

    await supabase.from("credit_redemptions").insert({
      batch_id: batch.id,
      machine_id: machineId,
      license_id: license.id,
      days_granted: spend.daysPerCredit,
      expires_at: license.expires_at,
    });

    return sendJson(response, 200, {
      machineId,
      accessKey: license.access_key,
      expiresAt: license.expires_at,
      daysGranted: spend.daysPerCredit,
      creditsRemaining: spend.creditsRemaining,
    });
  } catch (error) {
    return sendJson(response, 502, { error: error.message });
  }
};
