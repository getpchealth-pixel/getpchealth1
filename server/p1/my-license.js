const { getSupabaseAdmin, normalizeMachineId, sendJson } = require("./_helpers");

/**
 * Returns this machine's current licence, so a renewal or an admin grant reaches
 * the desktop app on its next check.
 *
 * Public by necessity: the app has no account, only a machine id. This is safe
 * because the returned key is signed over that machine id, so it cannot unlock any
 * other machine - the desktop app compares it against its own MachineGuid before
 * accepting it. The only thing this reveals is that a given machine holds a live
 * licence, which is not itself sensitive.
 *
 * Expired and archived licences are reported as inactive rather than returned.
 */
module.exports = async function myLicense(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const machineId = normalizeMachineId((request.body || {}).machineId);
  if (!machineId) {
    return sendJson(response, 400, { error: "A valid machine ID is required." });
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("licenses")
      .select("plan, access_key, expires_at, archived")
      .eq("machine_id", machineId)
      .maybeSingle();
    if (error) throw error;

    if (!data || data.archived || new Date(data.expires_at).getTime() <= Date.now()) {
      return sendJson(response, 200, { active: false, machineId });
    }

    return sendJson(response, 200, {
      active: true,
      machineId,
      plan: data.plan,
      accessKey: data.access_key,
      expiresAt: data.expires_at,
    });
  } catch (error) {
    return sendJson(response, 502, { error: error.message });
  }
};
