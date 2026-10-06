import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "./concurrency.ts";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("keeps input order and never exceeds the limit", async () => {
  let inFlight = 0;
  let peak = 0;

  const out = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (ms, i) => {
    peak = Math.max(peak, ++inFlight);
    await tick(ms);
    inFlight--;
    return i * 10;
  });

  assert.deepEqual(out, [0, 10, 20, 30, 40]);
  assert.equal(peak, 2);
});

test("runs work in parallel rather than back to back", async () => {
  const started = Date.now();
  await mapWithConcurrency([50, 50, 50], 3, (ms) => tick(ms));
  assert.ok(Date.now() - started < 140);
});

test("handles an empty list", async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async (x) => x), []);
});
