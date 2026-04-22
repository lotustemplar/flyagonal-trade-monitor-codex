function toIso(date) {
  return date.toISOString().slice(0, 10);
}

function atNoonUtc(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  const first = atNoonUtc(year, monthIndex, 1);
  const offset = (7 + weekday - first.getUTCDay()) % 7;
  return atNoonUtc(year, monthIndex, 1 + offset + (nth - 1) * 7);
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const last = atNoonUtc(year, monthIndex + 1, 0);
  const offset = (7 + last.getUTCDay() - weekday) % 7;
  return atNoonUtc(year, monthIndex, last.getUTCDate() - offset);
}

function observedDate(year, monthIndex, day) {
  const raw = atNoonUtc(year, monthIndex, day);
  if (raw.getUTCDay() === 6) return addDays(raw, -1);
  if (raw.getUTCDay() === 0) return addDays(raw, 1);
  return raw;
}

function calculateEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return atNoonUtc(year, month - 1, day);
}

export function getMarketHolidays(year) {
  const easter = calculateEaster(year);
  const goodFriday = addDays(easter, -2);
  return new Set([
    observedDate(year, 0, 1),
    nthWeekdayOfMonth(year, 0, 1, 3),
    nthWeekdayOfMonth(year, 1, 1, 3),
    goodFriday,
    lastWeekdayOfMonth(year, 4, 1),
    observedDate(year, 5, 19),
    observedDate(year, 6, 4),
    nthWeekdayOfMonth(year, 8, 1, 1),
    nthWeekdayOfMonth(year, 10, 4, 4),
    observedDate(year, 11, 25)
  ].map(toIso));
}

export function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function isMarketHoliday(date) {
  return getMarketHolidays(date.getUTCFullYear()).has(toIso(date));
}

export function isMarketOpenDay(date) {
  return !isWeekend(date) && !isMarketHoliday(date);
}

export function getNthThanksgivingEve(year) {
  return addDays(nthWeekdayOfMonth(year, 10, 4, 4), -1);
}

export function isHolidayAdjacentSession(date) {
  const iso = toIso(date);
  const year = date.getUTCFullYear();
  const fixed = new Set([`${year}-12-24`, `${year}-12-31`, `${year}-07-03`]);
  if (fixed.has(iso)) return true;
  return iso === toIso(getNthThanksgivingEve(year));
}

export function getNextMarketSession(date) {
  let cursor = addDays(date, 1);
  while (!isMarketOpenDay(cursor)) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
}
