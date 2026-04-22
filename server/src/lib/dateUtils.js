import { getNextMarketSession, isHolidayAdjacentSession, isMarketHoliday, isMarketOpenDay } from "./marketCalendar.js";

export function dateFromIso(isoString) {
  return new Date(`${isoString}T12:00:00Z`);
}

export function todayIso(timeZone = "America/New_York") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function calendarDayNumber(fromIso, toIso) {
  const from = dateFromIso(fromIso);
  const to = dateFromIso(toIso);
  const diffMs = to.getTime() - from.getTime();
  return Math.floor(diffMs / 86400000) + 1;
}

export function calculateTradeDayNumber(entryIso, currentIso = todayIso()) {
  if (!entryIso) {
    return 0;
  }

  let cursor = dateFromIso(entryIso);
  const end = dateFromIso(currentIso);
  let count = 0;

  while (cursor <= end) {
    if (isMarketOpenDay(cursor)) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return count;
}

export function isHolidayBlockedDay(isoString) {
  const date = dateFromIso(isoString);
  if (isHolidayAdjacentSession(date)) {
    return true;
  }

  const nextCalendarDay = new Date(date);
  nextCalendarDay.setUTCDate(nextCalendarDay.getUTCDate() + 1);
  return isMarketHoliday(nextCalendarDay) || Boolean(getNextMarketSession);
}
