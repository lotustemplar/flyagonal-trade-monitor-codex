import { useEffect, useMemo, useState } from "react";

const LEG_TEMPLATE = [
  { name: "Short Call", direction: "STO", qty: "1", premium: "", dte: "", strike: "" },
  { name: "Short Put", direction: "STO", qty: "1", premium: "", dte: "", strike: "" },
  { name: "Long Put Short", direction: "STO", qty: "1", premium: "", dte: "", strike: "" },
  { name: "Long Call", direction: "BTO", qty: "1", premium: "", dte: "", strike: "" },
  { name: "Long Call", direction: "BTO", qty: "1", premium: "", dte: "", strike: "" },
  { name: "Long Put", direction: "BTO", qty: "1", premium: "", dte: "", strike: "" }
];

const SETTINGS_FIELDS = [
  ["vix_optimal_low", "VIX Optimal Low", "number"],
  ["vix_optimal_high", "VIX Optimal High", "number"],
  ["vix_block_low", "VIX Full Block Low", "number"],
  ["vix_block_high", "VIX Full Block High", "number"],
  ["sl_ratio_floor", "S/L Ratio Hard Floor", "number"],
  ["sl_ratio_preferred", "S/L Ratio Preferred Min", "number"],
  ["premium_per_contract_min", "Premium Per Contract Min", "number"],
  ["hwm_threshold_pct", "Day 4 HWM Threshold", "number"],
  ["profit_target_pct", "Profit Target", "number"],
  ["scale_out_1_dte", "Scale Out 1 Trigger DTE", "number"],
  ["scale_out_1_hwm_min", "Scale Out 1 HWM Min", "number"],
  ["auto_poll_time_1", "Auto-Poll Time 1", "time"],
  ["auto_poll_time_2", "Auto-Poll Time 2", "time"],
  ["calendar_refresh_time", "Calendar Refresh Time", "time"]
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload.error || payload.message || "Request failed.");
  return payload;
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value || 0));
}

