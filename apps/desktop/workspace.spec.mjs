import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveSafe } from "./workspace.mjs";

test("rejects path traversal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
  assert.throws(() => resolveSafe("../secret.txt", root));
  assert.throws(() => resolveSafe("foo/../../etc/passwd", root));
});

test("allows nested writes inside root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
  const abs = resolveSafe("a/b.txt", root);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "ok");
  assert.equal(fs.readFileSync(abs, "utf8"), "ok");
});
