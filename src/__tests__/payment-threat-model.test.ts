/**
 * @jest-environment node
 *
 * Guards docs/payment-threat-model.md: rows are well formed, IDs are unique,
 * every status is valid and every cited evidence file exists.
 */
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const doc = fs.readFileSync(path.join(root, "docs/payment-threat-model.md"), "utf8");

const STATUSES = ["Mitigated", "Partial", "Open"];
const STRIDE = ["Spoofing", "Tampering", "Repudiation", "Info disclosure", "Denial of service", "Elevation", "Replay", "Double spend"];

/** Splits a markdown table row on `|` that is not inside backticks. */
function cells(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inCode = false;
  for (const ch of row) {
    if (ch === "`") inCode = !inCode;
    if (ch === "|" && !inCode) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.slice(1, -1);
}

const threats = doc
  .split("\n")
  .filter((l) => /^\| PT-\d+ /.test(l))
  .map((l) => {
    const [id, stride, threat, mitigation, evidence, status] = cells(l);
    return { id, stride, threat, mitigation, evidence, status };
  });

describe("payment threat model", () => {
  it("lists a meaningful number of threats", () => {
    expect(threats.length).toBeGreaterThanOrEqual(15);
  });

  it("uses unique, sequential IDs", () => {
    const ids = threats.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id, i) => expect(id).toBe(`PT-${String(i + 1).padStart(2, "0")}`));
  });

  it.each(threats.map((t) => [t.id, t] as const))("%s is complete and valid", (_id, t) => {
    expect(t.threat.length).toBeGreaterThan(10);
    expect(t.mitigation.length).toBeGreaterThan(10);
    expect(STATUSES).toContain(t.status);
    expect(STRIDE.some((s) => t.stride.startsWith(s))).toBe(true);
  });

  it.each(threats.map((t) => [t.id, t] as const))("%s cites evidence files that exist", (_id, t) => {
    const files = [...t.evidence.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(fs.existsSync(path.join(root, f))).toBe(true);
  });

  it("covers every STRIDE category", () => {
    for (const cat of ["Spoofing", "Tampering", "Repudiation", "Info disclosure", "Denial of service", "Elevation"]) {
      expect(threats.some((t) => t.stride.startsWith(cat))).toBe(true);
    }
  });

  it("lists every non-mitigated threat in the residual risk backlog", () => {
    const backlog = doc.split("## Residual risk backlog")[1]?.split("## Maintenance")[0] ?? "";
    for (const t of threats.filter((x) => x.status !== "Mitigated")) {
      expect(backlog).toContain(t.id);
    }
  });
});
