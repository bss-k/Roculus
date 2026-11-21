// Runs the API and the dashboard dev servers together; Ctrl+C stops both.
import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = ["api", "web"].map((workspace) =>
  spawn(npm, ["run", "dev", "-w", workspace], { stdio: "inherit" }),
);

function stopAll() {
  for (const child of children) child.kill("SIGINT");
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
for (const child of children) {
  child.on("exit", (code) => {
    if (code) {
      stopAll();
      process.exitCode = code;
    }
  });
}
