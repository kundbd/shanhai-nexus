import { expect, test } from "@playwright/test";

test("browser check reports ICE exposure without contacting a STUN or TURN server", async ({ page }) => {
  await page.addInitScript(() => {
    let next = 0;
    const addresses = ["fixture.local", "192.168.1.7", "93.184.216.34"];
    class LocalPeer {
      onicecandidate: ((event: { candidate: { candidate: string; address: string } | null }) => void) | null = null;
      constructor(config: RTCConfiguration) {
        if (config.iceServers?.length || config.iceCandidatePoolSize !== 0) throw new Error("Unexpected ICE config");
      }
      createDataChannel() {}
      async createOffer() { return { type: "offer" }; }
      async setLocalDescription() {
        const address = addresses[next++];
        this.onicecandidate?.({ candidate: { candidate: `candidate:1 1 udp 1 ${address} 5000 typ host`, address } });
        this.onicecandidate?.({ candidate: null });
      }
      close() {}
    }
    Object.defineProperty(window, "RTCPeerConnection", { value: LocalPeer, configurable: true });
  });
  await page.goto("/tools");
  await page.getByRole("link", { name: /出海浏览器环境自检/ }).click();
  await expect(page.getByRole("heading", { name: "出海浏览器环境自检" })).toBeVisible();
  await expect(page.getByText("屏幕分辨率（CSS 像素）")).toBeVisible();
  await expect(page.getByText("User-Agent", { exact: true })).toBeVisible();
  await expect(page.getByText("所有检测均在浏览器本地完成，不上传任何设备指纹数据")).toBeVisible();
  const check = page.getByRole("button", { name: "重新检测" });
  await expect(page.getByText("仅观察到 mDNS 掩码")).toHaveAttribute("data-tone", "green");
  const ongoingRequests: string[] = [];
  page.on("request", request => ongoingRequests.push(request.url()));
  await check.click();
  await expect(page.getByText("观察到本地 IP 地址暴露")).toHaveAttribute("data-tone", "yellow");
  await check.click();
  await expect(page.getByText("观察到公网候选地址")).toHaveAttribute("data-tone", "red");
  await expect(page.getByText(/192\.168\.1\.7|93\.184\.216\.34/)).toHaveCount(0);
  expect(ongoingRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
