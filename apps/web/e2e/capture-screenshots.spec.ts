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
      ELECTRON_START_URL: "http://127.0.0.1:5173/?shots=1",
      WORKSPACE_ROOT: repo,
    },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForSelector("text=Patchline", { timeout: 45_000 });
  await page.getByText("Approve skill?").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByTestId("editor-stage").screenshot({ path: path.join(out, "patchline-preview.png") });

  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.waitForSelector(".monaco-editor", { timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.getByTestId("editor-stage").screenshot({ path: path.join(out, "patchline-source.png") });

  await page.screenshot({ path: path.join(out, "patchline-hero.png") });
  await page.getByTestId("titlebar").screenshot({ path: path.join(out, "patchline-titlebar.png") });
  await page.locator(".surface-sidebar").first().screenshot({ path: path.join(out, "patchline-explorer.png") });
  await page.getByTestId("terminal-pane").screenshot({ path: path.join(out, "patchline-terminal.png") });
  await page.getByTestId("chat-panel").screenshot({ path: path.join(out, "patchline-chat.png") });
  await page.getByTestId("image-hint").screenshot({ path: path.join(out, "patchline-no-images.png") });

  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.waitForTimeout(350);
  await page.getByTestId("chat-panel").screenshot({ path: path.join(out, "patchline-modes.png") });
  await page.getByTestId("mode-menu").getByRole("button", { name: /Research, questions/ }).click();
  await page.waitForTimeout(300);
  await page.getByTestId("chat-panel").screenshot({ path: path.join(out, "patchline-plan.png") });

  await page.getByRole("button", { name: "Review diffs", exact: true }).click();
  await page.waitForSelector(".monaco-diff-editor", { timeout: 25_000 });
  await page.waitForTimeout(1200);
  await page.getByTestId("diff-review").screenshot({ path: path.join(out, "patchline-diff-bar.png") });
  await page.locator(".monaco-diff-editor").first().screenshot({ path: path.join(out, "patchline-diffs.png") });

  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await page.getByTestId("graph-full").waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => !document.body.innerText.includes("No graph yet"), { timeout: 90_000 });
  await page.waitForTimeout(1500);
  await page.getByTestId("graph-full").screenshot({ path: path.join(out, "patchline-graph.png") });

  await app.close();
});
