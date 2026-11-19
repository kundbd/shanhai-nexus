import { defineConfig, devices } from "@playwright/test";
import { randomBytes,randomUUID } from "node:crypto";
import { mkdirSync,mkdtempSync } from "node:fs";
import { join,resolve } from "node:path";
import { siteConsentCookie, siteConsentVersion } from "./lib/site-consent";

const externalUrl = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalUrl ?? "http://127.0.0.1:3100";
const testOrigin = new URL(baseURL);
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;
const password = process.env.E2E_ADMIN_PASSWORD || randomBytes(24).toString("hex");
process.env.E2E_ADMIN_PASSWORD = password;
process.env.E2E_MANAGE_LOCAL = externalUrl ? "" : "1";
function isolatedDatabase() {
  if (process.env.E2E_DB_PATH) return process.env.E2E_DB_PATH;
  const scratch = resolve("output/playwright/v03/fixtures");
  mkdirSync(scratch,{recursive:true});
  return process.env.E2E_DB_PATH = join(mkdtempSync(join(scratch,"run-")),"directory.sqlite");
}
const database = externalUrl ? "" : isolatedDatabase();
const fileboxPort=process.env.E2E_FILEBOX_PORT??"3102";
const fileboxOrigin=`http://127.0.0.1:${fileboxPort}`;
const developerSubject=randomUUID();
const dshFixture=process.env.E2E_DSH_MODERATION==="1";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 2,
  reporter: "list",
  use: {
    baseURL, channel, screenshot: "only-on-failure",
    storageState: { origins: [], cookies: [{
      name: siteConsentCookie, value: siteConsentVersion, domain: testOrigin.hostname, path: "/",
      expires: -1, httpOnly: true, secure: testOrigin.protocol === "https:", sameSite: "Lax",
    }] },
  },
  projects: [
    { name: "desktop-1920", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
    { name: "laptop-1366", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "mobile-390", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "mobile-375", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", viewport: { width: 375, height: 812 } } },
  ],
  webServer: externalUrl ? undefined : [{
    command:"node tests/e2e/filebox-account-fixture.mjs",
    url:`${fileboxOrigin}/health`,
    env:{E2E_FILEBOX_PORT:fileboxPort,E2E_MEMBER_DEVELOPER_SUBJECT:developerSubject},
    reuseExistingServer:false,
  },{
    command: "node .next/standalone/server.js",
    url: `${baseURL}/api/health`,
    env: { PORT:"3100",HOSTNAME:"127.0.0.1",SITE_URL:"https://shanhainexus.com",DB_PATH:database,ADMIN_USERNAME:"test-editor",ADMIN_PASSWORD:password,ADMIN_SESSION_SECRET:randomBytes(32).toString("hex"),ADMIN_ORIGIN:baseURL,FILEBOX_ACCOUNT_ORIGIN:fileboxOrigin,MEMBER_SESSION_KEY:randomBytes(32).toString("hex"),MEMBER_DEVELOPER_SUBJECT:developerSubject,
      DSH_MODERATION_ENABLED:dshFixture?"1":"0",
      ...(dshFixture?{DSH_MODERATION_API_KEY:"fixture-local-only",NODE_OPTIONS:`--require "${resolve("tests/e2e/dsh-provider-fixture.cjs").replaceAll("\\","/")}"`}:{}),
    },
    reuseExistingServer: false,
  }],
});
