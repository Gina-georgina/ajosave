/**
 * @jest-environment node
 *
 * Guards docs/external-contract-audit.md: every contract crate in the workspace
 * must be listed in the audit scope, and the audit tracker must exist.
 */
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function workspaceMembers(): string[] {
  const toml = read("contracts/Cargo.toml");
  const match = toml.match(/members\s*=\s*\[([^\]]*)\]/);
  if (!match) throw new Error("no workspace members found in contracts/Cargo.toml");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("external contract audit scope", () => {
  const doc = read("docs/external-contract-audit.md");

  it("finds the workspace members", () => {
    expect(workspaceMembers()).toEqual(expect.arrayContaining(["ajo", "certificate"]));
  });

  it.each(workspaceMembers())("lists contracts/%s in the audit scope", (member) => {
    expect(fs.existsSync(path.join(root, "contracts", member, "Cargo.toml"))).toBe(true);
    expect(doc).toContain(`\`contracts/${member}\``);
  });

  it("ships the audit tracker and finding template", () => {
    expect(fs.existsSync(path.join(root, "docs/audits/README.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "docs/audits/FINDING_TEMPLATE.md"))).toBe(true);
  });

  it("defines a response for every severity level", () => {
    for (const severity of ["Critical", "High", "Medium", "Low"]) expect(doc).toContain(`| ${severity}`);
  });

  it("references files that exist", () => {
    for (const rel of [
      "contracts/ajo/README.md",
      "contracts/ajo/EVENTS.md",
      "contracts/ajo/UPGRADE.md",
      "contracts/ajo/FUND_LOCKING_CHECKLIST.md",
      "contracts/ajo/BENCHMARKS.md",
      "docs/contract-fuzzing.md",
      "docs/multisig-admin.md",
      ".github/workflows/contract-fuzz.yml",
      ".github/workflows/contract-wasm-release.yml",
      ".github/workflows/contract-audit-readiness.yml",
    ]) {
      expect(fs.existsSync(path.join(root, rel))).toBe(true);
    }
  });
});
