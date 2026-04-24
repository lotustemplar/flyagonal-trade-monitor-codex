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

function minuteList(startMinute, endMinute, intervalMinutes) {
  const minutes = [];
  for (let minute = startMinute; minute <= endMinute; minute += intervalMinutes) {
    minutes.push(String(minute));
  }
  return minutes.join(",");
}

function marketHourCronExpressions(intervalMinutes) {
  const safeInterval = Math.max(1, Number(intervalMinutes) || 2);
  return [
    `${minuteList(30, 59, safeInterval)} 9 * * 1-5`,
    `${minuteList(0, 59, safeInterval)} 10-15 * * 1-5`,
    `${minuteList(0, 14, safeInterval)} 16 * * 1-5`
  ].filter((expression) => expression.split(" ")[0]);
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

  const calendarTask = cron.schedule(
    toCronExpression(settings.calendar_refresh_time),
    async () => {
      try {
        await refreshCalendarGate(settings, null, todayIso(timeZone));
      } catch (error) {
        console.error("Calendar refresh failed:", error);
      }
    },
    { timezone: timeZone }
  );

  const tradePollTasks = marketHourCronExpressions(settings.auto_poll_interval_minutes).map((expression) =>
    cron.schedule(
      expression,
      async () => {
        try {
          await pollOpenTradesForHwm();
        } catch (error) {
          console.error(`Scheduled ${settings.auto_poll_interval_minutes}-minute trade check failed:`, error);
        }
      },
      { timezone: timeZone }
    )
  );

  tasks = [calendarTask, ...tradePollTasks];
}

export async function refreshScheduler() {
  await startScheduler();
}
