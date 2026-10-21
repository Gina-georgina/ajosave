# Reminder preferences, feature flags, analytics consent, dispute timeline

Migration: `migrations/1790400000000_add-reminders-flags-consent-dispute-timeline.ts`
(run with the normal migration flow; `down` drops all four tables).

## Reminder preferences
- `GET/PUT /api/user/reminder-preferences` (authenticated user, own data only).
- Lead times are limited to 2h and 24h to match `contribution_reminders`; channels are `email` and `sms`.
- Enabled reminders need at least one lead time and one channel. Users with no row get the defaults (enabled, 24h + 2h, email + SMS).

## Admin feature flags
- `GET/PUT /api/admin/feature-flags` (admin role only). Keys match `[a-z0-9_.-]+`.
- Server code calls `isFeatureEnabled(key, userId)`. Missing flags and database errors read as **disabled**.
- `rolloutPercent` (0-100) buckets users deterministically by `sha256(key:userId)`, so a user keeps the same result.
- Rollback: set `enabled` to false or `rolloutPercent` to 0.

## Analytics consent taxonomy
- Categories: `essential` (always granted, cannot be revoked), `performance`, `marketing`. Non-essential defaults to not granted.
- `GET/PUT /api/user/analytics-consent`; gate any non-essential tracking with `hasConsent(userId, category)`.

## Dispute evidence timeline
- `GET /api/disputes/:id/timeline`: the dispute's member or an admin. Events: `created`, `evidence_added`, `status_changed`, `resolved`.
- Events are written by `dispute.service` on create, status change and resolution. Writes are best-effort: a failure is logged as `dispute.timeline_write_failed` and does not block the dispute action.
