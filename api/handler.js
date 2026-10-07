const routes = require("../server/p1/routes");
const { sendJson } = require("../server/p1/_helpers");

/**
 * The one and only Serverless Function in this deployment.
 *
 * Vercel builds a function per file in `api/`, and the Hobby plan allows twelve.
 * The payment API has thirteen endpoints, so the build failed outright. Rather
 * than merging endpoints by hand - which would have meant changing URLs the
 * desktop app and the dashboard already call - every endpoint is reached through
 * this dispatcher and the handlers moved to `server/`.
 *
 * Vercel matches `rewrites` in order and a rewrite does not change the path the
 * function observes, so `request.url` still carries the original `/api/p1/...`
 * path. `vercel.json` sends the whole namespace here:
 *
 *   { "source": "/api/p1/:path*", "destination": "/api/handler" }
 *
 * Handlers receive the untouched Vercel request, so `request.body`,
 * `request.query` and `request.headers` behave exactly as they did when each
 * handler was its own function.
 */

/** Strips the query string and decodes the path. Never throws. */
function readPath(request) {
  const url = request.url || "/";
  const pathname = url.split("?")[0].split("#")[0];
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** The endpoint name is the last non-empty segment: `/api/p1/pricing` -> `pricing`. */
function readRouteName(request) {
  const segments = readPath(request).split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : "";
}

module.exports = async function handler(request, response) {
  const name = readRouteName(request);
  const route = Object.prototype.hasOwnProperty.call(routes, name) ? routes[name] : null;

  if (!route) {
    return sendJson(response, 404, {
      error: "Unknown API endpoint.",
      available: Object.keys(routes).sort(),
    });
  }

  return route(request, response);
};
