import { expect, test } from "@playwright/test";

test("subscription costs update instantly and preserve the custom rate on presets", async ({ page }) => {
  await page.goto("/tools");
  await page.getByRole("link", { name: /跨境订阅与 U 卡成本计算器/ }).click();
  const rate = page.getByLabel("参考汇率（每单位外币兑人民币）");
  const total = page.locator(".fee-results dd").nth(0);
  await rate.fill("7.1");
  await page.getByLabel("充值手续费率（%）").fill("2");
  await page.getByLabel("跨境或货币转换费率（%）").fill("3");
  await expect(total).toContainText("149.19");
  await expect(page.locator(".fee-results dd").nth(1)).toContainText("7.19");
  await expect(page.locator(".fee-results dd").nth(2)).toHaveText("7.45926 CNY / USD");
  await page.getByRole("button", { name: "3000 JPY" }).click();
  await expect(page.getByLabel("外币币种")).toHaveValue("JPY");
  await expect(page.getByLabel("外币原价")).toHaveValue("3000");
  await page.getByRole("button", { name: "20 USD" }).click();
  await expect(rate).toHaveValue("7.1");
  await rate.fill("0");
  await expect(total).toHaveText("—");
  await expect(page.getByText("所有计算均在浏览器本地完成，不记录任何输入数据")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("the password generator supports slider bounds, character toggles and local profile copies", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/tools");
  await page.getByRole("link", { name: /本地强密码与注册资料生成器/ }).click();
  const slider = page.getByRole("slider");
  const generate = page.getByRole("button", { name: "生成密码" });
  const password = page.locator(".generated-password");
  await slider.press("End");
  await generate.click();
  await expect(password).toHaveText(/^.{32}$/);
  const value = await password.innerText();
  await page.getByRole("button", { name: "复制密码" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(value);
  await slider.press("Home");
  for (const label of ["大写字母", "小写字母", "特殊符号"]) await page.getByLabel(label).uncheck();
  await generate.click();
  await expect(password).toHaveText(/^\d{12}$/);
  await expect(page.getByText(/强度估算 · 较弱/)).toBeVisible();
  await page.getByLabel("数字", { exact: true }).uncheck();
  await expect(generate).toBeDisabled();
  await page.getByRole("button", { name: "生成测试资料" }).click();
  const names = await page.locator(".profile-fields dd > span").allTextContents();
  expect(names).toHaveLength(4);
  expect(names[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  for (const [index, label] of ["复制英文名", "复制英文姓氏", "复制出生日期", "复制用户名"].entries()) {
    await page.getByRole("button", { name: label }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(names[index]);
  }
  await page.reload();
  await expect(password).toHaveCount(0);
  await expect(page.locator(".profile-fields")).toHaveCount(0);
  await expect(page.getByText("所有数据均在浏览器本地即时生成，不联网、不留存，仅用于日常防撞库及表单测试")).toBeVisible();
});
