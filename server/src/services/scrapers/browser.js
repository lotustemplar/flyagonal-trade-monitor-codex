import { chromium } from "playwright";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withBrowser(task) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();

  try {
    await delay(2000 + Math.floor(Math.random() * 1000));
    return await task(page);
  } finally {
    await context.close();
    await browser.close();
  }
}
