const { findBatchByShortCode, getSigningPublicKey, getSupabaseAdmin, parseCreditCode, sendJson } = require("./_helpers");

/**
 * Reports how much is left in a credit pack, so an institutional buyer can track
 * seats without redeeming. Reveals counts only - it never returns a machine's
 * access key or any personal data.
 */
module.exports = async function creditInfo(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const { code } = request.body || {};
  const trimmedCode = typeof code === "string" ? code.trim() : "";
  if (!trimmedCode) return sendJson(response, 400, { error: "That credit key is not valid." });

  let batch = null;

  // First try short code lookup
  if (/^[A-Z0-9]{12}$/i.test(trimmedCode)) {
    batch = await findBatchByShortCode(getSupabaseAdmin(), trimmedCode);
  }

  // Fall back to long code signature verification
  if (!batch) {
    const parsed = parseCreditCode(trimmedCode, getSigningPublicKey());
    if (!parsed) return sendJson(response, 400, { error: "That credit key is not valid." });

    const { data, error } = await getSupabaseAdmin()
      .from("credit_batches")
      .select("id, credits_total, credits_used, days_per_credit, created_at")
      .eq("id", parsed.batchId)
      .eq("code", trimmedCode)
      .maybeSingle();
    if (error) throw error;
    if (!data) return sendJson(response, 404, { error: "That credit key was not found." });
    batch = data;
  }

  return sendJson(response, 200, {
    creditsTotal: batch.credits_total,
    creditsUsed: batch.credits_used,
    creditsRemaining: Math.max(0, batch.credits_total - batch.credits_used),
    daysPerCredit: batch.days_per_credit,
    purchasedAt: batch.created_at,
    shortCode: batch.short_code,
  });
};
