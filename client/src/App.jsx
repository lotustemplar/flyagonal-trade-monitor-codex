import { useEffect, useMemo, useState } from "react";

const LEG_TEMPLATE = [
  { role: "short_put_calendar", name: "Put Calendar Short Put", direction: "STO", qty: "1", premium: "", dte: "8", strike: "", locked: true },
  { role: "long_put_calendar", name: "Put Calendar Long Put", direction: "BTO", qty: "1", premium: "", dte: "12", strike: "", locked: true },
  { role: "short_call", name: "Call Fly Short Call", direction: "STO", qty: "2", premium: "", dte: "8", strike: "", delta: "8" },
  { role: "long_call_lower", name: "Call Fly Lower Long Call", direction: "BTO", qty: "1", premium: "", dte: "8", strike: "", locked: true },
  { role: "long_call_upper", name: "Call Fly Upper Long Call", direction: "BTO", qty: "1", premium: "", dte: "8", strike: "", locked: true }
];

const EMPTY_VALIDATION = { status: "APPROVED", short_value: 0, long_value: 0, total_value: 0, net_premium: 0, premium_per_contract: 0, sl_ratio: 0, messages: [] };
const SETTINGS_FIELDS = [["vix_block_low", "VIX Full Block Low", "number"], ["vix_block_high", "VIX Full Block High", "number"], ["sl_ratio_floor", "S/L Ratio Hard Floor", "number"], ["sl_ratio_preferred", "S/L Ratio Preferred Min", "number"], ["premium_per_contract_min", "Premium Per Contract Min", "number"], ["hwm_threshold_pct", "Day 4 HWM Threshold", "number"], ["profit_target_pct", "Profit Target", "number"], ["auto_poll_time_1", "Auto-Poll Time 1", "time"], ["auto_poll_time_2", "Auto-Poll Time 2", "time"]];

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const payload = (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload.error || payload.message || "Request failed.");
  return payload;
}

function money(value) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value || 0)); }
function pct(value) { return `${Number(value || 0).toFixed(1)}%`; }
function formatDate(value) { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "-"; }
function statusClasses(status) { if (String(status).includes("BLOCK") || String(status).includes("CLOSE")) return "border-danger/40 bg-danger/15 text-danger"; if (String(status).includes("CAUTION") || String(status).includes("SCALE") || String(status).includes("WARNING")) return "border-amber/40 bg-amber/15 text-amber"; return "border-safe/40 bg-safe/15 text-safe"; }
function roundToNearestFive(value) { return Number.isFinite(value) ? String(Math.round(value / 5) * 5) : ""; }

function deriveLegsFromStructure(form) {
  const putStrike = roundToNearestFive(Number(form.spx_price) * 0.981);
  const shortCallStrike = Number(form.short_call_strike);
  const hasShortCall = Number.isFinite(shortCallStrike) && form.short_call_strike !== "";
  const lowerWing = hasShortCall ? String(shortCallStrike - 30) : "";
  const upperWing = hasShortCall ? String(shortCallStrike + 30) : "";
  return form.legs.map((leg) => {
    if (leg.role === "short_put_calendar") return { ...leg, direction: "STO", dte: "8", strike: putStrike };
    if (leg.role === "long_put_calendar") return { ...leg, direction: "BTO", dte: "12", strike: putStrike };
    if (leg.role === "short_call") return { ...leg, direction: "STO", qty: leg.qty || "2", dte: "8", strike: form.short_call_strike };
    if (leg.role === "long_call_lower") return { ...leg, direction: "BTO", dte: "8", strike: lowerWing };
    if (leg.role === "long_call_upper") return { ...leg, direction: "BTO", dte: "8", strike: upperWing };
    return leg;
  });
}

function createTradeInputs(trade) {
  return { optionstrat_url: trade?.optionstrat_url || "", current_pl_pct: trade?.manual_inputs?.current_pl_pct ?? "", hwm_pct: trade?.manual_inputs?.hwm_pct ?? trade?.hwm_pct ?? "", current_dte: trade?.manual_inputs?.current_dte ?? "", vix_current: trade?.manual_inputs?.vix_current ?? "", vix_yesterday: trade?.manual_inputs?.vix_yesterday ?? "", vix_3days_ago: trade?.manual_inputs?.vix_3days_ago ?? "", spx_consecutive_days: trade?.manual_inputs?.spx_consecutive_days ?? 0, macro_risk_within_2_days: Boolean(trade?.manual_inputs?.macro_risk_within_2_days) };
}

