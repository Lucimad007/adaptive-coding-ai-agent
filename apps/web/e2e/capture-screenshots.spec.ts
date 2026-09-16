import { test, _electron as electron } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const out = path.join(repo, "docs", "screenshots");
const electronBin = path.join(repo, "apps", "desktop", "node_modules", "electron", "dist", "electron.exe");

test.setTimeout(180_000);

test("capture real Patchline screenshots", async () => {
  test.skip(!process.env.RUN_ELECTRON, "set RUN_ELECTRON=1 with Vite on 5173");
  fs.mkdirSync(out, { recursive: true });

  const { ELECTRON_RUN_AS_NODE: _drop, ...env } = process.env;
  const app = await electron.launch({
    executablePath: fs.existsSync(electronBin) ? electronBin : undefined,
    cwd: repo,
    args: [path.join(repo, "apps", "desktop", "main.mjs")],
    env: {
      ...env,
      ELECTRON_START_URL: "http://127.0.0.1:5173",
      WORKSPACE_ROOT: repo,
    },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector("text=Patchline", { timeout: 45_000 });
  await page.getByTestId("file-adaptive_agent/harness_worker.py").click();
  await page.waitForTimeout(1500);

  await page.screenshot({ path: path.join(out, "patchline-hero.png") });
  await page.locator(".surface-sidebar").first().screenshot({ path: path.join(out, "patchline-explorer.png") });

  const composer = page.getByTestId("composer");
  await composer.click();
  await composer.fill("Walk the graph and explain how the coding harness starts a run.");
  await page.screenshot({ path: path.join(out, "patchline-chat.png") });

  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, "patchline-plan.png") });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.waitForTimeout(200);

  await page.getByRole("button", { name: "Review diffs", exact: true }).click();
  await page.waitForSelector(".monaco-diff-editor, .monaco-editor", { timeout: 25_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, "patchline-diffs.png") });

  await page.getByRole("button", { name: "Edit", exact: true }).click().catch(() => undefined);
  await page.locator(".surface-editor").last().screenshot({ path: path.join(out, "patchline-terminal.png") });

  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("No graph yet"), {
    timeout: 90_000,
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, "patchline-graph.png") });

  await app.close();
});
