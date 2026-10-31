import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requiredPublicConfiguration = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];
const missing = requiredPublicConfiguration.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Missing production build configuration: ${missing.join(", ")}`);
  process.exit(1);
}

// Never embed a development API URL. This deployment serves the API on the same
// HTTPS origin as the website. PORT is needed by Vite's existing config at build.
const env = {
  ...process.env,
  NODE_ENV: "production",
  BASE_PATH: "/",
  PORT: process.env.PORT || "5000",
  VITE_API_BASE_URL: "",
};
for (const workspace of ["@workspace/api-server", "@workspace/eventflow-ai"]) {
  const result = spawnSync("pnpm", ["--filter", workspace, "run", "build"], {
    cwd: root, env, stdio: "inherit",
  });
  if (result.error) { console.error(`Could not start the build for ${workspace}.`); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
