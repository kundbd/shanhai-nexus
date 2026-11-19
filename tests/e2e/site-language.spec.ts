import { expect, test } from "@playwright/test";
import { languageCookie } from "../../lib/i18n/language";
import { siteConsentCookie } from "../../lib/site-consent";

test("language switches before consent and persists across pages", async ({ page, context }) => {
  await context.clearCookies({ name: siteConsentCookie });
  const path = "/search?q=DeepSeek#main";
  await page.goto(path);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Terms of Use" })).toBeVisible();
  await expect(page).toHaveURL(url => url.pathname + url.search + url.hash === path);

  const confirm = page.getByRole("button", { name: "Accept and continue" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("I accept the Terms of Use").check();
  await expect(confirm).toBeDisabled();
  await page.getByLabel("I accept the Privacy Policy").check();
  await confirm.click();
  await expect(page.getByRole("heading", { name: "Search Shanhai Nexus" })).toBeVisible();
  await expect(page).toHaveURL(url => url.pathname + url.search + url.hash === path);
  await page.getByRole("button", { name: "繁體中文", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await expect(page.getByRole("heading", { name: "搜尋山海知序" })).toBeVisible();
  await page.goto("/messages");
  await expect(page.getByRole("heading", { name: "消息" })).toBeVisible();
  expect((await context.cookies()).find(cookie => cookie.name === languageCookie)?.value).toBe("zh-Hant");

  await page.getByRole("button", { name: "简体中文", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /公开报价区间/ })).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Public price ranges/ })).toBeVisible();
  const widths = test.info().project.name === "desktop-1920" ? [1920, 1200, 1024, 960, 600, 320] : [page.viewportSize()!.width];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const room = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(room, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    if (width === 600 || width === 960) {
      await page.getByRole("button", { name: "Open menu" }).click();
      await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Community" })).toBeVisible();
      if (width === 600) {
        await expect(page.getByRole("group", { name: "Partnerships & Feedback" })).toBeVisible();
      }
      await page.getByRole("button", { name: "Close menu" }).click();
    }
  }
});
