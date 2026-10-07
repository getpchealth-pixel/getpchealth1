require("dotenv").config();

const express = require("express");

// Handlers live in `server/`, not `api/`, so Vercel does not build each one into
// its own Serverless Function - the Hobby plan allows twelve and the API has
// thirteen endpoints. See api/handler.js.
const p1 = (name) => require(`./server/p1/${name}`);

const app = express();
const jsonBody = express.json();

const PORT = Number(process.env.LOCAL_API_PORT || 4001);

app.use("/api/p1/create-manual-key", jsonBody, p1("create-manual-key"));
app.use("/api/p1/create-manual-credit", jsonBody, p1("create-manual-credit"));
app.use("/api/p1/create-payment", jsonBody, p1("create-payment"));
app.use("/api/p1/manage-record", jsonBody, p1("manage-record"));
app.use("/api/p1/topup-credit", jsonBody, p1("topup-credit"));
app.use("/api/p1/verify-payment", jsonBody, p1("verify-payment"));
app.use("/api/p1/redeem-credit", jsonBody, p1("redeem-credit"));
app.use("/api/p1/credit-info", jsonBody, p1("credit-info"));
app.use("/api/p1/my-license", jsonBody, p1("my-license"));
app.use("/api/p1/purchases", p1("purchases"));
app.use("/api/p1/reconcile-purchases", jsonBody, p1("reconcile-purchases"));
app.use("/api/p1/pricing", p1("pricing"));
app.use("/api/p1/webhook", p1("webhook"));

app.use((_req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, _req, res, _next) => {
  const status = err && err.status ? err.status : 500;
  const message = err && err.type === "entity.parse.failed" ? "Invalid JSON body." : err.message;
  res.status(status).json({ error: message || "Internal error." });
});

const server = app.listen(PORT, () => {
  console.log(`Local GetPcHealth API server running on http://localhost:${PORT}`);
  console.log([
    "  POST /api/p1/create-manual-key  (admin)",
    "  POST /api/p1/create-manual-credit (admin)",
    "  POST /api/p1/create-payment",
    "  POST /api/p1/manage-record      (admin)",
    "  POST /api/p1/topup-credit       (admin)",
    "  POST /api/p1/verify-payment",
    "  POST /api/p1/redeem-credit",
    "  POST /api/p1/credit-info",
    "  POST /api/p1/my-license",
    "  GET  /api/p1/purchases          (admin)",
    "  POST /api/p1/reconcile-purchases (admin)",
    "  GET  /api/p1/pricing",
    "  POST /api/p1/webhook           (Razorpay)",
  ].join("\n"));
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Set LOCAL_API_PORT in .env to use another port.`);
    process.exit(1);
  }
  throw error;
});

module.exports = app;