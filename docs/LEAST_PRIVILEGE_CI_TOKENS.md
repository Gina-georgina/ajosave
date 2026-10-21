# Least-Privilege CI Tokens

> **Issue #108** — Documents the token permission model applied to every GitHub
> Actions workflow in this repository.

---

## Principle

Every GitHub Actions workflow runs with the **minimum token permissions**
required for its tasks. This limits the blast radius if a workflow is
compromised via a malicious dependency, a supply-chain attack on a pinned
Action, or a misconfigured trigger.

The default GITHUB_TOKEN scope is `read-all` at the repository level (as
configured in `Settings → Actions → Workflow permissions`). Each workflow
then **explicitly opt-in** to the narrower scopes it actually needs, following
the [principle of least privilege](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token).

---

## Workflow Permission Matrix

| Workflow | contents | security-events | pull-requests | deployments | issues | id-token |
|----------|----------|-----------------|---------------|-------------|--------|----------|
| `ci.yml` | read | — | — | — | — | — |
| `security.yml` | read | write | write | — | — | — |
| `secrets-scan.yml` | read | write | write | — | — | — |
| `dependency-policy.yml` | read | — | write | — | — | — |
| `pr-checks.yml` | read | — | write | — | — | — |
| `pr-preview.yml` | read | — | write | write | — | — |
| `staging-deploy.yml` | read | — | — | write | — | — |
| `production-deploy.yml` | read | — | — | write | — | — |
| `production-rollback.yml` | read | — | — | write | — | — |
| `branch-protection.yml` | read | — | — | — | — | — |
| `contract-wasm-release.yml` | write | — | — | — | — | write |
| `sbom-provenance.yml` | write | — | — | — | — | write |
| `dast.yml` | read | write | — | — | write | — |
| `contract-fuzz.yml` | read | — | — | — | write | — |
| `secret-rotation-reminder.yml` | read | — | — | — | write | — |
| `contract-audit-readiness.yml` | read | — | — | — | — | — |
| `backup.yml` | read | — | — | — | — | — |
| `restore-drill.yml` | read | — | — | — | — | — |
| `uptime.yml` | read | — | — | — | — | — |
| `load-test.yml` | read | — | — | — | — | — |
| `lighthouse-ci.yml` | read | — | — | — | — | — |
| `realtime-integration.yml` | read | — | — | — | — | — |
| `visual-regression.yml` | read | — | — | — | — | — |

---

## Permission Definitions

| Permission | Scope | Why it's needed |
|------------|-------|-----------------|
| `contents: read` | Repository files | Checkout and read source |
| `contents: write` | Repository files | Upload release assets (WASM, SBOM) |
| `security-events: write` | GitHub Security tab | Upload SARIF scan results |
| `pull-requests: write` | PR comments | Post audit summaries, preview URLs |
| `deployments: write` | GitHub Deployments API | Record deploy/rollback events |
| `issues: write` | GitHub Issues | Open/update rotation reminder or fuzz-regression issue |
| `id-token: write` | OIDC | Sign SLSA provenance attestations |

---

## Third-Party Actions Pinning

All third-party (non-`actions/*` / non-`github/*`) Actions must be pinned to a
full 40-character commit SHA to prevent unexpected code execution from a
tag re-assignment. This is enforced by the `actions-pin-check` job in
[`dependency-policy.yml`](.github/workflows/dependency-policy.yml).

Example of correct pinning:
```yaml
uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0
```

---

## Repository Default Permissions

Set `Settings → Actions → General → Workflow permissions` to:

- **Read repository contents and packages permissions** (read-only default)
- Uncheck "Allow GitHub Actions to create and approve pull requests"

Individual workflows then opt-in to the additional scopes they need via
`permissions:` blocks.

---

## Related

- [`docs/DEPENDENCY_SECURITY_POLICY.md`](DEPENDENCY_SECURITY_POLICY.md)
- [`docs/secrets-security.md`](secrets-security.md)
- [GitHub docs — Workflow permissions](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token)
