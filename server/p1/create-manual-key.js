const {
  getSupabaseAdmin,
  issueOrExtendLicense,
  normalizeMachineId,
  requireAdmin,
  sendJson,
} = require("./_helpers");

/**
 * Issues a licence by hand, e.g. a replacement machine or a support fix.
 * Grants `days` days from the machine's current expiry, or never expires when
 * `days` is 0.
 */
module.exports = async function createManualKey(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  const auth = await requireAdmin(request);
  if (auth.error) return sendJson(response, auth.error.status, { error: auth.error.message });

  const { days } = request.body || {};
  const machineId = normalizeMachineId((request.body || {}).machineId);
  const duration = days === undefined || days === null || days === 0 ? 0 : Number(days);
  if (!machineId || !Number.isInteger(duration) || duration < 0 || duration > 3650) {
    return sendJson(response, 400, {
      error: "A valid machine ID (the MachineGuid) and a day count between 0 and 3650 are required.",
    });
  }

  try {
    const reference = `manual_${auth.user.id}_${Date.now()}`;
    const license = await issueOrExtendLicense(getSupabaseAdmin(), {
      machineId,
      plan: "manual",
      reference,
      days: duration,
      neverExpires: duration === 0,
    });

    return sendJson(response, 200, {
      machineId,
      accessKey: license.access_key,
      expiresAt: license.expires_at,
      neverExpires: duration === 0,
      issuedBy: auth.user.email,
    });
  } catch (error) {
    return sendJson(response, 502, { error: error.message });
  }
};
