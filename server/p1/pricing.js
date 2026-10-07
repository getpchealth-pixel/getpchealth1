const { getPricing, sendJson } = require("./_helpers");

/**
 * Public price list, so the store front and the app can show the real numbers
 * without hardcoding them. Amounts are paise; the client formats them.
 */
module.exports = async function pricing(request, response) {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST" && request.method !== "GET") {
    return sendJson(response, 405, { error: "Method not allowed." });
  }

  const p = getPricing();
  return sendJson(response, 200, {
    individual: { amountPaise: p.individualAmountPaise, days: p.individualDays },
    credit: {
      amountPaise: p.creditAmountPaise,
      days: p.creditDays,
      min: p.creditMin,
      max: p.creditMax,
    },
  });
};
