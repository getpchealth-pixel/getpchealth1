import "./Dashboard.css";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import supabase from "../lib/supabaseClient";
import AccessPurchase from "../components/AccessPurchase";
import Info from "./Info";

const PAGE_SIZE = 50;
const PACK_PAGE_SIZE = 25;
const PURCHASE_PAGE_SIZE = 25;

/**
 * Mirrors `sanitizeSearchTerm` on the server. The browser client queries PostgREST
 * directly, so the `.or()` filter string is built here and must not be able to
 * break out of the filter with commas, parentheses or wildcards.
 */
function sanitizeSearch(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/[,()*%\\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function shortCode(value) {
  if (!value) return "—";
  return value.length > 28 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

function planLabel(plan) {
  if (plan === "credit") return "Credit";
  if (plan === "manual") return "Manual";
  return "Individual";
}

function rupees(paise) {
  return `₹${(Number(paise || 0) / 100).toFixed(2)}`;
}

function statusLabel(status) {
  if (status === "paid") return "Paid";
  if (status === "created") return "Awaiting payment";
  if (status === "refunded") return "Refunded";
  if (status === "failed") return "Failed";
  return status || "Unknown";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState("");
  const [manualMachineId, setManualMachineId] = useState("");
  const [manualDays, setManualDays] = useState("90");
  const [manualKey, setManualKey] = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState("");
  const [licenses, setLicenses] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [managingId, setManagingId] = useState(null);
  const [managingBatchId, setManagingBatchId] = useState(null);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [batches, setBatches] = useState([]);
  const [batchesError, setBatchesError] = useState("");
  const [manualCredits, setManualCredits] = useState("10");
  const [manualCreditDays, setManualCreditDays] = useState("30");
  const [manualCreditNote, setManualCreditNote] = useState("");
  const [manualCreditCode, setManualCreditCode] = useState("");
  const [manualCreditShortCode, setManualCreditShortCode] = useState("");
  const [manualCreditLoading, setManualCreditLoading] = useState(false);
  const [manualCreditError, setManualCreditError] = useState("");
  const [topupTarget, setTopupTarget] = useState(null);
  const [topupCredits, setTopupCredits] = useState("5");
  const [topupNote, setTopupNote] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupError, setTopupError] = useState("");
  const [topupResult, setTopupResult] = useState("");
  // The paste-a-code form keeps its own state so a result from the row panel
  // (or vice versa) never appears next to the other form's inputs.
  const [topupByCodeValue, setTopupByCodeValue] = useState("");
  const [topupByCodeCredits, setTopupByCodeCredits] = useState("5");
  const [topupByCodeLoading, setTopupByCodeLoading] = useState(false);
  const [topupByCodeError, setTopupByCodeError] = useState("");
  const [topupByCodeResult, setTopupByCodeResult] = useState("");
  const [purchases, setPurchases] = useState([]);
  const [purchaseCount, setPurchaseCount] = useState(0);
  const [purchasePage, setPurchasePage] = useState(1);
  const [purchaseStatus, setPurchaseStatus] = useState("");
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [purchaseQuery, setPurchaseQuery] = useState("");
  const [purchaseSummary, setPurchaseSummary] = useState(null);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [purchasesError, setPurchasesError] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [reconcileNote, setReconcileNote] = useState("");

  useEffect(() => {
    let active = true;
    if (!supabase) return undefined;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setUserEmail(data.user?.email || "");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => setSearchQuery(search), 300);
    return () => clearTimeout(handler);
  }, [search]);

  useEffect(() => {
    const handler = setTimeout(() => setPurchaseQuery(purchaseSearch), 300);
    return () => clearTimeout(handler);
  }, [purchaseSearch]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  useEffect(() => {
    setPurchasePage(1);
  }, [purchaseQuery, purchaseStatus]);

  useEffect(() => {
    if (!supabase) {
      setRecordsError("Supabase is not configured.");
      setRecordsLoading(false);
      return undefined;
    }

    let active = true;
    setRecordsLoading(true);

    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const query = sanitizeSearch(searchQuery);

    let request = supabase
      .from("licenses")
      .select("id, machine_id, plan, access_key, expires_at, payment_link_id, archived, created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (query) {
      request = request.or(`machine_id.ilike.*${query}*,access_key.ilike.*${query}*`);
    }

    request.then(({ data, error, count: total }) => {
      if (!active) return;
      if (error) setRecordsError(error.message);
      else {
        setLicenses(data || []);
        setCount(total || 0);
        setRecordsError("");
      }
      setRecordsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [page, searchQuery, reloadNonce]);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;

    supabase
      .from("credit_batches")
      .select(
        "id, code, short_code, credits_total, credits_used, credits_granted, days_per_credit, amount_paise, source, note, created_by, purchaser_machine_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(PACK_PAGE_SIZE)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setBatchesError(error.message);
        else {
          setBatches(data || []);
          setBatchesError("");
        }
      });

    return () => {
      active = false;
    };
  }, [reloadNonce]);

  useEffect(() => {
    if (!supabase) {
      setPurchasesError("Supabase is not configured.");
      setPurchasesLoading(false);
      return undefined;
    }

    let active = true;
    setPurchasesLoading(true);

    const params = new URLSearchParams({
      page: String(purchasePage),
      pageSize: String(PURCHASE_PAGE_SIZE),
    });
    if (purchaseQuery) params.set("search", purchaseQuery);
    if (purchaseStatus) params.set("status", purchaseStatus);

    (async () => {
      try {
        const response = await fetch(`/api/p1/purchases?${params.toString()}`, {
          headers: await bearerHeaders(),
        });
        const result = await response.json();
        if (!active) return;
        if (!response.ok) throw new Error(result.error || "Could not load purchase history.");
        setPurchases(result.rows || []);
        setPurchaseCount(result.count || 0);
        setPurchaseSummary(result.summary || null);
        setPurchasesError("");
      } catch (error) {
        if (!active) return;
        setPurchasesError(error.message || "Could not load purchase history.");
      } finally {
        if (active) setPurchasesLoading(false);
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchasePage, purchaseQuery, purchaseStatus, reloadNonce]);

  async function bearerHeaders() {
    const { data } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session?.access_token || ""}`,
    };
  }

  async function createManualKey(event) {
    event.preventDefault();
    setManualLoading(true);
    setManualError("");
    setManualKey("");

    const days = manualDays === "" ? 0 : Number(manualDays);
    try {
      const response = await fetch("/api/p1/create-manual-key", {
        method: "POST",
        headers: await bearerHeaders(),
        body: JSON.stringify({ machineId: manualMachineId.trim(), days }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create manual key.");
      setManualKey(result.accessKey);
      setManualMachineId("");
      setSearch("");
      setSearchQuery("");
      setPage(1);
      setReloadNonce((current) => current + 1);
    } catch (error) {
      setManualError(error.message || "Could not create manual key.");
    } finally {
      setManualLoading(false);
    }
  }

  async function manageRecord(recordId, action) {
    if (action === "delete") {
      const confirmed = window.confirm(
        "Delete this licence permanently? The machine will stop auto-unlocking and any remaining time is lost.",
      );
      if (!confirmed) return;
    }
    setManagingId(recordId);
    setRecordsError("");
    try {
      const response = await fetch("/api/p1/manage-record", {
        method: "POST",
        headers: await bearerHeaders(),
        body: JSON.stringify({ action, recordId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update the licence.");
      if (action === "delete" && licenses.length === 1 && page > 1) {
        setPage((current) => current - 1);
      }
      setReloadNonce((current) => current + 1);
    } catch (error) {
      setRecordsError(error.message || "Could not update the licence.");
    } finally {
      setManagingId(null);
    }
  }

  async function manageBatch(batchId, action) {
    if (action === "delete") {
      const confirmed = window.confirm(
        "Delete this credit pack permanently? This cannot be undone. Only unused packs can be deleted.",
      );
      if (!confirmed) return;
    }
    setManagingBatchId(batchId);
    setBatchesError("");
    try {
      const response = await fetch("/api/p1/manage-batch", {
        method: "POST",
        headers: await bearerHeaders(),
        body: JSON.stringify({ action, batchId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update the credit pack.");
      setReloadNonce((current) => current + 1);
    } catch (error) {
      setBatchesError(error.message || "Could not update the credit pack.");
    } finally {
      setManagingBatchId(null);
    }
  }

  async function createManualCredit(event) {
    event.preventDefault();
    setManualCreditLoading(true);
    setManualCreditError("");
    setManualCreditCode("");
    setManualCreditShortCode("");

    try {
      const response = await fetch("/api/p1/create-manual-credit", {
        method: "POST",
        headers: await bearerHeaders(),
        body: JSON.stringify({
          credits: Number(manualCredits),
          days: Number(manualCreditDays),
          note: manualCreditNote,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create the credit code.");
      setManualCreditCode(result.code);
      if (result.shortCode) setManualCreditShortCode(result.shortCode);
      setManualCreditNote("");
      setReloadNonce((current) => current + 1);
    } catch (error) {
      setManualCreditError(error.message || "Could not create the credit code.");
    } finally {
      setManualCreditLoading(false);
    }
  }

  function openTopup(batch) {
    setTopupTarget(batch);
    setTopupCredits("5");
    setTopupNote("");
    setTopupError("");
    setTopupResult("");
  }

  async function submitTopup(event) {
    event.preventDefault();
    if (!topupTarget) return;
    setTopupLoading(true);
    setTopupError("");
    setTopupResult("");

    try {
      const response = await fetch("/api/p1/topup-credit", {
        method: "POST",
        headers: await bearerHeaders(),
        body: JSON.stringify({
          batchId: topupTarget.id,
          credits: Number(topupCredits),
          note: topupNote,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add credits.");
      setTopupResult(
        `Added ${result.creditsAdded} credits. Now ${result.creditsRemaining} of ${result.creditsTotal} left.`,
      );
      setTopupNote("");
      setReloadNonce((current) => current + 1);
    } catch (error) {
      setTopupError(error.message || "Could not add credits.");
    } finally {
      setTopupLoading(false);
    }
  }

  async function reconcilePurchases() {
    setReconciling(true);
    setPurchasesError("");
    setReconcileNote("");
    try {
      const response = await fetch("/api/p1/reconcile-purchases", {
        method: "POST",
        headers: await bearerHeaders(),
        body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sync with Razorpay.");
      setReconcileNote(result.summary || "Sync complete.");
      setReloadNonce((current) => current + 1);
    } catch (error) {
      setPurchasesError(error.message || "Could not sync with Razorpay.");
    } finally {
      setReconciling(false);
    }
  }

  async function topUpByCode(event) {
    event.preventDefault();
    const pasted = topupByCodeValue.trim();
    if (!pasted) return;
    setTopupByCodeLoading(true);
    setTopupByCodeError("");
    setTopupByCodeResult("");

    try {
      const response = await fetch("/api/p1/topup-credit", {
        method: "POST",
        headers: await bearerHeaders(),
        body: JSON.stringify({ code: pasted, credits: Number(topupByCodeCredits) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add credits.");
      let msg = `Added ${result.creditsAdded} credits. That code now has ${result.creditsTotal} total ` +
        `(${result.creditsRemaining} left).`;
      if (result.shortCode) {
        msg += ` Short code: ${result.shortCode}`;
      }
      setTopupByCodeResult(msg);
      setTopupByCodeValue("");
      setReloadNonce((current) => current + 1);
    } catch (error) {
      setTopupByCodeError(error.message || "Could not add credits.");
    } finally {
      setTopupByCodeLoading(false);
    }
  }

  const activeRows = licenses.filter((row) => !row.archived);
  const archivedRows = licenses.filter((row) => row.archived);
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const shownFrom = count === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const shownTo = Math.min(page * PAGE_SIZE, count);

  async function copy(value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {}
  }

  function expiryCell(expiresAt) {
    const expired = new Date(expiresAt).getTime() <= Date.now();
    return (
      <span className={expired ? "dashboard-expired" : "dashboard-active"}>
        {new Date(expiresAt).toLocaleString()}
        {expired ? " (expired)" : ""}
      </span>
    );
  }

  return (
    <main className="dashboard-page" aria-label="Dashboard">
      <nav className="dashboard-nav">
        <a className="dashboard-brand" href="/">
          <img src="/assets/GetPcHealth-logo.png" alt="GetPcHealth" />
          <span>GetPcHealth</span>
        </a>
        <div className="dashboard-actions">
          {userEmail && <span className="dashboard-user-email">{userEmail}</span>}
          <a className="dashboard-link" href="/#credits">
            Store front
          </a>
          <a className="dashboard-link" href="/">
            Landing
          </a>
          <button
            type="button"
            className="dashboard-logout"
            onClick={async () => {
              if (supabase) await supabase.auth.signOut();
              navigate("/loginadmin");
            }}
          >
            Logout
          </button>
        </div>
      </nav>

      <header className="dashboard-page-head">
        <h1>Admin dashboard</h1>
        <p className="dashboard-muted">
          {count} active licences &middot; {batches.length} credit packs &middot;{" "}
          {purchaseCount} purchases recorded
        </p>
      </header>

      <section className="dashboard-tools" aria-labelledby="tools-heading">
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-kicker">Manual actions</p>
            <h2 id="tools-heading">Admin tools</h2>
            <p className="dashboard-muted">
              These write straight to the database, bypassing Razorpay and the webhook. Use them
              for support, goodwill and test orders only.
            </p>
          </div>
        </div>

        <div className="dashboard-tool-grid">
          <article className="dashboard-tool-card" aria-labelledby="manual-key-heading">
            <header className="dashboard-tool-head">
              <p className="dashboard-kicker">Direct grant</p>
              <h3 id="manual-key-heading">Grant access by hand</h3>
              <p className="dashboard-tool-note">
                Extends from the machine&rsquo;s current expiry, so part-used time is never lost.
              </p>
            </header>
            <form className="dashboard-manual-form" onSubmit={createManualKey}>
              <div className="dashboard-field">
                <label htmlFor="manual-machine-id">Machine ID</label>
                <input
                  id="manual-machine-id"
                  value={manualMachineId}
                  onChange={(event) => setManualMachineId(event.target.value)}
                  placeholder="MachineGuid of the PC"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="dashboard-field">
                <label htmlFor="manual-days">Days to add (0 = never expires)</label>
                <input
                  id="manual-days"
                  type="number"
                  min="0"
                  max="3650"
                  value={manualDays}
                  onChange={(event) => setManualDays(event.target.value)}
                />
              </div>
              <button type="submit" disabled={manualLoading}>
                {manualLoading ? "Creating..." : "Grant access"}
              </button>
            </form>
            {manualKey && (
              <div className="dashboard-manual-result">
                <p className="dashboard-kicker">Generated key</p>
                <code>{manualKey}</code>
                <button
                  type="button"
                  className="dashboard-rec-btn"
                  onClick={() => copy(manualKey)}
                >
                  Copy
                </button>
              </div>
            )}
            {manualError && (
              <p className="dashboard-error" role="alert">
                {manualError}
              </p>
            )}
          </article>

          <article className="dashboard-tool-card" aria-labelledby="manual-credit-heading">
            <header className="dashboard-tool-head">
              <p className="dashboard-kicker">Goodwill</p>
              <h3 id="manual-credit-heading">Generate a credit code</h3>
              <p className="dashboard-tool-note">
                Issues a code with no payment, so it is recorded as complimentary (&#8377;0). The
                customer redeems it exactly like a purchased pack.
              </p>
            </header>
            <form className="dashboard-manual-form" onSubmit={createManualCredit}>
              <div className="dashboard-field">
                <label htmlFor="manual-credits">Credits to include</label>
                <input
                  id="manual-credits"
                  type="number"
                  min="1"
                  max="100000"
                  value={manualCredits}
                  onChange={(event) => setManualCredits(event.target.value)}
                  required
                />
              </div>
              <div className="dashboard-field">
                <label htmlFor="manual-credit-days">Days per credit</label>
                <input
                  id="manual-credit-days"
                  type="number"
                  min="1"
                  max="3650"
                  value={manualCreditDays}
                  onChange={(event) => setManualCreditDays(event.target.value)}
                  required
                />
              </div>
              <div className="dashboard-field">
                <label htmlFor="manual-credit-note">Note (optional)</label>
                <input
                  id="manual-credit-note"
                  value={manualCreditNote}
                  onChange={(event) => setManualCreditNote(event.target.value)}
                  placeholder="e.g. goodwill for the Acme order"
                  autoComplete="off"
                />
              </div>
              <button type="submit" disabled={manualCreditLoading}>
                {manualCreditLoading ? "Creating..." : "Create code"}
              </button>
            </form>
            {manualCreditCode && (
              <div className="dashboard-manual-result">
                {manualCreditShortCode && (
                  <div className="dashboard-manual-result-row">
                    <p className="dashboard-kicker">Short code (for manual entry)</p>
                    <div className="dashboard-key-cell">
                      <code>{manualCreditShortCode}</code>
                      <button
                        type="button"
                        className="dashboard-rec-btn"
                        onClick={() => copy(manualCreditShortCode)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
                <div className="dashboard-manual-result-row">
                  <p className="dashboard-kicker">Long code (cryptographic)</p>
                  <div className="dashboard-key-cell">
                    <code title={manualCreditCode}>{manualCreditCode.length > 60 ? manualCreditCode.slice(0, 60) + "..." : manualCreditCode}</code>
                    <button
                      type="button"
                      className="dashboard-rec-btn"
                      onClick={() => copy(manualCreditCode)}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            )}
            {manualCreditError && (
              <p className="dashboard-error" role="alert">
                {manualCreditError}
              </p>
            )}
          </article>

          <article className="dashboard-tool-card" aria-labelledby="purchase-key-heading">
            <header className="dashboard-tool-head">
              <p className="dashboard-kicker">Live test</p>
              <h3 id="purchase-key-heading">Individual Pro payment</h3>
              <p className="dashboard-tool-note dashboard-tool-warn">
                Creates a real Razorpay payment link at the live price. Use a test card, then refund
                yourself from the dashboard.
              </p>
            </header>
            <AccessPurchase kind="individual" embedded />
          </article>
        </div>
      </section>

      <section className="dashboard-records" aria-labelledby="records-heading">
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-kicker">Active entitlements</p>
            <h2 id="records-heading">Licences</h2>
          </div>
          <div className="dashboard-table-toolbar">
            <span className="dashboard-count">{count} licences</span>
            <input
              type="search"
              className="dashboard-search"
              placeholder="Search machine ID or key..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search licences"
            />
          </div>
        </div>
        {recordsLoading && <p className="dashboard-muted">Loading licences...</p>}
        {recordsError && (
          <p className="dashboard-error" role="alert">
            {recordsError}
          </p>
        )}
        {!recordsLoading && !recordsError && count === 0 && (
          <p className="dashboard-muted">
            {searchQuery ? "No matching licences found." : "No licences issued yet."}
          </p>
        )}

        {!recordsLoading && !recordsError && activeRows.length > 0 && (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Machine ID</th>
                  <th>Plan</th>
                  <th>Access key</th>
                  <th>Expires</th>
                  <th>Receipt</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((row) => (
                  <tr key={row.id}>
                    <td className="dashboard-machine">{row.machine_id}</td>
                    <td>{planLabel(row.plan)}</td>
                    <td>
                      <div className="dashboard-key-cell">
                        <code title={row.access_key}>{shortCode(row.access_key)}</code>
                        <button
                          type="button"
                          className="dashboard-rec-btn"
                          onClick={() => copy(row.access_key)}
                        >
                          Copy
                        </button>
                      </div>
                    </td>
                    <td>{expiryCell(row.expires_at)}</td>
                    <td>
                      <code>{shortCode(row.payment_link_id)}</code>
                    </td>
                    <td>
                      <div className="dashboard-rec-actions">
                        <button
                          type="button"
                          className="dashboard-rec-btn archive"
                          onClick={() => manageRecord(row.id, "archive")}
                          disabled={managingId === row.id}
                        >
                          Archive
                        </button>
                        <button
                          type="button"
                          className="dashboard-rec-btn danger"
                          onClick={() => manageRecord(row.id, "delete")}
                          disabled={managingId === row.id}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!recordsLoading && !recordsError && archivedRows.length > 0 && (
          <section className="dashboard-archived" aria-labelledby="archived-heading">
            <div className="dashboard-section-heading">
              <div>
                <p className="dashboard-kicker">Archived</p>
                <h3 id="archived-heading">Archived licences</h3>
              </div>
              <span className="dashboard-count">{archivedRows.length} on this page</span>
            </div>
            <div className="dashboard-table-wrap">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Machine ID</th>
                    <th>Plan</th>
                    <th>Expires</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedRows.map((row) => (
                    <tr key={row.id}>
                      <td className="dashboard-machine">{row.machine_id}</td>
                      <td>{planLabel(row.plan)}</td>
                      <td>{expiryCell(row.expires_at)}</td>
                      <td>
                        <div className="dashboard-rec-actions">
                          <button
                            type="button"
                            className="dashboard-rec-btn"
                            onClick={() => manageRecord(row.id, "unarchive")}
                            disabled={managingId === row.id}
                          >
                            Unarchive
                          </button>
                          <button
                            type="button"
                            className="dashboard-rec-btn danger"
                            onClick={() => manageRecord(row.id, "delete")}
                            disabled={managingId === row.id}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!recordsLoading && !recordsError && count > 0 && (
          <div className="dashboard-pagination">
            <span className="dashboard-page-info">
              Showing {shownFrom}–{shownTo} of {count}
            </span>
            <div className="dashboard-pagination-actions">
              <button
                type="button"
                className="dashboard-rec-btn"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Prev
              </button>
              <span className="dashboard-page-info">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="dashboard-rec-btn"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="dashboard-records" aria-labelledby="packs-heading">
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-kicker">Institutional</p>
            <h2 id="packs-heading">Credit packs</h2>
          </div>
          <span className="dashboard-count">latest {batches.length}</span>
        </div>

        <form className="dashboard-topup-inline" onSubmit={topUpByCode}>
          <label htmlFor="topup-code">Add credits to a code the customer sent you</label>
          <div className="dashboard-topup-inline-row">
            <input
              id="topup-code"
              value={topupByCodeValue}
              onChange={(event) => setTopupByCodeValue(event.target.value)}
              placeholder="Short code (12 chars), gphc-..., or batch ID"
              autoComplete="off"
            />
            <input
              className="dashboard-topup-amount"
              type="number"
              min="1"
              max="100000"
              value={topupByCodeCredits}
              onChange={(event) => setTopupByCodeCredits(event.target.value)}
              aria-label="Credits to add"
            />
            <button type="submit" disabled={topupByCodeLoading}>
              {topupByCodeLoading ? "Adding..." : "Add credits"}
            </button>
          </div>
        </form>
        {topupByCodeResult && (
          <p className="dashboard-manual-success" role="status">
            {topupByCodeResult}
          </p>
        )}
        {topupByCodeError && (
          <p className="dashboard-error" role="alert">
            {topupByCodeError}
          </p>
        )}

        {batchesError && (
          <p className="dashboard-error" role="alert">
            {batchesError}
          </p>
        )}
        {!batchesError && batches.length === 0 && (
          <p className="dashboard-muted">No credit packs issued yet.</p>
        )}
        {batches.length > 0 && (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Short code</th>
                  <th>Credit key</th>
                  <th>Credits</th>
                  <th>Days each</th>
                  <th>Paid</th>
                  <th>Source</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const used = batch.credits_used;
                  const left = batch.credits_total - used;
                  return (
                    <tr key={batch.id}>
                      <td>
                        {batch.short_code && (
                          <div className="dashboard-key-cell">
                            <code title={batch.short_code}>{batch.short_code}</code>
                            <button
                              type="button"
                              className="dashboard-rec-btn"
                              onClick={() => copy(batch.short_code)}
                              title="Copy short code"
                            >
                              Copy
                            </button>
                          </div>
                        )}
                        {!batch.short_code && <span className="dashboard-muted">—</span>}
                      </td>
                      <td>
                        <div className="dashboard-key-cell">
                          <code title={batch.code}>{shortCode(batch.code)}</code>
                          <button
                            type="button"
                            className="dashboard-rec-btn"
                            onClick={() => copy(batch.code)}
                          >
                            Copy
                          </button>
                        </div>
                      </td>
                      <td className={left === 0 ? "dashboard-expired" : "dashboard-active"}>
                        {left} left of {batch.credits_total}
                        {batch.credits_granted > 0 && (
                          <span className="dashboard-muted"> ({batch.credits_granted} free)</span>
                        )}
                      </td>
                      <td>{batch.days_per_credit}</td>
                      <td>{rupees(batch.amount_paise)}</td>
                      <td>
                        {batch.source === "manual" ? (
                          <span className="dashboard-badge manual">Complimentary</span>
                        ) : (
                          <span className="dashboard-badge paid">Paid</span>
                        )}
                        {batch.note && <div className="dashboard-muted">{batch.note}</div>}
                      </td>
                      <td>{new Date(batch.created_at).toLocaleString()}</td>
                      <td>
                        <div className="dashboard-rec-actions">
                          <button
                            type="button"
                            className="dashboard-rec-btn"
                            onClick={() => openTopup(batch)}
                          >
                            Add credits
                          </button>
                          <button
                            type="button"
                            className="dashboard-rec-btn danger"
                            onClick={() => manageBatch(batch.id, "delete")}
                            disabled={managingBatchId === batch.id}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {topupTarget && (
          <form className="dashboard-topup-panel" onSubmit={submitTopup}>
            <div className="dashboard-section-heading">
              <div>
                <p className="dashboard-kicker">Top-up</p>
                <h3>
                  Add credits to <code title={topupTarget.code}>{shortCode(topupTarget.code)}</code>
                  {topupTarget.short_code && (
                    <span className="dashboard-muted" style={{ marginLeft: "8px" }}>
                      (Short: <code>{topupTarget.short_code}</code>)
                    </span>
                  )}
                </h3>
              </div>
              <button
                type="button"
                className="dashboard-rec-btn"
                onClick={() => setTopupTarget(null)}
              >
                Close
              </button>
            </div>
            <p className="dashboard-muted">
              Currently {topupTarget.credits_total - topupTarget.credits_used} of{" "}
              {topupTarget.credits_total} credits left, at {topupTarget.days_per_credit} days each.
              Added credits are complimentary and do not change the {rupees(topupTarget.amount_paise)}{" "}
              already paid.
            </p>
            <div className="dashboard-topup-inline-row">
              <label htmlFor="topup-amount">Credits to add</label>
              <input
                id="topup-amount"
                type="number"
                min="1"
                max="100000"
                value={topupCredits}
                onChange={(event) => setTopupCredits(event.target.value)}
              />
              <label htmlFor="topup-note">Reason</label>
              <input
                id="topup-note"
                value={topupNote}
                onChange={(event) => setTopupNote(event.target.value)}
                placeholder="e.g. 3 credits lost on reinstall"
                autoComplete="off"
              />
              <button type="submit" disabled={topupLoading}>
                {topupLoading ? "Adding..." : "Add credits"}
              </button>
            </div>
            {topupResult && (
              <p className="dashboard-manual-success" role="status">
                {topupResult}
              </p>
            )}
            {topupError && (
              <p className="dashboard-error" role="alert">
                {topupError}
              </p>
            )}
          </form>
        )}
      </section>

      <section className="dashboard-records" aria-labelledby="purchases-heading">
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-kicker">Revenue</p>
            <h2 id="purchases-heading">Purchase history</h2>
          </div>
          <div className="dashboard-table-toolbar">
            <span className="dashboard-count">{purchaseCount} purchases</span>
            <select
              className="dashboard-filter"
              value={purchaseStatus}
              onChange={(event) => setPurchaseStatus(event.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="paid">Paid</option>
              <option value="created">Awaiting payment</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
            </select>
            <input
              type="search"
              className="dashboard-search"
              placeholder="Search machine, link or payment ID..."
              value={purchaseSearch}
              onChange={(event) => setPurchaseSearch(event.target.value)}
              aria-label="Search purchases"
            />
            <button
              type="button"
              className="dashboard-rec-btn"
              onClick={reconcilePurchases}
              disabled={reconciling}
            >
              {reconciling ? "Syncing..." : "Sync with Razorpay"}
            </button>
          </div>
        </div>

        {purchaseSummary && (
          <div className="dashboard-summary">
            <div>
              <span className="dashboard-summary-label">Revenue</span>
              <span className="dashboard-summary-value">{rupees(purchaseSummary.revenue_paise)}</span>
            </div>
            <div>
              <span className="dashboard-summary-label">Paid</span>
              <span className="dashboard-summary-value">{purchaseSummary.paid_count}</span>
            </div>
            <div>
              <span className="dashboard-summary-label">Awaiting payment</span>
              <span className="dashboard-summary-value">{purchaseSummary.pending_count}</span>
            </div>
            <div>
              <span className="dashboard-summary-label">Credits sold</span>
              <span className="dashboard-summary-value">{purchaseSummary.credits_sold}</span>
            </div>
          </div>
        )}
        {reconcileNote && <p className="dashboard-muted">{reconcileNote}</p>}

        {purchasesLoading && <p className="dashboard-muted">Loading purchases...</p>}
        {purchasesError && (
          <p className="dashboard-error" role="alert">
            {purchasesError}
          </p>
        )}
        {!purchasesLoading && !purchasesError && purchaseCount === 0 && (
          <p className="dashboard-muted">
            {purchaseQuery || purchaseStatus
              ? "No matching purchases found."
              : "No purchases recorded yet. Use Sync with Razorpay to pull existing sales."}
          </p>
        )}

        {!purchasesLoading && !purchasesError && purchases.length > 0 && (
          <div className="dashboard-table-wrap">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Machine</th>
                  <th>Email</th>
                  <th>Amount</th>
                  <th>Entitlement</th>
                  <th>Status</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.created_at).toLocaleString()}</td>
                    <td>{row.kind === "credits" ? `${row.credits} credits` : "Pro access"}</td>
                    <td className="dashboard-machine">{row.machine_id || "—"}</td>
                    <td>{row.email || "—"}</td>
                    <td>{rupees(row.amount_paise)}</td>
                    <td>
                      {row.kind === "credits"
                        ? `${row.credits} × ${row.days} days`
                        : `${row.days} days`}
                    </td>
                    <td>
                      <span
                        className={`dashboard-badge ${
                          row.status === "paid"
                            ? "paid"
                            : row.status === "created"
                              ? "pending"
                              : "failed"
                        }`}
                      >
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td>
                      <code title={row.razorpay_payment_id || row.payment_link_id}>
                        {shortCode(row.razorpay_payment_id || row.payment_link_id)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!purchasesLoading && !purchasesError && purchaseCount > PURCHASE_PAGE_SIZE && (
          <div className="dashboard-pagination">
            <span className="dashboard-page-info">
              Page {purchasePage} of {Math.max(1, Math.ceil(purchaseCount / PURCHASE_PAGE_SIZE))}
            </span>
            <div className="dashboard-pagination-actions">
              <button
                type="button"
                className="dashboard-rec-btn"
                disabled={purchasePage <= 1}
                onClick={() => setPurchasePage((current) => current - 1)}
              >
                Prev
              </button>
              <button
                type="button"
                className="dashboard-rec-btn"
                disabled={
                  purchasePage >= Math.ceil(purchaseCount / PURCHASE_PAGE_SIZE)
                }
                onClick={() => setPurchasePage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      <Info />
    </main>
  );
}
