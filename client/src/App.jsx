import { useEffect, useMemo, useState } from "react";

const LEG_TEMPLATE = [
  { role: "short_put_calendar", name: "Put Calendar Short Put", direction: "STO", qty: "1", premium: "", dte: "8", strike: "", locked: true },
  { role: "long_put_calendar", name: "Put Calendar Long Put", direction: "BTO", qty: "1", premium: "", dte: "12", strike: "", locked: true },
  { role: "short_call", name: "Call Fly Short Call", direction: "STO", qty: "2", premium: "", dte: "8", strike: "", delta: "8" },
  { role: "long_call_lower", name: "Call Fly Lower Long Call", direction: "BTO", qty: "1", premium: "", dte: "8", strike: "", locked: true },
  { role: "long_call_upper", name: "Call Fly Upper Long Call", direction: "BTO", qty: "1", premium: "", dte: "8", strike: "", locked: true }
];

const EMPTY_VALIDATION = { status: "APPROVED", short_value: 0, long_value: 0, total_value: 0, net_premium: 0, premium_per_contract: 0, sl_ratio: 0, vix_ratio: 0, messages: [] };
const SETTINGS_FIELDS = [["vix_ratio_min", "VIX Ratio Min", "number"], ["vix_ratio_max", "VIX Ratio Max", "number"], ["min_net_debit_per_lot", "Min Net Debit / Lot", "number"], ["sl_ratio_floor", "S/L Ratio Hard Floor", "number"], ["sl_ratio_preferred", "S/L Ratio Preferred Min", "number"], ["checkpoint_hwm_pct", "4 DTE HWM", "number"], ["bail_hwm_pct", "2 DTE HWM", "number"], ["auto_poll_interval_minutes", "Auto-Poll Every (min)", "number"]];

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const payload = (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload.error || payload.message || "Request failed.");
  return payload;
}

