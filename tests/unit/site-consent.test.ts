import assert from "node:assert/strict";
import { test } from "node:test";
import { siteConsentDestination } from "../../lib/site-consent";

test("consent returns to local pages and discards invalid or cross-origin destinations", () => {
  assert.equal(siteConsentDestination("/services/chatgpt?tag=1&tag=2#prices"), "/services/chatgpt?tag=1&tag=2#prices");
  assert.equal(siteConsentDestination("/search?q=gpt&_rsc=12345"), "/search?q=gpt");
  for (const destination of ["/welcome", "///", "//example.org", "https://example.org", "/.//example.org", "/\\example.org"]) {
    assert.equal(siteConsentDestination(destination), "/");
  }
});
