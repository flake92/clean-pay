import type { Page } from "@playwright/test";

export async function enterJourneyOfflineMode(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.context().setOffline(true);
}
