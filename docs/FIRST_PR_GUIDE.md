# First PR Guide

A zero-to-merged walkthrough for first-time contributors. It assumes you have
never seen this repo before. Rules and policy live in
[CONTRIBUTING.md](../CONTRIBUTING.md); this guide is only the happy path with
the exact commands in order.

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 20.x or 22.x | `node -v` |
| npm | 10+ | `npm -v` |
| Git | 2.40+ | `git -v` |
| Docker Desktop | latest (optional, for Postgres/Redis) | `docker -v` |
| Stellar CLI | for contract work only | `stellar --version` |

```bash
$ node -v
v22.14.0
$ npm -v
10.9.2
```

You also need a free GitHub account.

---

## 2. Fork and clone

1. Open <https://github.com/joekeyz8/ajosave> and click **Fork** (keep
   "Copy the DEFAULT branch only" checked).
2. Clone **your fork** and add the upstream remote:

```bash
git clone https://github.com/<YOUR_USERNAME>/ajosave.git
cd ajosave
git remote add upstream https://github.com/joekeyz8/ajosave.git

# Verify: origin = your fork, upstream = the real repo
$ git remote -v
origin    https://github.com/<YOUR_USERNAME>/ajosave.git (fetch)
origin    https://github.com/<YOUR_USERNAME>/ajosave.git (push)
upstream  https://github.com/joekeyz8/ajosave.git (fetch)
upstream  https://github.com/joekeyz8/ajosave.git (push)
```

---

## 3. Local setup

```bash
# Install dependencies (also sets up husky commit hooks)
npm install

# Create your local env file from the template
cp .env.example .env.local
```

Open `.env.local` and fill the minimum set (descriptions for every variable
are in the file itself; full reference in
[docs/environment-variables.md](environment-variables.md)):

```bash
# Generate the auth secret
$ openssl rand -hex 32
9f2c...64 hex chars...a1b0

# Local services (started in the next step)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ajosave
REDIS_URL=redis://localhost:6379
STELLAR_NETWORK=testnet
```

Start Postgres and Redis:

```bash
docker-compose up -d
$ docker-compose ps
Name                State    Ports
------------------------------------------------
ajosave-postgres-1  running  0.0.0.0:5432->5432/tcp
ajosave-redis-1     running  0.0.0.0:6379->6379/tcp
```

Start the dev server:

```bash
npm run dev
$ npm run dev
  ▲ Next.js 15
  - Local:        http://localhost:3000
```

Open <http://localhost:3000> — you should see the Ajosave landing page. That's
your local stack working.

---

## 4. Find an issue

Pick something small and labelled for newcomers:

- **Good first issues:** <https://github.com/joekeyz8/ajosave/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22>
- **All open issues:** <https://github.com/joekeyz8/ajosave/issues?q=is%3Aissue+is%3Aopen>
- **Documentation only:** <https://github.com/joekeyz8/ajosave/issues?q=is%3Aissue+is%3Aopen+label%3Adocumentation>

Comment on the issue you want (`I'd like to take this`) so nobody duplicates
your work. Maintainers can also assign it to you.

---

## 5. Create a branch

Always branch from an up-to-date `upstream/main` — never from your fork's
`main` directly:

```bash
git fetch upstream
git checkout -b feat/issue-<NUMBER>-<short-description> upstream/main
# example
git checkout -b feat/issue-112-fix-footer-typo upstream/main
```

Branch naming (see CONTRIBUTING.md for the full table): `feat/`, `fix/`,
`docs/`, `test/`, `chore/` + `/issue-<N>-` + a short kebab-case slug.

---

## 6. Make your change

Work in small, focused edits. Two habits that save review cycles:

- Read the issue's **Acceptance Criteria** and check each box off as you go.
- Keep your diff scoped to the issue — no drive-by refactors, no reformatting
  files you didn't otherwise touch.

---

## 7. Run the checks

The same checks run in CI, so run them locally first:

```bash
# Unit tests
npm test
$ npm test
Test Suites: 12 passed, 12 total
Tests:       87 passed, 87 total

# Lint
npm run lint

# Type check
npm run type-check

# Formatting
npm run format:check
```

Fix anything that fails, then stage and commit. Husky runs extra checks on
every commit — if a hook blocks you, fix the problem and commit again:

```bash
git add -A
git commit -m "docs: fix footer typo (issue #112)"
```

---

## 8. Push and open the PR

```bash
git push -u origin feat/issue-112-fix-footer-typo
```

GitHub prints a "Compare & pull request" link — open it, or go to
<https://github.com/joekeyz8/ajosave/compare> yourself.

A good PR description has:

1. **What** — one or two sentences on what changed.
2. **Why** — link the issue: `Closes #112` (this auto-closes it on merge).
3. **How to test** — the commands a reviewer can run to verify.

Then click **Create pull request**. CI runs automatically on your PR — watch
the checks tab; a maintainer reviews once they are green.

---

## 9. After you open the PR

- **Respond to review comments** with either the fix or a short explanation,
  then push again to the same branch (the PR updates automatically).
- **Do not open a second PR** for the same issue — keep iterating on the one
  you have.
- Once approved and merged, delete your branch (GitHub offers a button) and
  sync your fork's `main`:

```bash
git checkout main
git fetch upstream
git merge upstream/main
git push origin main
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker-compose: command not found` | Use `docker compose` (v2 plugin) instead, or skip Docker and use hosted dev services |
| Port 3000 already in use | `npm run dev -- -p 3001`, or stop the other process |
| `pg_ctl: could not start server` | Ensure Docker Desktop is running, then `docker-compose down && docker-compose up -d` |
| Husky hook "permission denied" | `chmod +x .husky/*` |
| PR merge conflict | `git fetch upstream && git merge upstream/main` on your branch, resolve, push |
| CI fails but local passes | Re-run `npm ci` (CI installs from the lockfile exactly) and the same four checks from step 7 |

---

## Where to go next

- [CONTRIBUTING.md](../CONTRIBUTING.md) — full rules, commit style, review SLAs
- [docs/environment-variables.md](environment-variables.md) — every env var explained
- [docs/contract-auditor-guide.md](contract-auditor-guide.md) — working on the Soroban contracts
- Good first issues: <https://github.com/joekeyz8/ajosave/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22>
