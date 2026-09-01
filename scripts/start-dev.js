const { spawn } = require("node:child_process");
const path = require("node:path");

const nest = path.join(process.cwd(), "node_modules", "@nestjs", "cli", "bin", "nest.js");
const child = spawn(process.execPath, [nest, "start", "--watch", "--tsc"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: {
    ...process.env,
    TSC_WATCHFILE: "FixedPollingInterval",
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
