# Security Policy

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

We run a coordinated vulnerability disclosure program. Use one of the channels below to report a vulnerability privately. Reports sent through these channels are triaged, assigned a severity, tracked to remediation, and closed only after a fix has been deployed and the reporter has been credited (unless they opt out).

### Private reporting channels

- **Email:** security@stellar.app (encrypt to the published security PGP key when the report contains sensitive exploit details or user data)
- **GitHub Security Advisories:** open a private vulnerability report via the repository's *Security* tab → *Report a vulnerability*. This creates a draft advisory visible only to maintainers.

Use whichever channel you prefer. Do not discuss a vulnerability in public (issues, pull requests, Discord, or social media) before an agreed fix date.

### What to include

A good report contains enough detail for us to reproduce and triage it:

1. Description of the vulnerability and its class (e.g. reentrancy, auth bypass, injection)
2. Affected component: contract, API endpoint, frontend page, or infrastructure
3. Step-by-step reproduction, including transactions, requests, or tooling used
4. Potential impact: fund loss, data exposure, service disruption, who is affected
5. Proof-of-concept or exploit code, where available
6. Your suggested fix or mitigation, if you have one
7. Your GitHub handle or email for follow-up and disclosure credit

### Scope

**In scope**

- Smart contract vulnerabilities (Ajo and certificate Soroban contracts) that can lead to fund loss, lock-up, or state corruption
- Authentication and authorization bypass, including session and wallet-signature flaws
- Financial logic errors: contribution, payout, FX, and reconciliation paths
- Injection vulnerabilities: SQL, command, template, or cross-site scripting
- Exposure of PII, secrets, or private keys through any channel
- Cryptographic weaknesses in certificate minting or request signing

**Out of scope**

- Social engineering of staff or users
- Denial-of-service and volumetric attacks
- Findings that require physical device access or a compromised endpoint
- Vulnerabilities in third-party dependencies already disclosed upstream, unless Ajosave is demonstrably affected
- Reports from automated scanners with no demonstrated impact
- Missing security headers or best-practice hardening without a concrete exploit path

### Severity and remediation targets

We use CVSS v3.1 as a starting point and adjust for context (funds at risk, exploitability, user exposure).

| Severity | CVSS | Acknowledge | Fix or mitigation | Public disclosure |
| --- | --- | --- | --- | --- |
| Critical | 9.0–10.0 | 24 hours | 7 days | Coordinated, after fix ships |
| High | 7.0–8.9 | 48 hours | 14 days | Coordinated, after fix ships |
| Medium | 4.0–6.9 | 5 days | 30 days | Coordinated or after fix ships |
| Low | 0.1–3.9 | 10 days | Next scheduled release | At maintainer discretion |

These are targets, not guarantees. Critical issues may trigger an out-of-band release and a contract pause or upgrade where one is available.

### Triage and remediation workflow

Every report follows the same path from intake to closure:

1. **Intake** — the report lands in the security inbox or draft advisory and is acknowledged within the window for its severity.
2. **Triage** — a maintainer reproduces the issue, confirms scope, and assigns a severity. Out-of-scope or non-reproducible reports are closed with an explanation.
3. **Assignment** — the issue is assigned an owner and an internal tracking entry. For contract bugs this includes a decision on pause, upgrade, or migration.
4. **Remediation** — a fix is developed on a private branch, reviewed, and shipped. Regression coverage is added so the class of bug cannot silently return.
5. **Verification** — the reporter is invited to verify the fix before any public disclosure.
6. **Disclosure and closure** — a GitHub Security Advisory is published (or the report is closed privately at the reporter's request), credit is recorded, and the entry is archived.

### Safe harbour

We consider security research conducted in good faith and in line with this policy to be authorised. We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, and service disruption
- Report findings promptly through a private channel and keep them confidential until we have had a reasonable opportunity to fix them
- Do not access user data beyond what is necessary to demonstrate the vulnerability, and do not use a finding to move, hold, or access user funds

### Dependency and supply-chain reports

Vulnerabilities in Ajosave's direct dependencies should be reported here as well when a fix requires an application-level change (for example a pinned version that cannot be upgraded without a code change). Include the dependency name, affected version range, and the upstream advisory link.

### Questions

Questions about this policy, the severity of a finding, or the disclosure timeline can be sent to security@stellar.app. We are happy to work with you on a coordinated schedule.
