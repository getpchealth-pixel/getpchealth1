const { getSupabaseAdmin, requireAdmin, sendJson } = require("./_helpers");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = ["delete"];

module.exports = async function manageBatch(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const auth = await requireAdmin(request);
  if (auth.error) return sendJson(response, auth.error.status, { error: auth.error.message });

  const { action, batchId } = request.body || {};
  if (!ACTIONS.includes(action) || !UUID_PATTERN.test(batchId || "")) {
    return sendJson(response, 400, { error: "A valid action and batch ID are required." });
  }

  const supabase = getSupabaseAdmin();

  try {
    if (action === "delete") {
      const { data: batch, error: batchError } = await supabase
        .from("credit_batches")
        .select("id, credits_used")
        .eq("id", batchId)
        .maybeSingle();
      if (batchError) throw new Error(`Could not find credit batch: ${batchError.message}`);
      if (!batch) {
        return sendJson(response, 404, { error: "Credit batch not found." });
      }
      if (batch.credits_used > 0) {
        return sendJson(response, 400, { error: "Cannot delete a credit batch that has been used." });
      }

      const { error: deleteError } = await supabase
        .from("credit_batches")
        .delete()
        .eq("id", batchId);
      if (deleteError) throw new Error(`Could not delete credit batch: ${deleteError.message}`);

      return sendJson(response, 200, { ok: true, deleted: true, batchId });
    }
  } catch (error) {
    return sendJson(response, 502, { error: error.message });
  }
};