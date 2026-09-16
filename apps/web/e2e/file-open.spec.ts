import { test, expect, _electron as electron } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("opens README from the file tree", async () => {
  test.skip(!process.env.RUN_ELECTRON, "set RUN_ELECTRON=1 with Vite on 5173");
  const app = await electron.launch({
    cwd: repo,
    args: [path.join(repo, "apps", "desktop", "main.mjs")],
    env: { ...process.env, ELECTRON_START_URL: "http://127.0.0.1:5173" },
  });
  const page = await app.firstWindow();
  await page.getByTestId("file-README.md").click();
  await expect(page.locator(".top")).toContainText("README.md");
  await app.close();
});
