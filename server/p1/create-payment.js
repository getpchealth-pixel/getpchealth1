const crypto = require("crypto");
const {
  buildEntitlementNote,
  getPricing,
  getSupabaseAdmin,
  normalizeMachineId,
  razorpayRequest,
  recordPurchase,
  sendJson,
} = require("./_helpers");

function badRequest(response, message) {
  return sendJson(response, 400, { error: message });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(cleaned) ? cleaned : null;
}

module.exports = async function createPayment(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const { kind, credits } = request.body || {};
  if (kind !== "individual" && kind !== "credits") {
    return badRequest(response, 'kind must be "individual" or "credits".');
  }

  // The delivery inbox for the key. Kept on the purchase row so the admin can
  // read it off the dashboard and send the key by hand until automated mail
  // delivery exists.
  const email = normalizeEmail((request.body || {}).email);
  if (!email) return badRequest(response, "A valid email address is required.");

  // Individual access is bound to one machine, so that machine must be known up
  // front. An institutional pack is deliberately not tied to a machine: the buyer
  // has no machine in mind yet, and the pack is activated on N machines later.
  const machineId = normalizeMachineId((request.body || {}).machineId);
  if (kind === "individual" && !machineId) {
    return badRequest(response, "A valid machine ID is required.");
  }

  const pricing = getPricing();

  let entitlement;
  if (kind === "individual") {
    entitlement = {
      kind: "individual",
      amountPaise: pricing.individualAmountPaise,
      days: pricing.individualDays,
      credits: 0,
      perCreditPaise: 0,
    };
  } else {
    const count = Number(credits);
    if (!Number.isInteger(count) || count < pricing.creditMin || count > pricing.creditMax) {
      return badRequest(
        response,
        `Choose between ${pricing.creditMin} and ${pricing.creditMax} credits.`
      );
    }
    entitlement = {
      kind: "credits",
      amountPaise: count * pricing.creditAmountPaise,
      days: pricing.creditDays,
      credits: count,
      perCreditPaise: pricing.creditAmountPaise,
    };
  }

  try {
    const supabase = getSupabaseAdmin();

    // A machine that already holds a live individual licence has nothing to buy.
    // Returning early keeps the dashboard from creating throwaway payment links.
    if (kind === "individual") {
      const { data: existing } = await supabase
        .from("licenses")
        .select("access_key, expires_at")
        .eq("machine_id", machineId)
        .maybeSingle();
      const expiresAt = existing ? new Date(existing.expires_at).getTime() : 0;
      if (existing && expiresAt > Date.now() && !existing.archived) {
        return sendJson(response, 200, {
          alreadyActive: true,
          machineId,
          expiresAt: existing.expires_at,
        });
      }
    }

    // Random per-attempt nonce: keeps reference_id unique across repeat purchases.
    const nonce = crypto.randomBytes(12).toString("hex");
    const referenceId = `gph_${crypto
      .createHash("sha256")
      .update(`${machineId || "pack"}_${entitlement.kind}_${nonce}`)
      .digest("hex")
      .slice(0, 30)}`;

    // `machine_id` is written only for individual purchases. A credit pack has no
    // buyer machine, and the webhook keys off the signed `ent` note to work out
    // what was actually bought.
    const notes = { ent: buildEntitlementNote(entitlement) };
    if (machineId) notes.machine_id = machineId;

    const paymentLink = await razorpayRequest("/v1/payment_links", {
      method: "POST",
      body: JSON.stringify({
        amount: entitlement.amountPaise,
        currency: "INR",
        accept_partial: false,
        description:
          kind === "credits"
            ? `GetPcHealth ${entitlement.credits} institutional credit(s)`
            : `GetPcHealth Pro access - ${entitlement.days} days`,
        reference_id: referenceId,
        notes,
      }),
    });

    // Open the purchase-history row the moment the link exists, so an abandoned
    // checkout is still visible as "created" rather than vanishing. Best-effort:
    // a failure here must never cost the buyer their payment link, and
    // reconcile-purchases.js can back-fill anything this misses.
    try {
      await recordPurchase(supabase, {
        paymentLinkId: paymentLink.id,
        referenceId,
        kind: entitlement.kind,
        status: "created",
        amountPaise: entitlement.amountPaise,
        days: entitlement.days,
        credits: entitlement.credits,
        machineId,
        email,
      });
    } catch {}

    return sendJson(response, 200, {
      kind,
      machineId,
      paymentLinkId: paymentLink.id,
      paymentUrl: paymentLink.short_url,
      qrCodeUrl: `https://quickchart.io/qr?size=240&text=${encodeURIComponent(paymentLink.short_url)}`,
      amountPaise: entitlement.amountPaise,
      days: entitlement.days,
      credits: entitlement.credits,
    });
  } catch (error) {
    return sendJson(response, 502, { error: error.message });
  }
};
