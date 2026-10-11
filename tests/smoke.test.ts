import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const example = readFileSync(
  new URL("../.env.example", import.meta.url),
  "utf8",
);

test("live email stays disabled in the env template", () => {
  assert.match(example, /^EMAIL_LIVE_SEND_ENABLED=false$/m);
});
