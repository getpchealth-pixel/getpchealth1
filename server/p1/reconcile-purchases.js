const {
  getSigningPublicKey,
  getSupabaseAdmin,
  mapPaymentLinkStatus,
  parseEntitlementNote,
  razorpayRequest,
  requireAdmin,
  sendJson,
} = require("./_helpers");

/** Razorpay caps `count` at 100 per page. */
const PAGE_SIZE = 100;
/** Refuse to walk an unbounded history in one request. */
const MAX_PAGES = 20;

/**
 * Walks every payment link we created and folds it into `purchases`.
 *
 * This is what makes the history list trustworthy rather than merely populated:
 * `licenses` overwrites a machine's row on every renewal and keeps only the
 * first `payment_link_id`, so renewals are invisible locally. Razorpay still has
 * every link, and each one carries the entitlement note we signed - so the
 * amount, days and credit count can be re-derived and verified rather than
 * guessed.
 *
 * Idempotent: `payment_link_id` is unique and every write is an upsert, so
 * running this twice changes nothing the second time.
 *
 * Returns a human-readable summary, or `{ ok: false, error }` if Razorpay could
 * not be reached at all.
 */
async function syncWithRazorpay(supabase) {
  const publicKey = getSigningPublicKey();

  const links = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await razorpayRequest(
      `/v1/payment_links?count=${PAGE_SIZE}&skip=${page * PAGE_SIZE}`,
    );
    const items = Array.isArray(body.items) ? body.items : [];
    links.push(...items);
    if (items.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  // Links that are not ours carry no note we signed, so there is nothing to
  // record - and an unsigned note must never be trusted for an amount.
  const ours = [];
  let skipped = 0;
  for (const link of links) {
    const entitlement = parseEntitlementNote(link.notes?.ent, publicKey);
    if (!entitlement) {
      skipped += 1;
      continue;
    }
    if (link.currency !== "INR" || link.amount !== entitlement.amountPaise) {
      skipped += 1;
      continue;
    }
    ours.push({ link, entitlement });
  }

  // Enrich with whatever we issued, so the list can point at the entitlement
  // rather than leaving the admin to search for it by hand.
  const [{ data: batches }, { data: licenses }] = await Promise.all([
    supabase.from("credit_batches").select("id, payment_link_id"),
    supabase.from("licenses").select("id, machine_id, payment_link_id"),
  ]);
  const batchByLink = new Map((batches || []).map((b) => [b.payment_link_id, b.id]));
  const licenseByLink = new Map((licenses || []).map((l) => [l.payment_link_id, l]));

  const rows = ours.map(({ link, entitlement }) => {
    const machineId = String(link.notes?.machine_id || "").toUpperCase() || null;
    const license = licenseByLink.get(link.id);
    return {
      payment_link_id: link.id,
      reference_id: link.reference_id || null,
      kind: entitlement.kind,
      status: mapPaymentLinkStatus(link.status),
      amount_paise: entitlement.amountPaise,
      days: entitlement.days,
      credits: entitlement.credits,
      machine_id: machineId || license?.machine_id || null,
      credit_batch_id: batchByLink.get(link.id) || null,
      license_id: license?.id || null,
      synced: true,
      paid_at: link.status === "paid" ? link.created_at || null : null,
      updated_at: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    // Batched so a long history does not build a multi-thousand-row statement.
    for (let index = 0; index < rows.length; index += 200) {
      const slice = rows.slice(index, index + 200);
      const { error } = await supabase
        .from("purchases")
        .upsert(slice, { onConflict: "payment_link_id" });
      if (error) throw new Error(`Could not save purchase history: ${error.message}`);
    }
  }

  const paid = rows.filter((row) => row.status === "paid").length;
  const summary =
    `read ${links.length} link(s), recorded ${rows.length}, ` +
    `skipped ${skipped} foreign/mismatched, ${paid} paid` +
    (truncated ? `, TRUNCATED at ${MAX_PAGES * PAGE_SIZE} links` : "");
  return { ok: true, summary, scanned: links.length, recorded: rows.length, skipped, paid, truncated };
}

/**
 * Admin action behind the dashboard's "Sync with Razorpay" button.
 */
module.exports = async function reconcilePurchases(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const auth = await requireAdmin(request);
  if (auth.error) return sendJson(response, auth.error.status, { error: auth.error.message });

  try {
    const result = await syncWithRazorpay(getSupabaseAdmin());
    if (!result.ok) return sendJson(response, 502, { error: result.error });
    console.log(`[purchases] reconcile by ${auth.user.email}: ${result.summary}`);
    return sendJson(response, 200, result);
  } catch (error) {
    return sendJson(response, 502, { error: error.message });
  }
};

// Shared with purchases.js, which reconciles on a cold start.
module.exports.syncWithRazorpay = syncWithRazorpay;
