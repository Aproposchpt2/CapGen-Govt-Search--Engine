import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

function count(pattern) {
  return [...html.matchAll(pattern)].length;
}

assert.equal(count(/<h1(?:\s|>)/gi), 1, "Homepage must contain exactly one H1.");
assert.match(html, /<title>Federal Contract Matching for Registered Contractors \| NGCC<\/title>/);
assert.match(html, /name="description"\s+content="Registered federal contractors receive personalized federal contract matches, intelligent rankings, guided onboarding, Analyze Fit support, and a 14-day free trial\."/);
assert.match(html, /rel="canonical"\s+href="https:\/\/ngcc\.aproposgroupllc\.com\/"/);
assert.match(html, /name="robots"\s+content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"/);
assert.match(html, />Start Your 14-Day Free Trial</);
assert.match(html, />Member Login</);
assert.match(html, /\$99/);
assert.match(html, /\$15/);
assert.doesNotMatch(html, /Licensed State Businesses/i);
assert.doesNotMatch(html, /Free Forever|No Subscription Required|Unlimited Free Matching|Analyze Fit \$19\.99/i);
assert.doesNotMatch(html, /href="http:\/\//i);

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "Duplicate HTML IDs detected.");

const fragmentLinks = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
for (const fragment of fragmentLinks) {
  assert.ok(ids.includes(fragment), `Broken internal anchor: #${fragment}`);
}

const jsonLdBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
assert.ok(jsonLdBlocks.length > 0, "JSON-LD block is required.");
const jsonLd = JSON.parse(jsonLdBlocks[0][1]);
const types = new Set(jsonLd["@graph"].map((entry) => entry["@type"]));
for (const requiredType of ["Organization", "WebSite", "Service", "Offer"]) {
  assert.ok(types.has(requiredType), `Missing JSON-LD type: ${requiredType}`);
}
const offer = jsonLd["@graph"].find((entry) => entry["@type"] === "Offer");
assert.equal(offer.price, "99.00");
assert.equal(offer.priceCurrency, "USD");
assert.equal(offer.priceSpecification.billingDuration, "P1M");
assert.equal(offer.additionalProperty.value, "P14D");

console.log("NGCC homepage SEO and conversion validation passed.");
