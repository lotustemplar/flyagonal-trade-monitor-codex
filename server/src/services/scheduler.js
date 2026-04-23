import cron from "node-cron";
import { readData } from "../lib/storage.js";
import { refreshCalendarGate } from "./calendarGate.js";
import { pollOpenTradesForHwm, runScheduledChecks } from "./tradeService.js";
import { todayIso } from "../lib/dateUtils.js";

let tasks = [];

function toCronExpression(timeValue) {
  const [hourString, minuteString] = String(timeValue).split(":");
  return `${Number(minuteString)} ${Number(hourString)} * * 1-5`;
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

  const tradeTaskOne = cron.schedule(toCronExpression(settings.auto_poll_time_1), async () => {
    try { await runScheduledChecks(); } catch (error) { console.error("Scheduled trade check failed:", error); }
  }, { timezone: timeZone });

  const tradeTaskTwo = cron.schedule(toCronExpression(settings.auto_poll_time_2), async () => {
    try { await runScheduledChecks(); } catch (error) { console.error("Scheduled trade check failed:", error); }
  }, { timezone: timeZone });

  const hwmPollTask = cron.schedule("*/2 * * * 1-5", async () => {
    try { await pollOpenTradesForHwm(); } catch (error) { console.error("2-minute HWM poll failed:", error); }
  }, { timezone: timeZone });

  tasks = [calendarTask, tradeTaskOne, tradeTaskTwo, hwmPollTask];
}

export async function refreshScheduler() {
  await startScheduler();
}