function getTradeGuidance(trade, latestVerdict) {
  if (!trade || trade.status === "EMPTY") return "No trade is open here. Use the entry builder after the calendar gate is safe.";
  if (!trade.optionstrat_url) return "Paste and save the OptionStrat link, then run the first temperature check.";
  if (!latestVerdict) return "Run the first check to establish HWM, P/L, DTE, and a rule-based verdict.";
  if (latestVerdict.verdict.includes("CLOSE")) return "Action needed now: close the instructed size, then mark the trade closed.";
  if (latestVerdict.verdict.includes("SCALE")) return "Scale out the instructed amount, then rerun the check after the adjustment.";
  return "No urgent action. Keep manual fields fresh and let the next check confirm the hold.";
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
  const [entryForm, setEntryForm] = useState({ vix: "", vix9d: "", spx_price: "", short_call_strike: "", trade_day: "Wednesday", optionstrat_url: "", entry_date: "", legs: LEG_TEMPLATE });
  const [settingsDraft, setSettingsDraft] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tradeInputs, setTradeInputs] = useState({});
  const [calendarVix, setCalendarVix] = useState("");
  const [error, setError] = useState("");

  const derivedLegs = useMemo(() => deriveLegsFromStructure(entryForm), [entryForm]);
  const putStrike = derivedLegs.find((leg) => leg.role === "short_put_calendar")?.strike || "-";
  const lowerWing = derivedLegs.find((leg) => leg.role === "long_call_lower")?.strike || "-";
  const upperWing = derivedLegs.find((leg) => leg.role === "long_call_upper")?.strike || "-";
  const lastVerdicts = { wednesday: dashboard.trades.wednesday?.verdicts?.at(-1), thursday: dashboard.trades.thursday?.verdicts?.at(-1) };

  async function loadDashboard() {
    const data = await api("/api/trades");
    setDashboard(data);
    setSettingsDraft(data.settings);
    setTradeInputs({ wednesday: createTradeInputs(data.trades.wednesday), thursday: createTradeInputs(data.trades.thursday) });
  }
  async function loadCalendar(vixValue = calendarVix) { setCalendar(await api(`/api/calendar${vixValue ? `?vix=${encodeURIComponent(vixValue)}` : ""}`)); }

  useEffect(() => { Promise.all([loadDashboard(), loadCalendar()]).catch((err) => setError(err.message)); }, []);
  useEffect(() => {
    const timer = setTimeout(async () => {
      try { setValidation(await api("/api/validate-entry", { method: "POST", body: JSON.stringify({ ...entryForm, legs: derivedLegs }) })); } catch (err) { setError(err.message); }
    }, 250);
    return () => clearTimeout(timer);
  }, [entryForm, derivedLegs]);

  async function saveTrade() { await api("/api/save-trade", { method: "POST", body: JSON.stringify({ ...entryForm, legs: derivedLegs }) }); await loadDashboard(); }
  async function runCheck(trade) { await api(`/api/check-trade/${trade.id}`, { method: "POST", body: JSON.stringify(tradeInputs[trade.slot] || {}) }); await loadDashboard(); }
  async function saveInputs(trade) { const { optionstrat_url, ...manual_inputs } = tradeInputs[trade.slot] || {}; await api(`/api/trade/${trade.id}/update`, { method: "PUT", body: JSON.stringify({ optionstrat_url, manual_inputs }) }); await loadDashboard(); }
  async function closeTrade(trade) { await api(`/api/trade/${trade.id}/close`, { method: "PUT" }); await loadDashboard(); }
  async function saveSettings() { await api("/api/settings", { method: "PUT", body: JSON.stringify(settingsDraft) }); await loadDashboard(); setSettingsOpen(false); }
  async function sendTelegramTest() { await api("/api/alerts/test", { method: "POST" }); }

  return <div className="relative overflow-hidden"><div className="pointer-events-none absolute inset-0 grid-overlay opacity-40" /><div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <header className="mb-8 overflow-hidden rounded-[2rem] border border-edge bg-panel/90 shadow-glow backdrop-blur"><div className="relative p-6"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,212,184,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(240,180,41,0.16),transparent_36%)]" /><div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"><div><p className="font-mono text-xs uppercase tracking-[0.4em] text-teal">Flyagonal Trade Monitor</p><h1 className="mt-3 text-4xl font-semibold text-white">Flyagonal Trade Monitor</h1><p className="mt-2 text-base text-slate-300">by Lotus Tempar</p><p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400">A guided control room that auto-builds the Flyagonal structure, checks trade health, and sends Telegram checkpoints.</p></div><button className="rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm font-medium text-gold" onClick={() => setSettingsOpen(true)}>Open Settings</button></div>{error ? <div className="relative mt-6 rounded-2xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div> : null}</div></header>

    <main className="space-y-8">
      <Section title="Next Step" subtitle="What to do right now."><div className="grid gap-4 md:grid-cols-3"><div className={`rounded-3xl border p-5 ${statusClasses(calendar?.status || "CLEAR")}`}><p className="font-semibold text-white">Calendar</p><p className="mt-2 text-sm">{calendar?.primary_message || "Refresh the calendar gate before entry."}</p></div><div className={`rounded-3xl border p-5 ${statusClasses(validation.status)}`}><p className="font-semibold text-white">Entry Builder</p><p className="mt-2 text-sm">{validation.status === "BLOCKED" ? "Fix blocked inputs before saving." : "Enter SPX, the 8-delta call strike, and premiums."}</p></div><div className="rounded-3xl border border-teal/40 bg-teal/10 p-5"><p className="font-semibold text-white">Structure</p><p className="mt-2 text-sm text-slate-300">Put calendar and call wings update automatically as you type.</p></div></div></Section>

      <Section title="Today's Entry Gate" subtitle="Macro filter for the 8-day trade window." action={<div className="flex gap-3"><input className="rounded-2xl border border-edge bg-ink/70 px-4 py-3 font-mono text-sm text-white" placeholder="Current VIX" value={calendarVix} onChange={(event) => setCalendarVix(event.target.value)} /><button className="rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-slate-950" onClick={() => loadCalendar(calendarVix)}>Refresh</button></div>}><div className={`inline-flex rounded-full border px-4 py-2 font-mono text-sm ${statusClasses(calendar?.status || "CLEAR")}`}>{calendar?.badge || "CLEAR TO TRADE"}</div><p className="mt-4 text-sm text-slate-300">{calendar?.primary_message || "Load the calendar to check FOMC, NFP, CPI, PCE, and holiday filters."}</p></Section>

      <Section title="Trade Entry Builder" subtitle="SPX and the 8-delta short call drive the automatic structure." action={<button className={`rounded-2xl px-4 py-3 text-sm font-semibold ${validation.status === "BLOCKED" ? "bg-slate-700 text-slate-400" : "bg-gold text-slate-950"}`} onClick={saveTrade} disabled={validation.status === "BLOCKED"}>Save Trade</button>}>
        <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]"><div className="space-y-6"><div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6"><Field label="VIX" value={entryForm.vix} onChange={(value) => setEntryForm((current) => ({ ...current, vix: value }))} /><Field label="VIX9D" value={entryForm.vix9d} onChange={(value) => setEntryForm((current) => ({ ...current, vix9d: value }))} /><Field label="SPX Price" value={entryForm.spx_price} onChange={(value) => setEntryForm((current) => ({ ...current, spx_price: value }))} /><Field label="8-delta call strike" value={entryForm.short_call_strike} onChange={(value) => setEntryForm((current) => ({ ...current, short_call_strike: value }))} /><Field label="Trade Day" type="text" value={entryForm.trade_day} onChange={(value) => setEntryForm((current) => ({ ...current, trade_day: value }))} /><Field label="Entry Date" type="date" value={entryForm.entry_date} onChange={(value) => setEntryForm((current) => ({ ...current, entry_date: value }))} /></div><Field label="OptionStrat URL" type="text" value={entryForm.optionstrat_url} onChange={(value) => setEntryForm((current) => ({ ...current, optionstrat_url: value }))} placeholder="https://optionstrat.com/save/..." />
        <div className="grid gap-4 md:grid-cols-3"><Metric label="Put Calendar Strike" value={putStrike} /><Metric label="Short Call Center" value={entryForm.short_call_strike || "-"} /><Metric label="Bought Call Wings" value={`${lowerWing} / ${upperWing}`} /></div>
        <div className="space-y-4">{derivedLegs.map((leg, index) => <div key={leg.role} className="rounded-3xl border border-edge bg-ink/55 p-4"><div className="mb-4 flex items-center justify-between"><div><p className="font-medium text-white">{leg.name}</p><p className="mt-1 font-mono text-xs uppercase tracking-[0.24em] text-slate-500">{leg.direction} {leg.locked ? "AUTO" : "MANUAL"}</p></div></div><div className="grid gap-4 md:grid-cols-5"><Field label="Qty" value={leg.qty} onChange={(value) => setEntryForm((current) => ({ ...current, legs: current.legs.map((item, i) => i === index ? { ...item, qty: value } : item) }))} /><Field label="Premium" value={leg.premium} onChange={(value) => setEntryForm((current) => ({ ...current, legs: current.legs.map((item, i) => i === index ? { ...item, premium: value } : item) }))} /><Field label="DTE" value={leg.dte} disabled onChange={() => {}} /><Field label="Strike" value={leg.strike} disabled onChange={() => {}} />{leg.role === "short_call" ? <Field label="Delta" value={leg.delta || "8"} onChange={(value) => setEntryForm((current) => ({ ...current, legs: current.legs.map((item, i) => i === index ? { ...item, delta: value } : item) }))} /> : <Field label="Role" type="text" value={leg.role} disabled onChange={() => {}} />}</div></div>)}</div></div><div className="space-y-5"><div className={`rounded-3xl border p-5 ${statusClasses(validation.status)}`}><p className="font-mono text-xs uppercase tracking-[0.3em]">Entry Status</p><p className="mt-3 text-2xl font-semibold text-white">{validation.status}</p></div><div className="grid gap-4 sm:grid-cols-2"><Metric label="Short Value" value={money(validation.short_value)} /><Metric label="Long Value" value={money(validation.long_value)} /><Metric label="Net Premium" value={money(validation.net_premium)} /><Metric label="S/L Ratio" value={Number(validation.sl_ratio || 0).toFixed(3)} /><Metric label="Premium / Contract" value={money(validation.premium_per_contract)} /></div><div className="space-y-3">{validation.messages?.map((message) => <div key={`${message.rule}-${message.message}`} className="rounded-2xl border border-edge bg-ink/60 p-4"><p className="font-mono text-xs text-gold">{message.rule}</p><p className="mt-2 text-sm text-slate-300">{message.message}</p></div>)}</div></div></div>
      </Section>

      <Section title="Daily Trade Temperature" subtitle="Wednesday and Thursday trades remain independent."><div className="grid gap-6 xl:grid-cols-2">{["wednesday", "thursday"].map((slot) => { const trade = dashboard.trades[slot]; const inputs = tradeInputs[slot] || createTradeInputs(trade); const latest = lastVerdicts[slot]; return <div key={slot} className="rounded-[2rem] border border-edge bg-ink/65 p-5"><div className="flex justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">{trade?.label || slot}</p><h3 className="mt-3 text-2xl font-semibold text-white">{trade?.status === "EMPTY" ? "EMPTY" : trade?.id}</h3><p className="mt-2 text-sm text-slate-400">Entry: {formatDate(trade?.entry_date)} • Day {trade?.day_number || 0}</p></div><div className={`h-fit rounded-full border px-4 py-2 font-mono text-xs ${statusClasses(trade?.status || "EMPTY")}`}>{trade?.status || "EMPTY"}</div></div><div className="mt-5 grid gap-4 md:grid-cols-3"><Metric label="HWM" value={pct(trade?.hwm_pct)} /><Metric label="P/L" value={trade?.last_metrics ? pct(trade.last_metrics.current_pl_pct) : "-"} /><Metric label="DTE" value={trade?.last_metrics?.current_dte ?? "-"} /></div><div className="mt-4 rounded-3xl border border-edge bg-panel p-4"><p className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Next Move</p><p className="mt-3 text-sm leading-7 text-slate-300">{getTradeGuidance(trade, latest)}</p></div>{trade?.status !== "EMPTY" ? <><div className="mt-5 grid gap-4 md:grid-cols-2"><Field label="OptionStrat URL" type="text" value={inputs.optionstrat_url} onChange={(value) => setTradeInputs((current) => ({ ...current, [slot]: { ...(current[slot] || {}), optionstrat_url: value } }))} /><Field label="Current P/L %" value={inputs.current_pl_pct} onChange={(value) => setTradeInputs((current) => ({ ...current, [slot]: { ...(current[slot] || {}), current_pl_pct: value } }))} /><Field label="HWM %" value={inputs.hwm_pct} onChange={(value) => setTradeInputs((current) => ({ ...current, [slot]: { ...(current[slot] || {}), hwm_pct: value } }))} /><Field label="Current DTE" value={inputs.current_dte} onChange={(value) => setTradeInputs((current) => ({ ...current, [slot]: { ...(current[slot] || {}), current_dte: value } }))} /></div><div className="mt-5 flex flex-wrap gap-3"><button className="rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-slate-950" onClick={() => runCheck(trade)}>Run Check</button><button className="rounded-2xl border border-edge bg-panel px-4 py-3 text-sm font-medium text-white" onClick={() => saveInputs(trade)}>Save Inputs</button><button className="rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-medium text-danger" onClick={() => closeTrade(trade)}>Mark Closed</button></div></> : <div className="mt-5 rounded-3xl border border-dashed border-edge p-5 text-sm text-slate-500">Save a {trade?.label?.toLowerCase() || slot} trade to activate this slot.</div>}</div>; })}</div></Section>
    </main>
  </div>

  {settingsOpen ? <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm"><div className="h-full w-full max-w-2xl overflow-auto border-l border-edge bg-panel p-6"><div className="flex items-start justify-between"><div><p className="font-mono text-xs uppercase tracking-[0.28em] text-gold">Settings</p><h2 className="mt-3 text-2xl font-semibold text-white">Decision Engine Controls</h2></div><button className="rounded-2xl border border-edge px-4 py-2 text-sm text-slate-300" onClick={() => setSettingsOpen(false)}>Close</button></div><div className="mt-6 grid gap-4 md:grid-cols-2">{SETTINGS_FIELDS.map(([key, label, type]) => <Field key={key} label={label} type={type} value={settingsDraft[key] ?? ""} onChange={(value) => setSettingsDraft((current) => ({ ...current, [key]: value }))} />)}</div><div className="mt-6 rounded-3xl border border-edge bg-ink/60 p-5"><p className="font-mono text-xs uppercase tracking-[0.24em] text-teal">Telegram Alerts</p><p className="mt-2 text-sm text-slate-400">Set TELEGRAM_BOT_TOKEN on the server, then enable alerts here.</p><div className="mt-5 grid gap-4 md:grid-cols-2"><label className="flex items-center gap-3 rounded-2xl border border-edge bg-panel px-4 py-3 text-sm text-slate-300"><input type="checkbox" checked={Boolean(settingsDraft.telegram_alerts_enabled)} onChange={(event) => setSettingsDraft((current) => ({ ...current, telegram_alerts_enabled: event.target.checked }))} />Enable Telegram alerts</label><Field label="Telegram Chat ID" type="text" value={settingsDraft.telegram_chat_id ?? ""} onChange={(value) => setSettingsDraft((current) => ({ ...current, telegram_chat_id: value }))} /></div><button className="mt-4 rounded-2xl border border-teal/40 bg-teal/10 px-4 py-3 text-sm font-medium text-teal" onClick={sendTelegramTest}>Send Test Alert</button></div><div className="mt-6 flex gap-3"><button className="rounded-2xl bg-gold px-4 py-3 text-sm font-semibold text-slate-950" onClick={saveSettings}>Save Settings</button><button className="rounded-2xl border border-edge px-4 py-3 text-sm text-slate-300" onClick={() => setSettingsOpen(false)}>Cancel</button></div></div></div> : null}</div>;
}
