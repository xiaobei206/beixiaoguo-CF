import assert from "node:assert/strict";
import { normalizeRouteIPAddress } from "../functions/route-ip.js";

assert.equal(normalizeRouteIPAddress("47.117.10.164"), "47.117.10.164");
assert.equal(normalizeRouteIPAddress("001.002.003.004"), "1.2.3.4");
assert.equal(normalizeRouteIPAddress("2001:db8::1"), "2001:db8::1");
assert.equal(normalizeRouteIPAddress("[2001:db8::1]"), "2001:db8::1");

for (const invalid of [
  "", "example.com", "47.117.10.164:443", "47.117.10.999",
  "1.2.3", "1.2.3.4/24", "1.2.3.4?alt=1", "2001:db8::zz",
  "2001:db8::1%eth0", "https://47.117.10.164", "1.2.3.4\r\nAlt-Svc: clear"
]) {
  assert.equal(normalizeRouteIPAddress(invalid), "", "must reject " + JSON.stringify(invalid));
}

console.log("Browser-selected CF route IP validation tests passed.");
