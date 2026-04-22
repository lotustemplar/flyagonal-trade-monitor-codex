import { withBrowser } from "./browser.js";
import { calendarDayNumber, todayIso } from "../../lib/dateUtils.js";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export async function scrapeForexFactoryWindow(settings) {
  const startDate = todayIso(settings.timezone);

  return withBrowser(async (page) => {
    await page.goto("https://www.forexfactory.com/calendar", { waitUntil: "domcontentloaded", timeout: settings.manual_scrape_timeout_ms });
    await page.waitForLoadState("networkidle", { timeout: settings.manual_scrape_timeout_ms }).catch(() => {});
    await page.waitForTimeout(1500);

    const rawEvents = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("tr"));
      return rows.map((row) => {
        const text = row.innerText || "";
        const cells = Array.from(row.querySelectorAll("td, th")).map((cell) => cell.innerText.trim());
        const impactNode = row.querySelector("[title], [data-tooltip]");
        const impactTitle = impactNode?.getAttribute("title") || impactNode?.getAttribute("data-tooltip") || "";
        return { raw: text, cells, impactTitle };
      }).filter((item) => item.raw && item.cells.length >= 4);
    });

    const events = rawEvents.map((item) => {
      const combined = item.cells.join(" | ");
      const dateMatch = combined.match(/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b.*?\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b.*?\d{1,2}/i);
      const timeMatch = combined.match(/\b\d{1,2}:\d{2}(?:am|pm)?\b|\bAll Day\b|\bTentative\b/i);
      const currencyMatch = combined.match(/\b[A-Z]{3}\b/);
      const eventName = item.cells[item.cells.length - 1] || item.raw;
      return {
        date: normalizeText(dateMatch?.[0] || item.cells[0]),
        time: normalizeText(timeMatch?.[0] || item.cells[1]),
        currency: normalizeText(currencyMatch?.[0] || item.cells[2]),
        impact: normalizeText(item.impactTitle || item.raw),
        event_name: normalizeText(eventName)
      };
    }).filter((event) => event.currency === "USD" && event.impact.toLowerCase().includes("high impact expected"));

    return events.map((event) => {
      const inferredDate = new Date(`${event.date} ${new Date().getUTCFullYear()} 12:00:00 GMT`);
      if (Number.isNaN(inferredDate.getTime())) return null;
      const iso = inferredDate.toISOString().slice(0, 10);
      const windowDay = calendarDayNumber(startDate, iso);
      if (windowDay < 1 || windowDay > 8) return null;
      return { ...event, iso_date: iso, window_day: windowDay };
    }).filter(Boolean).sort((a, b) => a.iso_date.localeCompare(b.iso_date));
  });
}
