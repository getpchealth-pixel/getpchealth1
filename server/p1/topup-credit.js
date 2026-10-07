const {
  findBatchByCodeOrId,
  findBatchByShortCode,
  getSupabaseAdmin,
  requireAdmin,
  sendJson,
  topUpCreditBatch,
} = require("./_helpers");

/** Kept in step with the ceiling enforced inside `topup_credit_batch()`. */
const MAX_CREDITS = 100000;
const MAX_NOTE = 200;

function cleanNote(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_NOTE);
  return trimmed || null;
}

/**
 * Adds credits to a code the customer is already holding.
 *
 * Accepts either the full `gphc-...` code or a bare batch id, because the code
 * is long and an admin will have whichever the customer pasted into support.
 *
 * The increment is not just an UPDATE: `topup_credit_batch()` runs it as one
 * transaction that also writes a `credit_topups` row, and a database trigger
 * rejects any `credits_total` change that did not come through it. So a balance
 * can grow here and nowhere else, and every credit handed out is attributable.
 *
 * The amount originally paid is deliberately left alone - added credits are
 * goodwill, and rewriting `amount_paise` would corrupt the receipt the batch
 * represents. `credits_granted` records how many were free.
 */
module.exports = async function topUpCredit(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const auth = await requireAdmin(request);
  if (auth.error) return sendJson(response, auth.error.status, { error: auth.error.message });

  const body = request.body || {};
  const credits = Number(body.credits);

  if (!Number.isInteger(credits) || credits < 1 || credits > MAX_CREDITS) {
    return sendJson(response, 400, {
      error: `Add between 1 and ${MAX_CREDITS} credits.`,
    });
  }

  const reference = typeof body.code === "string" && body.code.trim()
    ? body.code.trim()
    : typeof body.batchId === "string"
      ? body.batchId.trim()
      : "";

  if (!reference) {
    return sendJson(response, 400, { error: "Paste a credit code, short code, or batch ID." });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Try short code first (12-char alphanumeric), then fall back to code/batch ID lookup
    let existing = null;
    if (/^[A-Z0-9]{12}$/i.test(reference)) {
      existing = await findBatchByShortCode(supabase, reference);
    }
    if (!existing) {
      existing = await findBatchByCodeOrId(supabase, reference);
    }
    if (!existing) {
      return sendJson(response, 404, { error: "No credit code matches that code or ID." });
    }

    const result = await topUpCreditBatch(supabase, {
      batchId: existing.id,
      credits,
      adminEmail: auth.user.email || auth.user.id,
      note: cleanNote(body.note),
    });

    if (!result.ok) {
      if (result.reason === "missing") {
        return sendJson(response, 404, { error: "No credit code matches that code or ID." });
      }
      return sendJson(response, 400, { error: "Could not add that many credits." });
    }

    const batch = result.batch;
    return sendJson(response, 200, {
      batchId: batch.id,
      code: batch.code,
      shortCode: batch.short_code,
      creditsAdded: credits,
      creditsTotal: batch.credits_total,
      creditsUsed: batch.credits_used,
      creditsRemaining: batch.credits_total - batch.credits_used,
      creditsGranted: batch.credits_granted,
      daysPerCredit: batch.days_per_credit,
      amountPaise: batch.amount_paise,
      addedBy: auth.user.email || auth.user.id,
    });
  } catch (error) {
    return sendJson(response, 502, { error: error.message });
  }
};
