import cron from "node-cron";
import { readData } from "../lib/storage.js";
import { refreshCalendarGate } from "./calendarGate.js";
import { pollOpenTradesForHwm } from "./tradeService.js";
import { todayIso } from "../lib/dateUtils.js";

let tasks = [];

function toCronExpression(timeValue) {
  const [hourString, minuteString] = String(timeValue).split(":");
  return `${Number(minuteString)} ${Number(hourString)} * * 1-5`;
}

function intervalCronExpression(intervalMinutes) {
  const safeInterval = Math.max(1, Number(intervalMinutes) || 5);
  return `*/${safeInterval} * * * 1-5`;
}

async function loadConfig() {
  const data = await readData();
  return data.settings;
}

function clearTasks() {
  tasks.forEach((task) => task.stop());
  tasks = [];
}

export async function startScheduler() {
  clearTasks();
  const settings = await loadConfig();
  const timeZone = settings.timezone || "America/New_York";

  const calendarTask = cron.schedule(toCronExpression(settings.calendar_refresh_time), async () => {
    try { await refreshCalendarGate(settings, null, todayIso(timeZone)); } catch (error) { console.error("Calendar refresh failed:", error); }
  }, { timezone: timeZone });

  const tradePollTask = cron.schedule(intervalCronExpression(settings.auto_poll_interval_minutes), async () => {
    try { await pollOpenTradesForHwm(); } catch (error) { console.error("Scheduled 5-minute trade check failed:", error); }
  }, { timezone: timeZone });

  tasks = [calendarTask, tradePollTask];
}

export async function refreshScheduler() {
  await startScheduler();
}
