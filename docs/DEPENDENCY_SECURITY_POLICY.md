# Dependency Security Policy

> **Issue #107** — This document defines how Ajosave manages the security of its
> third-party dependencies (npm, Cargo, and GitHub Actions) across the full
> development-and-release lifecycle.

---

## 1. Scope

| Ecosystem | Location | Manager |
|-----------|----------|---------|
| npm (Node.js) | `/` | `npm` |
| Cargo (Rust) | `/contracts` | `cargo` |
| GitHub Actions | `.github/workflows/` | Dependabot |

---

## 2. Automated Dependency Updates (Dependabot)

Dependabot is configured in [`.github/dependabot.yml`](.github/dependabot.yml)
and runs **weekly on Mondays at 06:00 UTC** for all three ecosystems.

| Rule | npm | Cargo | Actions |
|------|-----|-------|---------|
| Patch updates — auto-merge | ✅ | ✅ | ✅ |
| Minor updates — PR, human review | ✅ | ✅ | ✅ |
| Major updates — PR, blocked from auto-merge | ✅ (except `next`) | ✅ | ✅ |

---

## 3. Severity Thresholds and Blocking Rules

### npm

`npm audit --audit-level=high` runs in the **CI** and **Security Audit**
workflows on every PR and push to `main`.

| Severity | Action |
|----------|--------|
| `critical` | ❌ Blocks merge |
| `high` | ❌ Blocks merge |
| `moderate` | ⚠️ Warning comment on PR — must be triaged within 7 days |
| `low` | ℹ️ Informational only |

### Cargo

`cargo audit` runs in the **Security Audit** workflow for Rust contracts.

| CVSS | Action |
|------|--------|
| ≥ 9.0 (Critical) | ❌ Blocks merge |
| 7.0 – 8.9 (High) | ❌ Blocks merge |
| 4.0 – 6.9 (Medium) | ⚠️ Triage within 7 days |
| < 4.0 (Low) | ℹ️ Informational |

### Container image (Trivy)

`trivy` scans the Docker image in the **Security Audit** workflow.
`CRITICAL` and `HIGH` CVEs are uploaded to the GitHub Security tab via SARIF.

---

## 4. Pinning and Version Locking

### npm

- All production and dev dependencies use **exact or caret (`^`) versions**
  in `package.json`.
- `package-lock.json` is committed and validated with `npm ci` (not `npm install`)
  in every CI job.

### Cargo

- `Cargo.lock` is committed and locked for the Soroban contract workspace.

### GitHub Actions

- Third-party (non-GitHub-official) Actions **must be pinned to a full SHA**,
  for example:
  ```yaml
  uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0
  ```
- GitHub-official Actions (`actions/*`, `github/*`) may use semver tags (`@v4`).

---

## 5. Adding or Upgrading a Dependency

1. Open a PR. The CI pipeline runs `npm audit` (or `cargo audit`) automatically.
2. If any **high** or **critical** advisory is introduced, the PR **cannot be merged**.
3. Reviewer must verify:
   - The package is well-maintained (last release < 12 months, active issue tracker).
   - No known typosquatting or supply-chain risk.
   - No unnecessary broad permissions (e.g. `postinstall` scripts that phone home).
4. Major version bumps require a dedicated PR with a summary of breaking-change impact.

---

## 6. Vulnerability Response SLA

| Severity | Acknowledge | Patch or mitigation deployed |
|----------|-------------|------------------------------|
| Critical | 4 hours | 24 hours |
| High | 24 hours | 72 hours |
| Medium | 3 business days | 7 business days |
| Low | 7 business days | Next scheduled release |

The on-call engineer is responsible for acknowledging and triaging; see
[`docs/incident-runbook.md`](docs/incident-runbook.md) for escalation paths.

---

## 7. Exception Process

If a vulnerable dependency **cannot** be updated within the SLA (e.g. no upstream
fix exists):

1. Open a GitHub Issue with label `security:exception`.
2. Document: affected package, CVE/advisory ID, exposure surface, compensating
   controls applied (e.g. input validation, network isolation).
3. Get sign-off from at least one maintainer with `security` write access.
4. Exceptions expire after **30 days** and must be re-reviewed.

---

## 8. CI Enforcement Summary

| Check | Workflow | Blocks merge? |
|-------|----------|---------------|
| `npm audit --audit-level=high` | `security.yml`, `dependency-policy.yml` | ✅ Yes (high/critical) |
| `cargo audit` | `security.yml` | ✅ Yes (high/critical) |
| Trivy container scan | `security.yml` | SARIF uploaded; advisory |
| Gitleaks / TruffleHog | `secrets-scan.yml` | ✅ Yes |
| Dependabot open PRs | Dependabot | Advisory |

---

## 9. Related Documents

- [`docs/secrets-security.md`](docs/secrets-security.md) — secret rotation and storage
- [`docs/SECRET_ROTATION.md`](docs/SECRET_ROTATION.md) — rotation runbook
- [`SECURITY.md`](SECURITY.md) — vulnerability disclosure policy
- [`.github/dependabot.yml`](.github/dependabot.yml) — Dependabot configuration
