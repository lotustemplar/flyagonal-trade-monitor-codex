import { chromium } from "playwright";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withBrowser(task) {
  const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 1200 },
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  const page = await context.newPage();

  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await delay(2000 + Math.floor(Math.random() * 1000));
    return await task(page);
  } finally {
    await context.close();
    await browser.close();
  }
}
