import { expect, test } from "@playwright/test";
import { siteConsentCookie, siteConsentVersion } from "../../lib/site-consent";

test.use({ storageState: { cookies: [], origins: [] } });

test("a new visitor can read both policies, leave, or consent and reopen the original page", async ({ page }) => {
  const visits: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/traffic") visits.push(request.url());
  });
  const dialog = page.getByRole("dialog", { name: "用户协议" });
  const agreement = dialog.getByRole("checkbox", { name: "本人接受本站用户协议" });
  const privacy = dialog.getByRole("checkbox", { name: "本人接受本站隐私政策" });
  const confirm = dialog.getByRole("button", { name: "确认并进入" });
  await page.goto("/");
  await expect(dialog).toBeVisible();
  await expect(page.locator(".site-header")).toHaveCount(0);
  await expect(dialog.getByText("不支持地区的用户禁止通过不法手段访问本站。")).toBeVisible();
  await expect(agreement).not.toBeChecked();
  await expect(privacy).not.toBeChecked();
  await expect(confirm).toBeDisabled();
  await agreement.check();
  await expect(confirm).toBeDisabled();
  await dialog.getByText("查看本站隐私政策", { exact: true }).click();
  await expect(dialog.getByText("协议确认", { exact: true })).toBeVisible();
  expect(visits).toEqual([]);
  await dialog.getByRole("link", { name: "退出网站" }).click();
  await expect(page).toHaveURL("about:blank");
  expect((await page.context().cookies()).some(cookie => cookie.name === siteConsentCookie)).toBe(false);

  await page.goto("/services/chatgpt?ref=consent#prices");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("heading", { name: "ChatGPT", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await privacy.check();
  await expect(confirm).toBeDisabled();
  await agreement.check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page).toHaveURL(/\/services\/chatgpt\?ref=consent#prices$/);
  await expect(page.getByRole("heading", { name: "ChatGPT", exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  const cookie = (await page.context().cookies()).find(item => item.name === siteConsentCookie);
  expect(cookie).toMatchObject({ value: siteConsentVersion, httpOnly: true, sameSite: "Lax" });
  await page.reload();
  await expect(dialog).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator(".site-header")).toBeVisible();
});
