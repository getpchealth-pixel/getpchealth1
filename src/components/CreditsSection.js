import { useEffect, useState } from "react";
import AccessPurchase from "./AccessPurchase";
import "./CreditsSection.css";

const DEFAULT_API_BASE = process.env.REACT_APP_PAYMENT_API_URL || "/api/p1";
const PRESET_PACKS = [5, 10, 30, 50, 100];

function rupees(paise) {
  if (!Number.isFinite(paise)) return "—";
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Institutional store front: buy a block of credits, receive one transferable
 * key, and hand it to each user. Every activation spends a single credit.
 */
function CreditsSection({ apiBase = DEFAULT_API_BASE }) {
  const [pricing, setPricing] = useState(null);
  const [pack, setPack] = useState(30);
  const [custom, setCustom] = useState("");
  const [lookupKey, setLookupKey] = useState("");
  const [lookup, setLookup] = useState(null);
  const [lookupError, setLookupError] = useState("");
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`${apiBase.replace(/\/$/, "")}/pricing`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data) setPricing(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiBase]);

  const min = pricing ? pricing.credit.min : 1;
  const max = pricing ? pricing.credit.max : 500;
  const unit = pricing ? pricing.credit.amountPaise : NaN;
  const days = pricing ? pricing.credit.days : 30;

  const chosen = custom === "" ? pack : Number(custom);
  const chosenValid = Number.isInteger(chosen) && chosen >= min && chosen <= max;

  const checkKey = async (event) => {
    event.preventDefault();
    setLookupError("");
    setLookup(null);
    setLookingUp(true);
    try {
      const response = await fetch(`${apiBase.replace(/\/$/, "")}/credit-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: lookupKey.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read that key.");
      setLookup(data);
    } catch (error) {
      setLookupError(error.message || "Could not read that key.");
    } finally {
      setLookingUp(false);
    }
  };

  return (
    <section id="credits" className="credits">
      <h2 className="section-title">How institutional credits work</h2>
      <p className="section-sub">
        Buying for a classroom, a lab or a repair bench? You buy a pack of
        credits once and receive a single key. Share that key with your team.
        Every time someone enters it in GetPcHealth, one credit is spent and
        that machine gets {days} days of Pro. No machine ID is needed to buy,
        and you can check the remaining balance whenever you like.
      </p>

      <ul className="credits-facts">
        <li>
          <b>1 credit</b>
          <span>
            unlocks {days} days of Pro on one machine
          </span>
        </li>
        <li>
          <b>1 key</b>
          <span>shared by everyone in your team</span>
        </li>
        <li>
          <b>1 payment</b>
          <span>buy the whole pack upfront by UPI</span>
        </li>
        <li>
          <b>Balance</b>
          <span>checked online any time</span>
        </li>
      </ul>

      <div className="credits-grid">
        <div className="credits-picker">
          <h3>1. Choose a pack</h3>
          <div className="pack-row">
            {PRESET_PACKS.map((n) => (
              <button
                key={n}
                type="button"
                className={`pack${custom === "" && pack === n ? " pack-active" : ""}`}
                onClick={() => {
                  setPack(n);
                  setCustom("");
                }}
              >
                <b>{n}</b>
                <span>{rupees(unit * n)}</span>
              </button>
            ))}
          </div>
          <label className="pack-custom" htmlFor="custom-credits">
            Or enter an exact number
            <input
              id="custom-credits"
              type="number"
              min={min}
              max={max}
              value={custom}
              placeholder={String(pack)}
              onChange={(event) => setCustom(event.target.value)}
            />
          </label>
          <p className="pack-summary">
            {chosenValid ? (
              <>
                <b>{chosen}</b> credit{chosen === 1 ? "" : "s"} ·{" "}
                {rupees(unit * chosen)} total · {rupees(unit)} each
              </>
            ) : (
              `Enter a whole number between ${min} and ${max}.`
            )}
          </p>
        </div>

        <div className="credits-buy">
          <h3>2. Pay and get your key</h3>
          {chosenValid ? (
            <AccessPurchase
              kind="credits"
              credits={chosen}
              apiBase={apiBase}
              onComplete={() => setLookup("")}
            />
          ) : (
            <p className="credits-idle">Pick a pack size to continue.</p>
          )}
        </div>
      </div>

      <div className="credits-lookup">
        <h3>Check how many credits are left</h3>
        <form onSubmit={checkKey}>
          <input
            value={lookupKey}
            onChange={(event) => setLookupKey(event.target.value)}
            placeholder="Paste your gphc- credit key"
            spellCheck="false"
            required
          />
          <button type="submit" disabled={lookingUp}>
            {lookingUp ? "Checking..." : "Check remaining"}
          </button>
        </form>
        {lookup && (
          <p className="lookup-result" aria-live="polite">
            <b>
              {lookup.creditsRemaining} of {lookup.creditsTotal} credits left
            </b>{" "}
            · {lookup.daysPerCredit} days per credit · bought{" "}
            {new Date(lookup.purchasedAt).toLocaleDateString()}
          </p>
        )}
        {lookupError && (
          <p className="buy-error" role="alert">
            {lookupError}
          </p>
        )}
      </div>

      <ol className="credits-steps">
        <li>
          <b>Buy a pack.</b> Choose a size and pay by UPI. No machine ID is
          needed.
        </li>
        <li>
          <b>Copy the key.</b> One key covers the whole pack and looks like
          gphc-.
        </li>
        <li>
          <b>Share the key.</b> Each user opens GetPcHealth and pastes it under
          &ldquo;I have a credit key&rdquo;.
        </li>
        <li>
          <b>One credit is spent.</b> That machine unlocks for {days} days of
          Pro. Repeat whenever it expires.
        </li>
        <li>
          <b>Check the balance.</b> See how many credits are left using the box
          above.
        </li>
      </ol>
    </section>
  );
}

export default CreditsSection;
