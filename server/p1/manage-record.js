const { getSupabaseAdmin, requireAdmin, sendJson } = require("./_helpers");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = ["archive", "unarchive", "delete"];

module.exports = async function manageRecord(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const auth = await requireAdmin(request);
  if (auth.error) return sendJson(response, auth.error.status, { error: auth.error.message });

  const { action, recordId } = request.body || {};
  if (!ACTIONS.includes(action) || !UUID_PATTERN.test(recordId || "")) {
    return sendJson(response, 400, { error: "A valid action and record ID are required." });
  }

  const supabase = getSupabaseAdmin();

  try {
    if (action === "delete") {
      const { data: removed, error } = await supabase
        .from("licenses")
        .delete()
        .eq("id", recordId)
        .select("id");
      if (error) throw new Error(`Could not delete licence: ${error.message}`);
      if (!removed || removed.length === 0) {
        return sendJson(response, 404, { error: "Licence not found." });
      }
      return sendJson(response, 200, { ok: true, deleted: true, recordId });
    }

    const { data: record, error } = await supabase
      .from("licenses")
      .update({ archived: action === "archive", updated_at: new Date().toISOString() })
      .eq("id", recordId)
      .select("id, machine_id, plan, access_key, expires_at, archived")
      .single();
    if (error) throw new Error(`Could not update licence: ${error.message}`);
    if (!record) return sendJson(response, 404, { error: "Licence not found." });

    return sendJson(response, 200, { ok: true, archived: record.archived, record });
  } catch (error) {
    return sendJson(response, 502, { error: error.message });
  }
};
