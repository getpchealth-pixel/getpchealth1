const {
  getSupabaseAdmin,
  requireAdmin,
  sanitizeSearchTerm,
  sendJson,
} = require("./_helpers");

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const STATUSES = new Set(["created", "paid", "failed", "refunded"]);

function readPaging(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const requested = Number(query.pageSize) || PAGE_SIZE;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isInteger(requested) ? requested : PAGE_SIZE));
  return { page, pageSize, from: (page - 1) * pageSize, to: (page - 1) * pageSize + pageSize - 1 };
}

/**
 * Purchase history, newest first.
 *
 * Read through the API rather than the browser client for two reasons: the
 * summary needs the service role to run `purchase_summary()`, and reconciling
 * with Razorpay needs the API key, so both live on this side of the same screen.
 *
 * An empty table is not trusted as "no sales" - it may simply never have been
 * reconciled. When there is nothing to show, we sync once before answering, so
 * the first person to open this screen after a deploy sees real history.
 */
module.exports = async function listPurchases(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "GET" && request.method !== "POST") {
    return sendJson(response, 405, { error: "Method not allowed." });
  }

  const auth = await requireAdmin(request);
  if (auth.error) return sendJson(response, auth.error.status, { error: auth.error.message });

  const query = request.query || {};
  const { page, pageSize, from, to } = readPaging(query);
  const search = sanitizeSearchTerm(query.search);
  const status = STATUSES.has(String(query.status || "").toLowerCase())
    ? String(query.status).toLowerCase()
    : null;

  try {
    const supabase = getSupabaseAdmin();

    const { count, error: countError } = await supabase
      .from("purchases")
      .select("payment_link_id", { count: "exact", head: true });
    if (countError) throw countError;
    if (!count) {
      // Cold start: back-fill from Razorpay so the list is not blank.
      // A failure here is not fatal - the table may genuinely be empty.
      try {
        const reconcile = require("./reconcile-purchases");
        const { syncWithRazorpay } = reconcile;
        if (typeof syncWithRazorpay === "function") {
          const outcome = await syncWithRazorpay(supabase);
          console.log(`[purchases] cold-start reconcile: ${outcome.summary}`);
        }
      } catch (syncError) {
        console.error(`[purchases] cold-start reconcile failed: ${syncError.message}`);
      }
    }

    let request_ = supabase
      .from("purchases")
      .select(
        "id, payment_link_id, reference_id, kind, status, amount_paise, days, credits, machine_id, email, credit_batch_id, license_id, razorpay_payment_id, synced, paid_at, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status) request_ = request_.eq("status", status);
    if (search) {
      request_ = request_.or(
        `machine_id.ilike.*${search}*,email.ilike.*${search}*,payment_link_id.ilike.*${search}*,razorpay_payment_id.ilike.*${search}*,reference_id.ilike.*${search}*`,
      );
    }

    const { data, error, count: total } = await request_;
    if (error) throw error;

    const { data: summaryRows, error: summaryError } = await supabase.rpc("purchase_summary");
    if (summaryError) {
      // Totals are decoration; the list still works without them.
      console.error(`[purchases] summary failed: ${summaryError.message}`);
    }
    const summary = (summaryRows && summaryRows[0]) || null;

    return sendJson(response, 200, {
      rows: data || [],
      count: total || 0,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil((total || 0) / pageSize)),
      summary,
    });
  } catch (error) {
    // Deploys can land the handlers before the migration. Say so plainly rather
    // than surfacing "relation public.purchases does not exist".
    if (/purchases|purchase_summary|credit_topups|topup_credit_batch/i.test(error.message || "") &&
        /does not exist|not found|schema cache/i.test(error.message || "")) {
      return sendJson(response, 503, {
        error: "Purchase history is unavailable: the database migration has not been applied yet.",
      });
    }
    return sendJson(response, 502, { error: error.message });
  }
};