function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatTimestamp(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function statusClasses(status) {
  if (String(status).includes("BLOCK") || String(status).includes("CLOSE")) return "border-danger/40 bg-danger/15 text-danger";
  if (String(status).includes("CAUTION") || String(status).includes("SCALE") || String(status).includes("WARNING")) return "border-amber/40 bg-amber/15 text-amber";
  return "border-safe/40 bg-safe/15 text-safe";
}

function createTradeInputs(trade) {
  return {
    optionstrat_url: trade?.optionstrat_url || "",
    current_pl_pct: trade?.manual_inputs?.current_pl_pct ?? "",
    hwm_pct: trade?.manual_inputs?.hwm_pct ?? trade?.hwm_pct ?? "",
    current_dte: trade?.manual_inputs?.current_dte ?? "",
    vix_current: trade?.manual_inputs?.vix_current ?? "",
    vix_yesterday: trade?.manual_inputs?.vix_yesterday ?? "",
    vix_3days_ago: trade?.manual_inputs?.vix_3days_ago ?? "",
    spx_consecutive_days: trade?.manual_inputs?.spx_consecutive_days ?? 0,
    macro_risk_within_2_days: Boolean(trade?.manual_inputs?.macro_risk_within_2_days)
  };
}

function serializeTradeInputs(inputs) {
  const { optionstrat_url, ...manual_inputs } = inputs || {};
  return { optionstrat_url, manual_inputs };
}

function getTradeGuidance(trade, latestVerdict) {
  if (!trade || trade.status === "EMPTY") return "No trade is open in this slot. Use the entry validator when the calendar is clear or manageable.";
  if (!trade.optionstrat_url) return "Save the OptionStrat link first so the app can scrape live trade data before each check.";
  if (!latestVerdict) return "Run the first temperature check to establish the trade’s initial checkpoint and verdict history.";
  if (latestVerdict.verdict.includes("CLOSE")) return "This trade needs action now. Close the requested size, then mark the trade closed once the position is out.";
  if (latestVerdict.verdict.includes("SCALE")) return "Scale out the amount shown in the verdict, then rerun the check after the position update to confirm the next step.";
  return "No urgent action right now. Keep the manual fields current and let the next scheduled check confirm the hold.";
}

function buildActionItems(calendar, validation, trades, lastVerdicts) {
  const items = [];
  if (!calendar) {
    items.push({ tone: "amber", title: "Step 1: Refresh the calendar gate", detail: "Load the current 8-day macro window before opening a new trade." });
  } else if (calendar.status === "BLOCKED") {
    items.push({ tone: "red", title: "Do not open a new trade today", detail: calendar.primary_message });
  } else if (calendar.status === "CAUTION") {
    items.push({ tone: "amber", title: "Trade is allowed, but size down", detail: calendar.primary_message });
  } else {
    items.push({ tone: "green", title: "Calendar gate is clear", detail: "You can move to entry validation and build the next setup." });
  }

  if (validation.status === "BLOCKED") {
    items.push({ tone: "red", title: "Fix the structure before saving", detail: validation.messages[0]?.message || "The current setup is blocked." });
  } else if (validation.status === "CAUTION") {
    items.push({ tone: "amber", title: "Entry needs reduced size", detail: validation.messages[0]?.message || "The structure is tradable with caution." });
  }

  for (const slot of ["wednesday", "thursday"]) {
    const trade = trades[slot];
    const latestVerdict = lastVerdicts[slot];
    if (trade?.status === "OPEN") {
      items.push({ tone: latestVerdict?.verdict?.includes("CLOSE") ? "red" : latestVerdict?.verdict?.includes("SCALE") ? "amber" : "teal", title: `${trade.label}: ${latestVerdict?.verdict || "Run check"}`, detail: getTradeGuidance(trade, latestVerdict) });
    }
  }

  if (items.length === 1) items.push({ tone: "teal", title: "Open the next qualified trade", detail: "Enter the legs, confirm the ratio, then save the setup into the Wednesday or Thursday slot." });
  return items.slice(0, 5);
}

function Field({ label, value, onChange, placeholder = "", type = "number" }) {
  return <label className="block"><span className="mb-2 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-edge bg-panel px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-gold/60" /></label>;
}

function Section({ id, title, subtitle, action, children }) {
  return <section id={id} className="rounded-3xl border border-edge bg-panel/90 shadow-glow backdrop-blur"><div className="flex flex-col gap-4 border-b border-edge px-6 py-5 md:flex-row md:items-center md:justify-between"><div><p className="font-mono text-xs uppercase tracking-[0.28em] text-gold/80">{title}</p><p className="mt-2 text-sm text-slate-400">{subtitle}</p></div>{action}</div><div className="p-6">{children}</div></section>;
}

function Metric({ label, value, tone = "text-white" }) {
  return <div className="rounded-2xl border border-edge bg-ink/60 p-4"><p className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p><p className={`mt-2 font-mono text-xl ${tone}`}>{value}</p></div>;
}

export default function App() {
  const [dashboard, setDashboard] = useState({ settings: {}, trades: { wednesday: null, thursday: null } });
  const [calendar, setCalendar] = useState(null);
  const [validation, setValidation] = useState({ status: "APPROVED", short_value: 0, long_value: 0, total_value: 0, net_premium: 0, premium_per_contract: 0, sl_ratio: 0, messages: [] });
  const [entryForm, setEntryForm] = useState({ vix: "", vix9d: "", trade_day: "Wednesday", optionstrat_url: "", entry_date: "", legs: LEG_TEMPLATE });
  const [settingsDraft, setSettingsDraft] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tradeInputs, setTradeInputs] = useState({});
  const [calendarVix, setCalendarVix] = useState("");
  const [busy, setBusy] = useState({});
  const [error, setError] = useState("");

  async function loadDashboard() {
    const data = await api("/api/trades");
    setDashboard(data);
    setSettingsDraft(data.settings);
    setTradeInputs((current) => ({
      wednesday: { ...(current.wednesday || {}), ...createTradeInputs(data.trades.wednesday) },
      thursday: { ...(current.thursday || {}), ...createTradeInputs(data.trades.thursday) }
    }));
  }

  async function loadCalendar(vixValue = calendarVix) {
    const query = vixValue ? `?vix=${encodeURIComponent(vixValue)}` : "";
    const data = await api(`/api/calendar${query}`);
    setCalendar(data);
  }

  useEffect(() => {
    Promise.all([loadDashboard(), loadCalendar()]).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const result = await api("/api/validate-entry", { method: "POST", body: JSON.stringify(entryForm) });
        setValidation(result);
      } catch (err) {
        setError(err.message);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [entryForm]);

  const lastVerdicts = useMemo(() => ({
    wednesday: dashboard.trades.wednesday?.verdicts?.at(-1) || null,
    thursday: dashboard.trades.thursday?.verdicts?.at(-1) || null
  }), [dashboard]);

  const actionItems = useMemo(() => buildActionItems(calendar, validation, dashboard.trades, lastVerdicts), [calendar, validation, dashboard.trades, lastVerdicts]);

  async function saveTrade() {
    setBusy((current) => ({ ...current, saveTrade: true }));
    try {
      await api("/api/save-trade", { method: "POST", body: JSON.stringify(entryForm) });
      await loadDashboard();
    } catch (err) { setError(err.message); } finally { setBusy((current) => ({ ...current, saveTrade: false })); }
  }

  async function saveSettings() {
    setBusy((current) => ({ ...current, settings: true }));
    try {
      const payload = Object.fromEntries(Object.entries(settingsDraft).map(([key, value]) => {
        if (typeof value === "boolean" || String(key).includes("time") || key === "timezone" || key === "telegram_chat_id") return [key, value];
        const parsed = Number(value);
        return [key, Number.isNaN(parsed) ? value : parsed];
      }));
      await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
      await loadDashboard();
      setSettingsOpen(false);
    } catch (err) { setError(err.message); } finally { setBusy((current) => ({ ...current, settings: false })); }
  }

  async function runCheck(trade) {
    setBusy((current) => ({ ...current, [`check-${trade.slot}`]: true }));
    try {
      await api(`/api/check-trade/${trade.id}`, { method: "POST", body: JSON.stringify(tradeInputs[trade.slot] || {}) });
      await loadDashboard();
    } catch (err) { setError(err.message); } finally { setBusy((current) => ({ ...current, [`check-${trade.slot}`]: false })); }
  }

  async function persistTradeInputs(trade) {
    setBusy((current) => ({ ...current, [`persist-${trade.slot}`]: true }));
    try {
      await api(`/api/trade/${trade.id}/update`, { method: "PUT", body: JSON.stringify(serializeTradeInputs(tradeInputs[trade.slot])) });
      await loadDashboard();
    } catch (err) { setError(err.message); } finally { setBusy((current) => ({ ...current, [`persist-${trade.slot}`]: false })); }
  }

  async function closeTrade(trade) {
    setBusy((current) => ({ ...current, [`close-${trade.slot}`]: true }));
    try {
      await api(`/api/trade/${trade.id}/close`, { method: "PUT" });
      await loadDashboard();
    } catch (err) { setError(err.message); } finally { setBusy((current) => ({ ...current, [`close-${trade.slot}`]: false })); }
  }

  async function sendTelegramTest() {
    setBusy((current) => ({ ...current, telegramTest: true }));
    try { await api("/api/alerts/test", { method: "POST" }); } catch (err) { setError(err.message); } finally { setBusy((current) => ({ ...current, telegramTest: false })); }
  }

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-overlay opacity-40" />
      <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-8 overflow-hidden rounded-[2rem] border border-edge bg-panel/90 shadow-glow backdrop-blur">
          <div className="relative p-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,212,184,0.14),transparent_28%),radial-gradient(circle_at_top_right,rgba(240,180,41,0.16),transparent_36%)]" />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.4em] text-teal">Flyagonal Trade Monitor</p>
                <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">Flyagonal Trade Monitor</h1>
                <p className="mt-2 text-base text-slate-300">by Lotus Tempar</p>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400">A guided dark-mode dashboard that tells you what to do next, checks each trade independently, and can push milestone alerts to Telegram.</p>
              </div>
              <button className="rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm font-medium text-gold transition hover:bg-gold/20" onClick={() => setSettingsOpen(true)}>⚙ Open Settings</button>
            </div>
            {error ? <div className="relative mt-6 rounded-2xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div> : null}
          </div>
        </header>

        <main className="space-y-8">
          <Section id="coach" title="Next Step" subtitle="A spoon-fed action queue based on the gate, the structure, and the latest trade verdicts.">
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">{actionItems.map((item, index) => <div key={`${item.title}-${index}`} className={`rounded-3xl border p-5 ${item.tone === "red" ? "border-danger/40 bg-danger/10" : item.tone === "amber" ? "border-amber/40 bg-amber/10" : item.tone === "teal" ? "border-teal/40 bg-teal/10" : "border-safe/40 bg-safe/10"}`}><p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-300">Action {index + 1}</p><p className="mt-3 text-lg font-semibold text-white">{item.title}</p><p className="mt-3 text-sm leading-7 text-slate-300">{item.detail}</p></div>)}</div>
          </Section>

          <Section id="calendar-gate" title="Today's Entry Gate" subtitle="ForexFactory macro filter for the current 8-day trade window." action={<div className="flex flex-col gap-3 sm:flex-row"><input className="rounded-2xl border border-edge bg-ink/70 px-4 py-3 font-mono text-sm text-white" placeholder="Current VIX" value={calendarVix} onChange={(event) => setCalendarVix(event.target.value)} /><button className="rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-slate-950" onClick={() => loadCalendar(calendarVix)}>Refresh Calendar</button></div>}>
            <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
              <div className="rounded-3xl border border-edge bg-ink/70 p-5">
                <div className={`inline-flex rounded-full border px-4 py-2 font-mono text-sm ${statusClasses(calendar?.status || "CLEAR")}`}>{calendar?.badge || "✅ CLEAR TO TRADE"}</div>
                <p className="mt-5 text-sm leading-7 text-slate-300">{calendar?.primary_message || "Run the calendar refresh to load the latest macro window."}</p>
                <div className="mt-4 rounded-2xl border border-edge bg-panel px-4 py-3 text-sm text-slate-300"><span className="font-semibold text-white">What you should do:</span> {calendar?.status === "BLOCKED" ? "Skip the entry and wait for the next normal session." : calendar?.status === "CAUTION" ? "You can still trade, but follow the reduced-size instruction shown here." : "Move to the entry validator and price the next setup."}</div>
              </div>
              <div className="rounded-3xl border border-edge bg-ink/60 p-5"><p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-400">High-Impact USD Events</p><div className="mt-4 space-y-3">{(calendar?.events || []).length === 0 ? <div className="rounded-2xl border border-dashed border-edge p-5 text-sm text-slate-500">No high-impact USD events were loaded yet.</div> : calendar.events.map((event) => <div key={`${event.iso_date}-${event.event_name}`} className="grid gap-3 rounded-2xl border border-edge bg-panel px-4 py-4 md:grid-cols-[120px,1fr,96px] md:items-center"><div><p className="font-mono text-sm text-gold">Day {event.window_day}</p><p className="mt-1 text-xs text-slate-500">{formatDate(event.iso_date)}</p></div><div><p className="text-sm font-medium text-white">{event.event_name}</p><p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{event.currency} • {event.time}</p></div><div className="rounded-full border border-danger/40 bg-danger/10 px-3 py-2 text-center font-mono text-xs text-danger">HIGH</div></div>)}</div></div>
            </div>
          </Section>

          <Section id="open-trade" title="Trade Entry Validator" subtitle="Live ratio math, premium thresholds, and one-click save into the Wednesday or Thursday slot." action={<button className={`rounded-2xl px-4 py-3 text-sm font-semibold ${validation.status === "BLOCKED" ? "bg-slate-700 text-slate-400" : "bg-gold text-slate-950"}`} onClick={saveTrade} disabled={validation.status === "BLOCKED" || busy.saveTrade}>{busy.saveTrade ? "Saving..." : "Save Trade"}</button>}>
            <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-4">
                  <Field label="VIX" value={entryForm.vix} onChange={(value) => setEntryForm((current) => ({ ...current, vix: value }))} />
                  <Field label="VIX9D" value={entryForm.vix9d} onChange={(value) => setEntryForm((current) => ({ ...current, vix9d: value }))} />
                  <Field label="Trade Day" type="text" value={entryForm.trade_day} onChange={(value) => setEntryForm((current) => ({ ...current, trade_day: value }))} />
                  <Field label="Entry Date" type="date" value={entryForm.entry_date} onChange={(value) => setEntryForm((current) => ({ ...current, entry_date: value }))} />
                </div>
                <Field label="OptionStrat URL" type="text" value={entryForm.optionstrat_url} onChange={(value) => setEntryForm((current) => ({ ...current, optionstrat_url: value }))} placeholder="https://optionstrat.com/save/..." />
                <div className="space-y-4">{entryForm.legs.map((leg, index) => <div key={`${leg.name}-${index}`} className="rounded-3xl border border-edge bg-ink/55 p-4"><div className="mb-4 flex items-center justify-between"><div><p className="font-medium text-white">Leg {index + 1}: {leg.name}</p><p className="mt-1 font-mono text-xs uppercase tracking-[0.24em] text-slate-500">{leg.direction}</p></div></div><div className="grid gap-4 md:grid-cols-4 xl:grid-cols-5"><Field label="Qty" value={leg.qty} onChange={(value) => setEntryForm((current) => ({ ...current, legs: current.legs.map((item, i) => i === index ? { ...item, qty: value } : item) }))} /><Field label="Premium" value={leg.premium} onChange={(value) => setEntryForm((current) => ({ ...current, legs: current.legs.map((item, i) => i === index ? { ...item, premium: value } : item) }))} /><Field label="DTE" value={leg.dte} onChange={(value) => setEntryForm((current) => ({ ...current, legs: current.legs.map((item, i) => i === index ? { ...item, dte: value } : item) }))} /><Field label="Strike" value={leg.strike} onChange={(value) => setEntryForm((current) => ({ ...current, legs: current.legs.map((item, i) => i === index ? { ...item, strike: value } : item) }))} /><Field label="Direction" type="text" value={leg.direction} onChange={(value) => setEntryForm((current) => ({ ...current, legs: current.legs.map((item, i) => i === index ? { ...item, direction: value } : item) }))} /></div></div>)}</div>
              </div>
              <div className="space-y-5"><div className={`rounded-3xl border p-5 ${statusClasses(validation.status)}`}><p className="font-mono text-xs uppercase tracking-[0.3em]">Entry Status</p><p className="mt-3 text-2xl font-semibold text-white">{validation.status}</p></div><div className="grid gap-4 sm:grid-cols-2"><Metric label="Short Value" value={money(validation.short_value)} /><Metric label="Long Value" value={money(validation.long_value)} /><Metric label="Total Value" value={money(validation.total_value)} /><Metric label="Net Premium" value={money(validation.net_premium)} tone={validation.net_premium >= 0 ? "text-safe" : "text-danger"} /><Metric label="S/L Ratio" value={Number(validation.sl_ratio || 0).toFixed(3)} /><Metric label="Premium / Contract" value={money(validation.premium_per_contract)} /></div><div className="rounded-3xl border border-edge bg-ink/60 p-5"><p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-400">Triggered Messages</p><div className="mt-4 space-y-3">{(validation.messages || []).map((message) => <div key={`${message.rule}-${message.message}`} className="rounded-2xl border border-edge bg-panel px-4 py-3"><p className="font-mono text-xs uppercase tracking-[0.2em] text-gold">{message.rule}</p><p className="mt-2 text-sm leading-7 text-slate-300">{message.message}</p></div>)}</div></div></div>
            </div>
          </Section>

          <Section id="daily-check" title="Daily Trade Temperature" subtitle="Independent health checks for the Wednesday and Thursday positions.">
            <div className="grid gap-6 xl:grid-cols-2">{["wednesday", "thursday"].map((slot) => { const trade = dashboard.trades[slot]; const inputs = tradeInputs[slot] || createTradeInputs(trade); const latestVerdict = lastVerdicts[slot]; return <div key={slot} className="rounded-[2rem] border border-edge bg-ink/65 p-5"><div className="flex flex-col gap-4 border-b border-edge pb-4 md:flex-row md:items-start md:justify-between"><div><p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">{trade?.label || slot}</p><h3 className="mt-3 text-2xl font-semibold text-white">{trade?.status === "EMPTY" ? "EMPTY — No trade open" : `${trade?.label} Trade`}</h3><p className="mt-2 text-sm text-slate-400">Entry: {formatDate(trade?.entry_date)} • Day {trade?.day_number || 0} • Last check {formatTimestamp(trade?.last_check)}</p></div><div className={`inline-flex rounded-full border px-4 py-2 font-mono text-xs ${statusClasses(trade?.status || "EMPTY")}`}>{trade?.status || "EMPTY"}</div></div><div className="mt-5 grid gap-4 md:grid-cols-3"><Metric label="HWM %" value={pct(trade?.hwm_pct || 0)} tone={trade?.hwm_pct >= dashboard.settings.hwm_threshold_pct ? "text-safe" : "text-danger"} /><Metric label="Current P/L %" value={trade?.last_metrics ? pct(trade.last_metrics.current_pl_pct) : "—"} tone={(trade?.last_metrics?.current_pl_pct || 0) >= 0 ? "text-safe" : "text-danger"} /><Metric label="Current DTE" value={trade?.last_metrics?.current_dte ?? "—"} /></div><div className="mt-4 rounded-3xl border border-edge bg-panel p-4"><p className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Next Move</p><p className="mt-3 text-sm leading-7 text-slate-300">{getTradeGuidance(trade, latestVerdict)}</p></div>{trade?.status !== "EMPTY" ? <><div className="mt-5 grid gap-4 md:grid-cols-2"><Field label="OptionStrat URL" type="text" value={inputs.optionstrat_url} onChange={(value) => setTradeInputs((current) => ({ ...current, [slot]: { ...(current[slot] || {}), optionstrat_url: value } }))} /><Field label="Current P/L %" value={inputs.current_pl_pct} onChange={(value) => setTradeInputs((current) => ({ ...current, [slot]: { ...(current[slot] || {}), current_pl_pct: value } }))} /><Field label="HWM %" value={inputs.hwm_pct} onChange={(value) => setTradeInputs((current) => ({ ...current, [slot]: { ...(current[slot] || {}), hwm_pct: value } }))} /><Field label="Current DTE" value={inputs.current_dte} onChange={(value) => setTradeInputs((current) => ({ ...current, [slot]: { ...(current[slot] || {}), current_dte: value } }))} /><Field label="Current VIX" value={inputs.vix_current} onChange={(value) => setTradeInputs((current) => ({ ...current, [slot]: { ...(current[slot] || {}), vix_current: value } }))} /><Field label="VIX Yesterday" value={inputs.vix_yesterday} onChange={(value) => setTradeInputs((current) => ({ ...current, [slot]: { ...(current[slot] || {}), vix_yesterday: value } }))} /></div><div className="mt-5 flex flex-wrap gap-3"><button className="rounded-2xl bg-teal px-4 py-3 text-sm font-semibold text-slate-950" onClick={() => runCheck(trade)} disabled={busy[`check-${slot}`]}>{busy[`check-${slot}`] ? "Running..." : "Run Check"}</button><button className="rounded-2xl border border-edge bg-panel px-4 py-3 text-sm font-medium text-white" onClick={() => persistTradeInputs(trade)} disabled={busy[`persist-${slot}`]}>{busy[`persist-${slot}`] ? "Saving..." : "Save Inputs"}</button><button className="rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-medium text-danger" onClick={() => closeTrade(trade)} disabled={busy[`close-${slot}`]}>{busy[`close-${slot}`] ? "Closing..." : "Mark Closed"}</button></div></> : <div className="mt-5 rounded-3xl border border-dashed border-edge p-5 text-sm text-slate-500">Save a {trade?.label?.toLowerCase() || slot} trade from the entry validator to activate this slot.</div>}<div className="mt-6 rounded-3xl border border-edge bg-panel p-4"><div className="mb-4 flex items-center justify-between"><p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-400">Verdict History</p><p className="text-xs text-slate-500">{trade?.verdicts?.length || 0} checks logged</p></div><div className="max-h-72 overflow-auto rounded-2xl border border-edge"><table className="min-w-full text-left text-sm"><thead className="sticky top-0 bg-ink/95 font-mono text-xs uppercase tracking-[0.18em] text-slate-500"><tr><th className="px-3 py-3">Date</th><th className="px-3 py-3">Day</th><th className="px-3 py-3">HWM</th><th className="px-3 py-3">P/L</th><th className="px-3 py-3">DTE</th><th className="px-3 py-3">Verdict</th></tr></thead><tbody>{(trade?.verdicts || []).length === 0 ? <tr><td colSpan="6" className="px-4 py-6 text-center text-slate-500">No verdict history yet.</td></tr> : [...trade.verdicts].reverse().map((item) => <tr key={`${item.timestamp}-${item.rule}`} className="border-t border-edge"><td className="px-3 py-3 text-slate-300">{formatTimestamp(item.timestamp)}</td><td className="px-3 py-3 font-mono text-slate-300">{item.day_number}</td><td className="px-3 py-3 font-mono text-slate-300">{pct(item.hwm_pct)}</td><td className={`px-3 py-3 font-mono ${(item.current_pl_pct || 0) >= 0 ? "text-safe" : "text-danger"}`}>{pct(item.current_pl_pct)}</td><td className="px-3 py-3 font-mono text-slate-300">{item.dte}</td><td className="px-3 py-3 text-slate-300">{item.verdict}</td></tr>)}</tbody></table></div></div></div>; })}</div>
          </Section>
        </main>
      </div>

      {settingsOpen ? <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm"><div className="h-full w-full max-w-2xl overflow-auto border-l border-edge bg-panel p-6"><div className="flex items-start justify-between"><div><p className="font-mono text-xs uppercase tracking-[0.28em] text-gold">Settings</p><h2 className="mt-3 text-2xl font-semibold text-white">Decision Engine Controls</h2><p className="mt-2 text-sm text-slate-400">All thresholds below feed directly into the backend decision engine and alert configuration.</p></div><button className="rounded-2xl border border-edge px-4 py-2 text-sm text-slate-300" onClick={() => setSettingsOpen(false)}>Close</button></div><div className="mt-6 grid gap-4 md:grid-cols-2">{SETTINGS_FIELDS.map(([key, label, type]) => <Field key={key} label={label} type={type} value={settingsDraft[key] ?? ""} onChange={(value) => setSettingsDraft((current) => ({ ...current, [key]: value }))} />)}</div><div className="mt-6 rounded-3xl border border-edge bg-ink/60 p-5"><div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><p className="font-mono text-xs uppercase tracking-[0.24em] text-teal">Telegram Alerts</p><p className="mt-2 text-sm leading-7 text-slate-400">Turn this on to get milestone and checkpoint messages when trades open, scale out, warn, or need to close. Set the bot token on the server as TELEGRAM_BOT_TOKEN.</p></div><button className="rounded-2xl border border-teal/40 bg-teal/10 px-4 py-3 text-sm font-medium text-teal" onClick={sendTelegramTest} disabled={busy.telegramTest}>{busy.telegramTest ? "Sending..." : "Send Test Alert"}</button></div><div className="mt-5 grid gap-4 md:grid-cols-2"><label className="flex items-center gap-3 rounded-2xl border border-edge bg-panel px-4 py-3 text-sm text-slate-300"><input type="checkbox" className="h-4 w-4 rounded border-edge bg-ink" checked={Boolean(settingsDraft.telegram_alerts_enabled)} onChange={(event) => setSettingsDraft((current) => ({ ...current, telegram_alerts_enabled: event.target.checked }))} />Enable Telegram alerts</label><Field label="Telegram Chat ID" type="text" value={settingsDraft.telegram_chat_id ?? ""} onChange={(value) => setSettingsDraft((current) => ({ ...current, telegram_chat_id: value }))} placeholder="123456789 or group chat id" /></div></div><div className="mt-6 flex gap-3"><button className="rounded-2xl bg-gold px-4 py-3 text-sm font-semibold text-slate-950" onClick={saveSettings} disabled={busy.settings}>{busy.settings ? "Saving..." : "Save Settings"}</button><button className="rounded-2xl border border-edge px-4 py-3 text-sm text-slate-300" onClick={() => setSettingsOpen(false)}>Cancel</button></div></div></div> : null}
    </div>
  );
}