function money(value) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value || 0)); }
function pct(value) { return `${Number(value || 0).toFixed(1)}%`; }
function formatDate(value) { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "-"; }
function formatDateTime(value) { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Not yet"; }
function statusClasses(status) { if (String(status).includes("BLOCK") || String(status).includes("CLOSE")) return "border-danger/40 bg-danger/15 text-danger"; if (String(status).includes("CAUTION") || String(status).includes("SCALE") || String(status).includes("WARNING")) return "border-amber/40 bg-amber/15 text-amber"; return "border-safe/40 bg-safe/15 text-safe"; }
function roundToNearestFive(value) { return Number.isFinite(value) ? String(Math.round(value / 5) * 5) : ""; }
function legToneClasses(leg) { return String(leg.role || "").includes("put") ? "border-danger/35 bg-danger/10" : String(leg.role || "").includes("call") ? "border-safe/35 bg-safe/10" : "border-edge bg-ink/55"; }
function legBadgeClasses(leg) { return String(leg.role || "").includes("put") ? "border-danger/40 bg-danger/15 text-danger" : String(leg.role || "").includes("call") ? "border-safe/40 bg-safe/15 text-safe" : "border-edge bg-panel text-slate-300"; }

function deriveLegsFromStructure(form) {
  const putStrike = roundToNearestFive(Number(form.spx_price) * 0.981);
  const roundedShortCallStrike = roundToNearestFive(Number(form.short_call_strike));
  const shortCallStrikeNumber = Number(roundedShortCallStrike);
  const hasShortCall = Number.isFinite(shortCallStrikeNumber) && roundedShortCallStrike !== "";
  const lowerWing = hasShortCall ? String(shortCallStrikeNumber - 30) : "";
  const upperWing = hasShortCall ? String(shortCallStrikeNumber + 30) : "";

  return form.legs.map((leg) => {
    if (leg.role === "short_put_calendar") return { ...leg, direction: "STO", dte: "8", strike: putStrike };
    if (leg.role === "long_put_calendar") return { ...leg, direction: "BTO", dte: "12", strike: putStrike };
    if (leg.role === "short_call") return { ...leg, direction: "STO", qty: leg.qty || "2", dte: "8", strike: roundedShortCallStrike };
    if (leg.role === "long_call_lower") return { ...leg, direction: "BTO", dte: "8", strike: lowerWing };
    if (leg.role === "long_call_upper") return { ...leg, direction: "BTO", dte: "8", strike: upperWing };
    return leg;
  });
}

function createTradeInputs(trade) {
  return { optionstrat_url: trade?.optionstrat_url || "" };
}

function getTradeGuidance(trade, latestVerdict) {
  if (!trade || trade.status === "EMPTY") return "No trade is open here. Use the entry builder after the calendar gate is safe.";
  if (!trade.optionstrat_url) return "Paste the OptionStrat link, then run a check to pull live current P/L, highest P/L yet, and DTE.";
  if (!latestVerdict) return "Run the first check to let OptionStrat populate the trade health metrics.";
  if (latestVerdict.verdict.includes("CLOSE")) return "Action needed now: close the instructed size, then mark the trade closed.";
  if (latestVerdict.verdict.includes("SCALE")) return "Scale out the instructed amount, then rerun the check after the adjustment.";
  return "No urgent action. Let the next OptionStrat pull confirm the hold.";
}

function Field({ label, value, onChange, placeholder = "", type = "number", disabled = false }) {
  return <label className="block"><span className="mb-2 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{label}</span><input type={type} value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-edge bg-panel px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-gold/60 disabled:cursor-not-allowed disabled:bg-ink/70 disabled:text-slate-500" /></label>;
}
function Metric({ label, value, tone = "text-white" }) { return <div className="rounded-2xl border border-edge bg-ink/60 p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p><p className={`mt-2 font-mono text-xl ${tone}`}>{value}</p></div>; }
function Section({ title, subtitle, action, children }) { return <section className="rounded-3xl border border-edge bg-panel/90 shadow-glow backdrop-blur"><div className="flex flex-col gap-4 border-b border-edge px-6 py-5 md:flex-row md:items-center md:justify-between"><div><p className="font-mono text-xs uppercase tracking-[0.28em] text-gold/80">{title}</p><p className="mt-2 text-sm text-slate-400">{subtitle}</p></div>{action}</div><div className="p-6">{children}</div></section>; }

export default function App() {
  const [dashboard, setDashboard] = useState({ settings: {}, trades: { wednesday: null, thursday: null } });
  const [calendar, setCalendar] = useState(null);
  const [validation, setValidation] = useState(EMPTY_VALIDATION);
  const [entryForm, setEntryForm] = useState({ vix: "", vix9d: "", spx_price: "", portfolio_value: "", short_call_strike: "", trade_day: "Wednesday", optionstrat_url: "", entry_date: "", legs: LEG_TEMPLATE });
  const [settingsDraft, setSettingsDraft] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tradeInputs, setTradeInputs] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyTradeId, setBusyTradeId] = useState(null);

  const derivedLegs = useMemo(() => deriveLegsFromStructure(entryForm), [entryForm]);
  const putStrike = derivedLegs.find((leg) => leg.role === "short_put_calendar")?.strike || "-";
  const shortCallCenter = derivedLegs.find((leg) => leg.role === "short_call")?.strike || "-";
  const lowerWing = derivedLegs.find((leg) => leg.role === "long_call_lower")?.strike || "-";
  const upperWing = derivedLegs.find((leg) => leg.role === "long_call_upper")?.strike || "-";
  const lastVerdicts = { wednesday: dashboard.trades.wednesday?.verdicts?.at(-1), thursday: dashboard.trades.thursday?.verdicts?.at(-1) };

  async function loadDashboard() {
    const data = await api("/api/trades");
    setDashboard(data);
    setSettingsDraft(data.settings);
    setTradeInputs({ wednesday: createTradeInputs(data.trades.wednesday), thursday: createTradeInputs(data.trades.thursday) });
  }

  async function loadCalendar(vixValue = entryForm.vix, tradeDate = entryForm.entry_date) {
    const params = new URLSearchParams();
    if (vixValue) params.set("vix", vixValue);
    if (tradeDate) params.set("date", tradeDate);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    setCalendar(await api(`/api/calendar${suffix}`));
  }

  useEffect(() => { Promise.all([loadDashboard(), loadCalendar()]).catch((err) => setError(err.message)); }, []);
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        setValidation(await api("/api/validate-entry", { method: "POST", body: JSON.stringify({ ...entryForm, legs: derivedLegs }) }));
      } catch (err) {
        setError(err.message);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [entryForm, derivedLegs]);
  useEffect(() => {
    loadCalendar(entryForm.vix, entryForm.entry_date).catch((err) => setError(err.message));
  }, [entryForm.vix, entryForm.entry_date]);

  async function saveTrade() {
    setError("");
    setNotice("");
    await api("/api/save-trade", { method: "POST", body: JSON.stringify({ ...entryForm, legs: derivedLegs }) });
    await loadDashboard();
    setNotice("Trade saved. Paste the OptionStrat link in the active trade card and run the first check.");
  }

  async function runCheck(trade) {
    setError("");
    setNotice("");
    setBusyTradeId(trade.id);
    try {
      const result = await api(`/api/check-trade/${trade.id}`, { method: "POST", body: JSON.stringify(tradeInputs[trade.slot] || {}) });
      await loadDashboard();
      setNotice(result?.scrape?.message || "Trade check completed.");
    } catch (err) {
      setError(err.message || "Trade check failed.");
    } finally {
      setBusyTradeId(null);
    }
  }

  async function saveInputs(trade) {
    setError("");
    setNotice("");
    const { optionstrat_url } = tradeInputs[trade.slot] || {};
    await api(`/api/trade/${trade.id}/update`, { method: "PUT", body: JSON.stringify({ optionstrat_url }) });
    await loadDashboard();
    setNotice("OptionStrat link saved.");
  }

  async function closeTrade(trade) { await api(`/api/trade/${trade.id}/close`, { method: "PUT" }); await loadDashboard(); }
  async function saveSettings() { await api("/api/settings", { method: "PUT", body: JSON.stringify(settingsDraft) }); await loadDashboard(); setSettingsOpen(false); }
  async function sendTelegramTest() { await api("/api/alerts/test", { method: "POST" }); }

  return <div className="relative overflow-hidden"><div className="pointer-events-none absolute inset-0 grid-overlay opacity-40" /><div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <header className="mb-8 overflow-hidden rounded-[2rem] border border-edge bg-panel/90 shadow-glow backdrop-blur"><div className="relative p-6"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,212,184,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(240,180,41,0.16),transparent_36%)]" /><div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div><p className="font-mono text-xs uppercase tracking-[0.4em] text-teal">Flyagonal Trade Monitor</p><h1 className="mt-3 text-4xl font-semibold text-white">Flyagonal Trade Monitor</h1><p className="mt-2 text-base text-slate-300">by Lotus Tempar</p><p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400">A guided control room that auto-builds the Flyagonal structure, checks trade health, and sends Telegram checkpoints.</p></div><button className="rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm font-medium text-gold" onClick={() => setSettingsOpen(true)}>Open Settings</button></div>{error ? <div className="relative mt-6 rounded-2xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div> : null}{notice ? <div className="relative mt-4 rounded-2xl border border-teal/50 bg-teal/10 px-4 py-3 text-sm text-teal">{notice}</div> : null}</div></header>

    <main className="space-y-8">
      <Section title="Next Step" subtitle="What to do right now."><div className="grid gap-4 md:grid-cols-3"><div className={`rounded-3xl border p-5 ${statusClasses(calendar?.status || "CLEAR")}`}><p className="font-semibold text-white">Calendar</p><p className="mt-2 text-sm">{calendar?.primary_message || "Refresh the calendar gate before entry."}</p></div><div className={`rounded-3xl border p-5 ${statusClasses(validation.status)}`}><p className="font-semibold text-white">Entry Builder</p><p className="mt-2 text-sm">{validation.status === "BLOCKED" ? "The warning is advisory only. You can still save the trade if you want it tracked." : "Enter SPX, the 8-delta call strike, and premiums."}</p></div><div className="rounded-3xl border border-teal/40 bg-teal/10 p-5"><p className="font-semibold text-white">Auto Monitor</p><p className="mt-2 text-sm text-slate-300">Open trades are checked every {dashboard.settings.auto_poll_interval_minutes ?? 2} minutes during market hours. Each trade card now shows the last recorded check time.</p></div></div></Section>

      <Section title="Today's Entry Gate" subtitle="Macro filter for the selected trade date and its 8-day window." action={<button className="rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-slate-950" onClick={() => loadCalendar(entryForm.vix, entryForm.entry_date)}>Refresh Calendar</button>}><div className={`inline-flex rounded-full border px-4 py-2 font-mono text-sm ${statusClasses(calendar?.status || "CLEAR")}`}>{calendar?.badge || "CLEAR TO TRADE"}</div><p className="mt-4 text-sm text-slate-300">{calendar?.primary_message || "Load the calendar to check CPI blackout dates in the trade window."}</p><p className="mt-3 font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Using entry VIX: {entryForm.vix || "not set"} • Trade date: {entryForm.entry_date || "today"}</p>{calendar?.events?.length ? <div className="mt-5 grid gap-3">{calendar.events.map((event) => <div key={`${event.iso_date}-${event.event_name}`} className="rounded-2xl border border-edge bg-ink/60 p-4"><div className="flex flex-wrap items-center gap-3"><span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 font-mono text-xs text-gold">Day {event.window_day}</span><span className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{event.iso_date} • {event.time || "Time TBD"}</span></div><p className="mt-3 text-sm font-medium text-white">{event.event_name}</p><p className="mt-1 text-xs text-slate-400">{event.currency} • High impact expected</p></div>)}</div> : <div className="mt-5 rounded-2xl border border-dashed border-edge p-4 text-sm text-slate-500">No high-impact USD events detected in the current 8-day window.</div>}</Section>

      <Section title="Trade Entry Builder" subtitle="SPX and the 8-delta short call drive the automatic structure." action={<button className={`rounded-2xl px-4 py-3 text-sm font-semibold ${validation.status === "BLOCKED" ? "bg-danger/20 text-danger border border-danger/40" : "bg-gold text-slate-950"}`} onClick={saveTrade}>Save Trade</button>}>
        <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]"><div className="space-y-6"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6"><Field label="VIX" value={entryForm.vix} onChange={(value) => setEntryForm((current) => ({ ...current, vix: value }))} /><Field label="VIX9D" value={entryForm.vix9d} onChange={(value) => setEntryForm((current) => ({ ...current, vix9d: value }))} /><Field label="SPX Price" value={entryForm.spx_price} onChange={(value) => setEntryForm((current) => ({ ...current, spx_price: value }))} /><Field label="Portfolio Value" value={entryForm.portfolio_value} onChange={(value) => setEntryForm((current) => ({ ...current, portfolio_value: value }))} /><Field label="8-delta call strike" value={entryForm.short_call_strike} onChange={(value) => setEntryForm((current) => ({ ...current, short_call_strike: value }))} /><Field label="Entry Date" type="date" value={entryForm.entry_date} onChange={(value) => setEntryForm((current) => ({ ...current, entry_date: value }))} /></div><div className="rounded-3xl border border-edge bg-ink/60 p-4"><p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-500">Trade Day</p><div className="mt-3 flex gap-3"><button className={`rounded-2xl px-4 py-3 text-sm font-semibold ${entryForm.trade_day === "Wednesday" ? "bg-gold text-slate-950" : "border border-edge bg-panel text-slate-300"}`} onClick={() => setEntryForm((current) => ({ ...current, trade_day: "Wednesday" }))}>Wednesday</button><button className={`rounded-2xl px-4 py-3 text-sm font-semibold ${entryForm.trade_day === "Thursday" ? "bg-gold text-slate-950" : "border border-edge bg-panel text-slate-300"}`} onClick={() => setEntryForm((current) => ({ ...current, trade_day: "Thursday" }))}>Thursday</button></div></div><Field label="OptionStrat URL" type="text" value={entryForm.optionstrat_url} onChange={(value) => setEntryForm((current) => ({ ...current, optionstrat_url: value }))} placeholder="https://optionstrat.com/save/..." />
        <div className="grid gap-4 md:grid-cols-3"><Metric label="Put Calendar Strike" value={putStrike} /><Metric label="Short Call Center" value={shortCallCenter} /><Metric label="Bought Call Wings" value={`${lowerWing} / ${upperWing}`} /></div>
        <div className="space-y-4">{derivedLegs.map((leg, index) => <div key={leg.role} className={`rounded-3xl border p-4 ${legToneClasses(leg)}`}><div className="mb-4 flex items-center justify-between"><div><p className="font-medium text-white">{leg.name}</p><p className="mt-1 font-mono text-xs uppercase tracking-[0.24em] text-slate-500">{leg.direction} {leg.locked ? "AUTO" : "MANUAL"}</p></div><div className={`rounded-full border px-3 py-2 font-mono text-xs ${legBadgeClasses(leg)}`}>{String(leg.role || "").includes("put") ? "PUT" : "CALL"}</div></div><div className="grid gap-4 md:grid-cols-5"><Field label="Qty" value={leg.qty} onChange={(value) => setEntryForm((current) => ({ ...current, legs: current.legs.map((item, i) => i === index ? { ...item, qty: value } : item) }))} /><Field label="Premium" value={leg.premium} onChange={(value) => setEntryForm((current) => ({ ...current, legs: current.legs.map((item, i) => i === index ? { ...item, premium: value } : item) }))} /><Field label="DTE" value={leg.dte} disabled onChange={() => {}} /><Field label="Strike" value={leg.strike} disabled onChange={() => {}} />{leg.role === "short_call" ? <Field label="Delta" value={leg.delta || "8"} onChange={(value) => setEntryForm((current) => ({ ...current, legs: current.legs.map((item, i) => i === index ? { ...item, delta: value } : item) }))} /> : <Field label="Role" type="text" value={leg.role} disabled onChange={() => {}} />}</div></div>)}</div></div><div className="space-y-5"><div className={`rounded-3xl border p-5 ${statusClasses(validation.status)}`}><p className="font-mono text-xs uppercase tracking-[0.3em]">Entry Status</p><p className="mt-3 text-2xl font-semibold text-white">{validation.status}</p></div><div className="grid gap-4 sm:grid-cols-2"><Metric label="Short Value" value={money(validation.short_value)} /><Metric label="Long Value" value={money(validation.long_value)} /><Metric label="Net Debit" value={money(validation.net_premium)} /><Metric label="S/L Ratio" value={Number(validation.sl_ratio || 0).toFixed(3)} /><Metric label="VIX Ratio" value={Number(validation.vix_ratio || 0).toFixed(3)} /><Metric label="VIX Zone" value={validation.vix_zone_label || "-"} /><Metric label="Profit Target" value={validation.profit_target_pct ? pct(validation.profit_target_pct) : "-"} /><Metric label="Suggested Contracts" value={validation.contracts ?? "-"} /><Metric label="Debit / Lot" value={money(validation.premium_per_contract)} /></div><div className="space-y-3">{validation.messages?.map((message) => <div key={`${message.rule}-${message.message}`} className="rounded-2xl border border-edge bg-ink/60 p-4"><p className="font-mono text-xs text-gold">{message.rule}</p><p className="mt-2 text-sm text-slate-300">{message.message}</p></div>)}</div></div></div>
      </Section>

      <Section title="Daily Trade Temperature" subtitle="Wednesday and Thursday trades remain independent."><div className="grid gap-6 xl:grid-cols-2">{["wednesday", "thursday"].map((slot) => { const trade = dashboard.trades[slot]; const inputs = tradeInputs[slot] || createTradeInputs(trade); const latest = lastVerdicts[slot]; const isChecking = busyTradeId === trade?.id; return <div key={slot} className="rounded-[2rem] border border-edge bg-ink/65 p-5"><div className="flex justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">{trade?.label || slot}</p><h3 className="mt-3 text-2xl font-semibold text-white">{trade?.status === "EMPTY" ? "EMPTY" : trade?.id}</h3><p className="mt-2 text-sm text-slate-400">Entry: {formatDate(trade?.entry_date)} • Day {trade?.day_number || 0}</p><p className="mt-2 text-xs font-mono uppercase tracking-[0.18em] text-slate-500">Last check: {formatDateTime(trade?.last_check)}</p></div><div className={`h-fit rounded-full border px-4 py-2 font-mono text-xs ${statusClasses(trade?.status || "EMPTY")}`}>{trade?.status || "EMPTY"}</div></div><div className="mt-5 grid gap-4 md:grid-cols-4"><Metric label="Highest P/L Yet" value={pct(trade?.hwm_pct)} /><Metric label="Current P/L" value={trade?.last_metrics ? pct(trade.last_metrics.current_pl_pct) : "-"} /><Metric label="DTE" value={trade?.last_metrics?.current_dte ?? "-"} /><Metric label="Last Check" value={formatDateTime(trade?.last_check)} /></div><div className="mt-4 rounded-3xl border border-teal/30 bg-teal/10 p-4"><p className="font-mono text-xs uppercase tracking-[0.22em] text-teal">Auto Monitor</p><p className="mt-3 text-sm leading-7 text-slate-300">{trade?.status === "OPEN" ? `Monitoring is active every ${dashboard.settings.auto_poll_interval_minutes ?? 2} minutes during market hours.` : "No auto-monitoring until a trade is opened in this slot."}</p><p className="mt-2 text-sm text-slate-400">{trade?.last_scrape_message || "No scrape status recorded yet."}</p></div><div className="mt-4 rounded-3xl border border-edge bg-panel p-4"><p className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Next Move</p><p className="mt-3 text-sm leading-7 text-slate-300">{getTradeGuidance(trade, latest)}</p></div>{trade?.status !== "EMPTY" ? <><div className="mt-5 rounded-3xl border border-edge bg-panel p-4"><Field label="OptionStrat URL" type="text" value={inputs.optionstrat_url} onChange={(value) => setTradeInputs((current) => ({ ...current, [slot]: { ...(current[slot] || {}), optionstrat_url: value } }))} placeholder="https://optionstrat.com/save/..." /><p className="mt-3 text-sm text-slate-400">Run Check pulls live current P/L, highest P/L yet, and DTE from this link.</p></div><div className="mt-5 flex flex-wrap gap-3"><button className="rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60" disabled={isChecking} onClick={() => runCheck(trade)}>{isChecking ? "Running Check..." : "Run Check"}</button><button className="rounded-2xl border border-edge bg-panel px-4 py-3 text-sm font-medium text-white" onClick={() => saveInputs(trade)}>Save Link</button><button className="rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-medium text-danger" onClick={() => closeTrade(trade)}>Mark Closed</button></div></> : <div className="mt-5 rounded-3xl border border-dashed border-edge p-5 text-sm text-slate-500">Save a {trade?.label?.toLowerCase() || slot} trade to activate this slot.</div>}</div>; })}</div></Section>
    </main>
  </div>

  {settingsOpen ? <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm"><div className="h-full w-full max-w-2xl overflow-auto border-l border-edge bg-panel p-6"><div className="flex items-start justify-between"><div><p className="font-mono text-xs uppercase tracking-[0.28em] text-gold">Settings</p><h2 className="mt-3 text-2xl font-semibold text-white">Decision Engine Controls</h2></div><button className="rounded-2xl border border-edge px-4 py-2 text-sm text-slate-300" onClick={() => setSettingsOpen(false)}>Close</button></div><div className="mt-6 grid gap-4 md:grid-cols-2">{SETTINGS_FIELDS.map(([key, label, type]) => <Field key={key} label={label} type={type} value={settingsDraft[key] ?? (key === "auto_poll_interval_minutes" ? 2 : "")} onChange={(value) => setSettingsDraft((current) => ({ ...current, [key]: value }))} />)}</div><div className="mt-4 rounded-2xl border border-edge bg-ink/60 px-4 py-3 text-sm text-slate-400">Open trades are checked automatically every {settingsDraft.auto_poll_interval_minutes ?? dashboard.settings.auto_poll_interval_minutes ?? 2} minutes on weekdays.</div><div className="mt-6 rounded-3xl border border-edge bg-ink/60 p-5"><p className="font-mono text-xs uppercase tracking-[0.24em] text-teal">Telegram Alerts</p><p className="mt-2 text-sm text-slate-400">Enable alerts here after the server environment is configured.</p><div className="mt-5 grid gap-4 md:grid-cols-2"><label className="flex items-center gap-3 rounded-2xl border border-edge bg-panel px-4 py-3 text-sm text-slate-300"><input type="checkbox" checked={Boolean(settingsDraft.telegram_alerts_enabled)} onChange={(event) => setSettingsDraft((current) => ({ ...current, telegram_alerts_enabled: event.target.checked }))} />Enable Telegram alerts</label><Field label="Telegram Chat ID" type="text" value={settingsDraft.telegram_chat_id ?? ""} onChange={(value) => setSettingsDraft((current) => ({ ...current, telegram_chat_id: value }))} /></div><button className="mt-4 rounded-2xl border border-teal/40 bg-teal/10 px-4 py-3 text-sm font-medium text-teal" onClick={sendTelegramTest}>Send Test Alert</button></div><div className="mt-6 flex gap-3"><button className="rounded-2xl bg-gold px-4 py-3 text-sm font-semibold text-slate-950" onClick={saveSettings}>Save Settings</button><button className="rounded-2xl border border-edge px-4 py-3 text-sm text-slate-300" onClick={() => setSettingsOpen(false)}>Cancel</button></div></div></div> : null}</div>;
}
