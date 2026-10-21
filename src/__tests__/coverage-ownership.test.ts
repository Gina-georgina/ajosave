/**
 * @jest-environment node
 *
 * Guards docs/coverage-ownership.md: every Codecov component path must exist and
 * be covered by a specific (non-fallback) CODEOWNERS rule with a real owner.
 */
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

/** Static part of a glob: everything before the first wildcard. */
const literalPrefix = (glob: string) => glob.split("*")[0];

function parseCodeowners() {
  return read(".github/CODEOWNERS")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [pattern, ...owners] = l.split(/\s+/);
      return { pattern, owners };
    });
}

/** `paths:` lists under `individual_components` in codecov.yml. */
function parseComponents() {
  const lines = read("codecov.yml").split("\n");
  const components: { id: string; paths: string[] }[] = [];
  let inPaths = false;
  for (const line of lines) {
    const id = line.match(/^\s+- component_id:\s*(\S+)/);
    if (id) {
      components.push({ id: id[1], paths: [] });
      inPaths = false;
      continue;
    }
    if (/^\s+paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    const item = line.match(/^\s+- (\S+)\s*$/);
    if (inPaths && item && components.length) {
      components[components.length - 1].paths.push(item[1]);
    } else if (inPaths && line.trim() && !item) {
      inPaths = false;
    }
  }
  return components;
}

describe("coverage ownership", () => {
  const owners = parseCodeowners();
  const components = parseComponents();

  it("defines at least the expected components", () => {
    expect(components.map((c) => c.id)).toEqual(
      expect.arrayContaining(["auth-sessions", "payments", "circles", "stellar", "server-platform", "ui"]),
    );
    for (const c of components) expect(c.paths.length).toBeGreaterThan(0);
  });

  it("gives every CODEOWNERS rule at least one @owner", () => {
    expect(owners.length).toBeGreaterThan(0);
    for (const rule of owners) {
      expect(rule.owners.length).toBeGreaterThan(0);
      for (const o of rule.owners) expect(o).toMatch(/^@[\w-]+(\/[\w-]+)?$/);
    }
  });

  it("owns funds-critical areas explicitly", () => {
    const patterns = owners.map((o) => o.pattern);
    for (const p of ["/contracts/", "/migrations/", "/.github/"]) expect(patterns).toContain(p);
  });

  it.each(components.flatMap((c) => c.paths.map((p) => [c.id, p] as const)))(
    "component %s path %s exists and has a specific owner",
    (_id, glob) => {
      const prefix = literalPrefix(glob);
      expect(fs.existsSync(path.join(root, prefix))).toBe(true);

      const covered = owners.some((o) => {
        if (o.pattern === "*") return false;
        const q = literalPrefix(o.pattern.replace(/^\//, ""));
        return prefix.startsWith(q);
      });
      expect(covered).toBe(true);
    },
  );
});
