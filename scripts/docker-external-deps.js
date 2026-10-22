#!/usr/bin/env node
/**
 * Assembles the minimal runtime tree consumed by the runner stage of the
 * multi-stage Dockerfile (issue #258).
 *
 * Next.js `output: "standalone"` traces only the packages the server code
 * imports into `.next/standalone`. Packages listed in `serverExternalPackages`
 * (`@stellar/stellar-sdk`) are excluded from that trace, so this script copies
 * them — and their transitive dependencies, exactly as pinned in
 * package-lock.json — from the full install into the runtime tree. Optional
 * native dependencies that npm skipped on this platform are skipped here too.
 */
const { cpSync, existsSync, mkdirSync, readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const root = process.cwd();
const runtime = "/runtime";

// 1. Standalone server: server.js, traced node_modules, .next
cpSync(join(root, ".next/standalone"), runtime, { recursive: true });

// 2. Static assets and public files live outside the standalone output
cpSync(join(root, ".next/static"), join(runtime, ".next/static"), { recursive: true });
cpSync(join(root, "public"), join(runtime, "public"), { recursive: true });

// 3. Externalised packages and their lockfile-pinned dependency closure
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const packages = lock.packages || {};
const seen = new Set();
const queue = ["@stellar/stellar-sdk"];
const copied = [];
while (queue.length > 0) {
  const name = queue.shift();
  if (seen.has(name)) continue;
  seen.add(name);
  const entry = packages["node_modules/" + name];
  if (!entry) continue;
  const dest = join(runtime, "node_modules", name);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(root, "node_modules", name), dest, { recursive: true });
  copied.push(name);
  const deps = Object.assign({}, entry.dependencies, entry.optionalDependencies);
  for (const dep of Object.keys(deps)) queue.push(dep);
}

if (!existsSync(join(runtime, "server.js"))) {
  console.error("runtime tree incomplete: .next/standalone/server.js missing");
  process.exit(1);
}

console.log("runtime tree assembled at " + runtime + " (" + copied.length + " external packages copied)");
