/**
 * Every `/api/p1/*` endpoint, as one table.
 *
 * These handlers used to be individual files under `api/`, which is what Vercel
 * turns into Serverless Functions - one per file. At thirteen of them that
 * overran the Hobby plan's hard limit of twelve, and the build failed before a
 * single request could be served.
 *
 * They now live outside `api/` and are reached through the single dispatcher in
 * `api/handler.js`, so the deployment carries one function and the URL space is
 * no longer a constraint on how many endpoints the API may have.
 *
 * The key is the last path segment, which is how the dispatcher identifies the
 * route. Handlers are plain `(request, response)` middleware and are shared
 * verbatim with the local dev server in `api-server.js`.
 */
const routes = {
  "create-manual-key": require("./create-manual-key"),
  "create-manual-credit": require("./create-manual-credit"),
  "create-payment": require("./create-payment"),
  "manage-record": require("./manage-record"),
  "manage-batch": require("./manage-batch"),
  "topup-credit": require("./topup-credit"),
  "verify-payment": require("./verify-payment"),
  "redeem-credit": require("./redeem-credit"),
  "credit-info": require("./credit-info"),
  "my-license": require("./my-license"),
  purchases: require("./purchases"),
  "reconcile-purchases": require("./reconcile-purchases"),
  pricing: require("./pricing"),
  webhook: require("./webhook"),
};

module.exports = routes;
