import { expect, test } from "@playwright/test";
import { binCardDataPath } from "../../lib/tools/bin-cards";

test("the only tool looks up card details locally and rejects longer numbers", async ({ page, request }) => {
  await page.goto("/tools");
  await expect(page.getByRole("heading", { name: "工具与指南" })).toBeVisible();
  await expect(page.locator(".tool-card")).toHaveCount(1);
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  await page.getByRole("link", { name: /银行卡 BIN 地区查询/ }).click();
  const field = page.getByLabel("银行卡号前 6 位或前 8 位");
  const submit = page.getByRole("button", { name: "查询", exact: true });
  await field.fill("1234567890123456");
  await submit.click();
  await expect(page.locator(".bin-lookup").getByRole("alert")).toHaveText("请输入卡号前 6 位或前 8 位数字。");
  expect(requests.some(url => url.endsWith(binCardDataPath))).toBe(false);
  const result = page.locator(".bin-lookup-result");
  const mainlandCases = [["621226", 6], ["62220842", 8], ["53429300", 6], ["537832", 6], ["43674502", 8]] as const;
  for (const [prefix, digits] of mainlandCases) {
    await field.fill(prefix);
    await submit.click();
    await expect(result).toContainText("中国大陆");
    await expect(result).toContainText("CN");
    await expect(result).toContainText(`前 ${digits} 位匹配`);
    if (prefix === "53429300") {
      await expect(result.getByText("招商银行", { exact: true })).toBeVisible();
      await expect(result.getByText("万事达卡（Mastercard）", { exact: true })).toBeVisible();
      await expect(result.getByText("借记卡", { exact: true })).toBeVisible();
    }
    if (prefix === "537832") await expect(result.getByText("信用卡", { exact: true })).toBeVisible();
  }
  await field.fill("４５７１ ７３６０");
  await submit.click();
  await expect(result).toContainText("丹麦");
  await expect(result).toContainText("DK");
  await expect(result.getByText("暂无资料", { exact: true })).toHaveCount(2);
  await field.fill("620202");
  await field.press("Enter");
  await expect(result).toContainText("HK");
  await field.fill("510195");
  await field.press("Enter");
  await expect(result).toContainText("MY");
  await expect(result).toContainText("BANK SIMPANAN NASIONAL");
  await field.fill("629999");
  await field.press("Enter");
  await expect(page.getByText("未找到该 BIN 的可靠记录。")).toBeVisible();
  await expect(page).toHaveURL(/\/tools\/bin-lookup$/);
  expect(requests.filter(url => url.endsWith(binCardDataPath))).toHaveLength(1);
  expect(requests.some(url => /457173|1234567890123456|621226|62220842|534293|537832|43674502|620202|510195|629999/.test(url))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  for (const path of ["/tools/json", "/tools/base64", "/tools/timestamp", "/tools/sha256", "/tools/url", "/tools/diff", "/guides", "/guides/pdf-to-word", "/diagnose"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});
