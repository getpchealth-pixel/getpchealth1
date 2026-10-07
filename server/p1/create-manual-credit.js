const crypto = require("crypto");
const {
  createCreditCode,
  getKeyFingerprint,
  getSupabaseAdmin,
  requireAdmin,
  sendJson,
} = require("./_helpers");

/** Matches the ceiling the `credits_granted <= credits_total` CHECK implies. */
const MAX_CREDITS = 100000;
const MAX_DAYS = 3650;
const MAX_NOTE = 200;

function cleanNote(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_NOTE);
  return trimmed || null;
}

/**
 * Issues a credit code by hand, with any credit count the owner wants.
 *
 * The counterpart to `create-manual-key`: a giveaway, a reseller allocation, a
 * good-will replacement for a pack that was lost. There is no payment, so the
 * pack is stored with `source = 'manual'` and ₹0 in both money columns, and
 * `created_by` records who pressed the button.
 *
 * The code is minted with the same signed format as a purchased pack, so the
 * customer redeems it through exactly the same path in the desktop app.
 */
module.exports = async function createManualCredit(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const auth = await requireAdmin(request);
  if (auth.error) return sendJson(response, auth.error.status, { error: auth.error.message });

  const body = request.body || {};
  const credits = Number(body.credits);
  const days = body.days === undefined || body.days === null || body.days === "" ? 30 : Number(body.days);

  if (!Number.isInteger(credits) || credits < 1 || credits > MAX_CREDITS) {
    return sendJson(response, 400, {
      error: `Credits must be a whole number between 1 and ${MAX_CREDITS}.`,
    });
  }
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return sendJson(response, 400, {
      error: `Days per credit must be a whole number between 1 and ${MAX_DAYS}.`,
    });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Mint the id up front: it is both the primary key and the value the code's
    // signature commits to, so the two can never drift apart.
    const batchId = crypto.randomUUID();
    const { longCode, shortCode } = createCreditCode(batchId, credits, crypto.randomBytes(12).toString("hex"));
    const note = cleanNote(body.note);

    const { data, error } = await supabase
      .from("credit_batches")
      .insert({
        id: batchId,
        code: longCode,
        short_code: shortCode,
        code_fingerprint: getKeyFingerprint(),
        credits_total: credits,
        credits_used: 0,
        days_per_credit: days,
        // Complimentary: no money was taken, so the receipt is zero and the
        // per-credit price is zero. Both columns stay NOT NULL on purpose.
        amount_paise: 0,
        price_per_credit_paise: 0,
        payment_link_id: null,
        purchaser_machine_id: null,
        source: "manual",
        credits_granted: 0,
        created_by: auth.user.email || auth.user.id,
        note,
      })
      .select("id, code, short_code, credits_total, credits_used, days_per_credit, amount_paise, source, note, created_at")
      .single();

    if (error) throw new Error(`Could not create the credit code: ${error.message}`);

    return sendJson(response, 200, {
      batchId: data.id,
      code: data.code,
      shortCode: data.short_code,
      credits: data.credits_total,
      daysPerCredit: data.days_per_credit,
      amountPaise: 0,
      source: data.source,
      note: data.note,
      createdBy: auth.user.email || auth.user.id,
      createdAt: data.created_at,
    });
  } catch (error) {
    return sendJson(response, 502, { error: error.message });
  }
};
