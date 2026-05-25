import * as path from "node:path";
import { execSync } from "node:child_process";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
  const extensionTestsPath = path.resolve(__dirname, "./index.js");

  // Download VS Code FIRST so the .app bundle exists on disk
  const vscodeExecutablePath = await downloadAndUnzipVSCode();

  // Patch the downloaded bundle to suppress Dock icon / window focus on macOS
  execSync("bash scripts/hide-test-vscode.sh", {
    cwd: extensionDevelopmentPath,
    stdio: "inherit",
  });

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      extensionDevelopmentPath,
      "--disable-gpu",
      "--disable-gpu-sandbox"
    ]
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
