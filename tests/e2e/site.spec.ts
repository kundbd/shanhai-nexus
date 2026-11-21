import { expect, test, type Page } from "@playwright/test";

async function checkLayout(page: Page, project: string, name: string) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate((expected) => document.documentElement.scrollWidth <= expected, width)).toBeTruthy();
  await page.screenshot({ path: `output/playwright/v03/${name}-${project}.png`, fullPage: true, scale: "css" });
}

test("home, navigation, theme, filters, and search result routes", async ({ page, isMobile }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "了解清楚，再做选择。" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "搜索服务商、域名或关键词" })).toBeVisible();
  await expect(page).toHaveTitle(/山海知序 Shanhai Nexus/);
  await checkLayout(page, testInfo.project.name, "home");
  await page.getByRole("button", { name: "切换主题，当前跟随系统" }).click();
  await page.getByRole("button", { name: "切换主题，当前浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  if (["desktop-1920", "mobile-375"].includes(testInfo.project.name)) await checkLayout(page, testInfo.project.name, "home-dark");
  await page.getByRole("button", { name: "切换主题，当前深色" }).click();

  if (isMobile) await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "工具与指南", exact: true }).click();
  await expect(page.getByRole("heading", { name: "工具与指南", exact: true })).toBeVisible();
  await expect(page.locator(".tool-card")).toHaveCount(6);

  await page.goto("/search?q=%3Cscript%3Ezzzxxy%3C%2Fscript%3E&type=unknown");
  await expect(page.getByRole("heading", { name: "没有找到匹配的内容" })).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveValue("<script>zzzxxy</script>");
  await page.getByRole("searchbox").fill("BIN");
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.locator(".result-card").first()).toHaveAttribute("href", "/tools/bin-lookup");
  await expect(page.locator(".result-card").first().locator("mark")).not.toHaveCount(0);
  await checkLayout(page, testInfo.project.name, "search");
  await page.locator(".result-card").first().click();
  await expect(page.getByRole("heading", { name: "银行卡 BIN 地区查询" })).toBeVisible();
  await testInfo.attach("viewport", { body: JSON.stringify(page.viewportSize()), contentType: "application/json" });
});

test("health, sitemap links and unknown routes respond correctly", async ({ request, baseURL }) => {
  const health = await request.get("/api/health");
  expect(health.ok()).toBeTruthy();
  expect(await health.json()).toEqual({ status: "ok" });
  const search = await request.get("/search?q=JSON");
  expect(search.headers()["cache-control"]).toContain("no-store");
  expect(search.headers()["referrer-policy"]).toBe("no-referrer");
  expect(search.headers()["x-robots-tag"]).toContain("noindex");
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Sitemap:");
  const sitemap = await request.get("/sitemap.xml");
  const urls = [...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
  expect(urls).toContain("/tools/bin-lookup");
  expect(urls).toContain("/tools/2fa");
  expect(urls).toContain("/tools/us-billing-address");
  expect(urls).toContain("/tools/env-check");
  expect(urls).toContain("/tools/fee-calculator");
  expect(urls).toContain("/tools/account-helper");
  expect(urls.some(path => path.startsWith("/guides") || path === "/diagnose")).toBeFalsy();
  expect(urls).toContain("/about");
  expect(urls).toContain("/services/chatgpt");
  expect(urls.some((path)=>path.startsWith("/admin"))).toBeFalsy();
  for (const path of urls) expect((await request.get(new URL(path, baseURL).href)).ok(), path).toBeTruthy();
  expect((await request.get("/tools/missing")).status()).toBe(404);
});

test("legacy theme preference and footer navigation", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nanyang-theme", "dark"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("link", { name: "关于本站" }).click();
  await expect(page.getByRole("heading", { name: "关于山海知序" })).toBeVisible();
});
