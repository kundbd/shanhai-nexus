import { expect, test } from "@playwright/test";

test("TOTP uses the browser clock and clears the secret", async ({ page, context }) => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url() + (request.postData() ?? "")));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/tools");
  await page.getByRole("link", { name: /网页版 2FA 生成器/ }).click();
  const field = page.getByLabel("Base32 密钥或 TOTP 设置链接", { exact: true });
  await field.fill("invalid!");
  await page.getByRole("button", { name: "生成验证码" }).click();
  await expect(page.locator(".tool-workbench").getByRole("alert")).toContainText("有效的 Base32 密钥");
  await page.clock.setFixedTime(new Date(59_000));
  await field.fill(secret);
  await field.press("Enter");
  const code = page.locator(".totp-code");
  await expect(code).toHaveText("287082");
  await expect(page.getByText("1 秒后刷新")).toBeVisible();
  await page.getByRole("button", { name: "复制验证码" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("287082");
  await page.clock.setFixedTime(new Date(61_000));
  await expect(code).toHaveText("359152");
  await page.getByRole("button", { name: "清除密钥" }).click();
  await expect(field).toHaveValue("");
  expect(requests.some(request => request.includes(secret) || request.includes("287082"))).toBe(false);
});

test("the billing tool generates clearly marked examples for the selected state", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/tools");
  await page.getByRole("link", { name: /美区免税州账单地址生成器/ }).click();
  const states = page.getByLabel("选择州");
  await expect(states.locator("option")).toHaveCount(5);
  await states.selectOption("NH");
  await page.getByRole("button", { name: "生成示例地址" }).click();
  await expect(page.locator(".tool-address-fields")).toContainText("03301");
  await page.getByRole("button", { name: "复制示例地址" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^TEST ADDRESS\r?\n\d{4} Shanhai Test Fixture Ave\r?\nConcord, NH 03301\r?\nUnited States$/);
  await states.selectOption("AK");
  await expect(page.locator(".tool-address-fields")).toHaveCount(0);
  await expect(page.getByText(/部分城市和自治市镇征收地方销售税/)).toBeVisible();
  await page.getByRole("button", { name: "生成示例地址" }).click();
  await expect(page.locator(".tool-address-fields")).toContainText("Juneau");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
