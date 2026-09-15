import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const root = fileURLToPath(new URL("../", import.meta.url));
config({ path: new URL("../.env", import.meta.url), quiet: true });

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required. Copy .env.example to .env.");
const target = new URL(connectionString);
if (!["postgres:", "postgresql:"].includes(target.protocol) || target.pathname !== "/bookerdoc_test") {
  throw new Error("Tests require a PostgreSQL database named bookerdoc_test.");
}
if (process.env.DATABASE_URL) {
  const development = new URL(process.env.DATABASE_URL);
  if (target.hostname === development.hostname &&
      (target.port || "5432") === (development.port || "5432") &&
      target.pathname === development.pathname) {
    throw new Error("TEST_DATABASE_URL must not point to the development database.");
  }
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const args of [
  ["run", "db:migrate", "-w", "@bookerdoc/api"],
  ["run", "test:integration", "-w", "@bookerdoc/api"],
]) {
  const result = spawnSync(npm, args, {
    cwd: root,
    env: { ...process.env, DATABASE_URL: connectionString, TEST_DATABASE_URL: connectionString },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
