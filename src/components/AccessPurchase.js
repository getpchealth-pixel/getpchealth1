import { useEffect, useRef, useState } from "react";
import "./AccessPurchase.css";

const DEFAULT_API_BASE = process.env.REACT_APP_PAYMENT_API_URL || "/api/p1";
const POLL_INTERVAL_MS = 4000;
const POLL_MAX_DURATION_MS = 10 * 60 * 1000;
const MACHINE_ID_PATTERN = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function rupees(paise) {
  if (!Number.isFinite(paise)) return "";
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

async function postJson(base, path, body) {
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let result = null;
  try {
    result = await response.json();
  } catch {
    /* fall through to the status check below */
  }
  return { ok: response.ok, status: response.status, result: result || {} };
}

async function fetchPricing(base) {
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/pricing`, { method: "GET" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Drives one purchase: creates a Razorpay payment link, shows the QR, then polls
 * until Razorpay reports the link as paid.
 *
 * Two products share this flow, and they differ in what they ask the buyer for:
 *   kind="individual" -> asks for a machine ID, returns an `accessKey` for that
 *                        one machine
 *   kind="credits"    -> asks for nothing, returns a transferable `code` holding
 *                        N credits that are activated on machines later
 *
 * The amount and duration shown always come from the server response, so a price
 * change on the backend is reflected without touching this file.
 */
function AccessPurchase({
  kind = "individual",
  credits = 1,
  apiBase = DEFAULT_API_BASE,
  machineId: controlledMachineId,
  onMachineIdChange,
  onComplete,
  embedded = false,
}) {
  const [internalMachineId, setInternalMachineId] = useState("");
  const [email, setEmail] = useState("");
  const [payment, setPayment] = useState(null);
  const [result, setResult] = useState(null);
  const [alreadyActive, setAlreadyActive] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [pricing, setPricing] = useState(null);
  const pollTimer = useRef(null);

  useEffect(() => {
    let active = true;
    fetchPricing(apiBase).then((data) => {
      if (active) setPricing(data);
    });
    return () => {
      active = false;
    };
  }, [apiBase]);

  const isCredits = kind === "credits";

  const controlled = controlledMachineId !== undefined;
  const machineId = controlled ? controlledMachineId : internalMachineId;
  const setMachineId = (value) => {
    if (!controlled) setInternalMachineId(value);
    if (onMachineIdChange) onMachineIdChange(value);
  };

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    setCheckingPayment(false);
  };

  useEffect(() => stopPolling, []);

  useEffect(() => {
    if (!payment) return undefined;

    const startedAt = Date.now();
    setCheckingPayment(true);
    setError("");

    const verifyNow = async () => {
      const { ok, status, result: body } = await postJson(apiBase, "/verify-payment", {
        // Credit packs are not tied to a buyer machine, so nothing is sent.
        ...(isCredits ? {} : { machineId: payment.machineId }),
        paymentLinkId: payment.paymentLinkId,
      }).catch((requestError) => {
        stopPolling();
        setError(requestError.message || "Could not reach the payment server.");
        return { ok: false, status: 0, result: {} };
      });

      if (ok) {
        stopPolling();
        setResult(body);
        setCopied(false);
        if (onComplete) onComplete(body);
        return;
      }

      // 409 means Razorpay has not marked the link paid yet - keep waiting.
      if (status === 409) {
        if (Date.now() - startedAt >= POLL_MAX_DURATION_MS) {
          stopPolling();
          setError("Payment was not detected automatically. Use the check button below.");
        }
        return;
      }

      stopPolling();
      setError(body.error || "Could not verify payment.");
    };

    verifyNow();
    pollTimer.current = setInterval(verifyNow, POLL_INTERVAL_MS);
    return stopPolling;
    // `isCredits` is derived from `kind`, which never changes for a mounted panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment, retryNonce, apiBase, onComplete]);

  const createPayment = async (event) => {
    event.preventDefault();
    const clean = machineId.trim();
    const cleanEmail = email.trim().toLowerCase();
    setError("");
    setResult(null);
    setPayment(null);
    setAlreadyActive(null);
    setCopied(false);

    if (!EMAIL_PATTERN.test(cleanEmail)) {
      setError("Enter the email address the key should be sent to.");
      return;
    }

    if (!isCredits && !MACHINE_ID_PATTERN.test(clean.toUpperCase())) {
      setError(
        "Enter the MachineGuid shown in GetPcHealth on that PC, in the form " +
          "4C4C4544-0043-3510-8052-B7C04F503332."
      );
      return;
    }

    setLoading(true);
    try {
      const body = isCredits
        ? { kind, credits, email: cleanEmail }
        : { machineId: clean, kind, email: cleanEmail };
      const { ok, result: payload } = await postJson(apiBase, "/create-payment", body);
      if (!ok) throw new Error(payload.error || "Could not create payment.");

      if (payload.alreadyActive) {
        setAlreadyActive(payload);
        return;
      }
      setPayment({ ...payload, machineId: clean });
    } catch (requestError) {
      setError(requestError.message || "Could not create payment.");
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async () => {
    const value = result && (result.code || result.accessKey);
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError("Could not copy automatically. Select the key and copy it manually.");
    }
  };

  const headline = isCredits
    ? `${payment ? payment.credits : credits} institutional credit${(payment ? payment.credits : credits) === 1 ? "" : "s"}`
    : "Pro access";

  return (
    <section className={`buy-panel${embedded ? " buy-embedded" : ""}`}>
      <form className="buy-form" onSubmit={createPayment}>
        <label htmlFor={`buy-email-${kind}`}>Email</label>
        <input
          id={`buy-email-${kind}`}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          spellCheck="false"
          required
        />
        <p className="buy-hint">
          Tied to your order so your key can be sent to this address if needed.
        </p>
        {isCredits ? (
          <>
            <p className="buy-hint buy-hint-lead">
              One key covers every machine you activate -
              each user pastes it into GetPcHealth app and one credit is used.
            </p>
          </>
        ) : (
          <>
            <label htmlFor={`buy-machine-${kind}`}>Machine ID</label>
            <input
              id={`buy-machine-${kind}`}
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
              placeholder="4C4C4544-0043-3510-8052-B7C04F503332"
              autoComplete="off"
              spellCheck="false"
              required
            />
            <p className="buy-hint">
              Your machine ID comes from GetPcHealth on this PC, under Settings.
              Access is tied to it and cannot be moved.
            </p>
          </>
        )}
        <button type="submit" disabled={loading || !!payment}>
          {loading
            ? "Preparing..."
            : isCredits
            ? `Pay ${rupees((pricing ? pricing.credit.amountPaise : NaN) * credits)} for ${credits} credit${credits === 1 ? "" : "s"}`
            : `Continue — ${rupees(pricing ? pricing.individual.amountPaise : NaN)}`}
        </button>
      </form>

      {alreadyActive && (
        <div className="buy-success" aria-live="polite">
          <p className="buy-kicker">Already active</p>
          <p>
            This machine has Pro access until{" "}
            <strong>{new Date(alreadyActive.expiresAt).toLocaleString()}</strong>.
          </p>
        </div>
      )}

      {payment && (
        <div className="buy-payment" aria-live="polite">
          <div className="buy-payment-head">
            <p className="buy-kicker">{headline}</p>
            <p className="buy-price">
              {isCredits ? (
                <>
                  <span>{rupees(payment.amountPaise)}</span> for {payment.credits} credit
                  {payment.credits === 1 ? "" : "s"}
                </>
              ) : (
                <span>{rupees(payment.amountPaise)}</span>
              )}
            </p>
            <p>
              {isCredits
                ? `Each credit unlocks one machine for ${payment.daysPerCredit || payment.days} days.`
                : `Unlocks this machine for ${payment.days} days.`}
            </p>
            <p className="buy-status">
              {checkingPayment
                ? "Waiting for your payment to complete..."
                : "Scan with any UPI app to pay."}
            </p>
          </div>
          {payment.qrCodeUrl ? (
            <img className="buy-qr" src={payment.qrCodeUrl} alt="Payment QR code" />
          ) : (
            <a className="buy-link" href={payment.paymentUrl} target="_blank" rel="noreferrer">
              Open payment page
            </a>
          )}
          {!result && (
            <button
              type="button"
              className="buy-verify"
              onClick={() => setRetryNonce((n) => n + 1)}
              disabled={checkingPayment}
            >
              {checkingPayment ? "Checking..." : "Check payment status"}
            </button>
          )}
        </div>
      )}

      {result && (
        <div className="buy-success" aria-live="polite">
          <p className="buy-kicker">{isCredits ? "Credit key ready" : "Pro access active"}</p>
          {isCredits ? (
            <>
              <p>
                Copy this key now and keep it safe. Each machine that activates it
                spends 1 of your {result.credits} credits and gets{" "}
                {result.daysPerCredit} days of Pro access. You can check the
                remaining balance any time.
              </p>
              <code className="buy-code">{result.code}</code>
            </>
          ) : (
            <>
              <p>
                Active until <strong>{new Date(result.expiresAt).toLocaleString()}</strong>.
                Open GetPcHealth on this machine and it unlocks automatically.
              </p>
              <code className="buy-code">{result.accessKey}</code>
            </>
          )}
          <div className="buy-actions">
            <button type="button" onClick={copyCode}>
              {copied ? "Copied" : "Copy key"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="buy-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export default AccessPurchase;
