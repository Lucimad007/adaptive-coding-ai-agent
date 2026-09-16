import assert from "node:assert/strict";
import test from "node:test";

test("worker start_run payload shape", () => {
  const msg = { type: "start_run", workspace: "/tmp/ws", prompt: "fix tests" };
  assert.equal(msg.type, "start_run");
  assert.ok(msg.prompt);
});
