# SMS Notifications System

## Overview

Ajosave uses Termii SMS API to send automated notifications to members about important circle events. This keeps members informed and engaged throughout the savings cycle.

## Notification Types

### 1. Payout Reminders
**Trigger:** 24 hours before a member's scheduled payout  
**Recipient:** The member who will receive the next payout  
**Frequency:** Once per payout cycle  
**Example:**
```
Ajosave: Your payout of 50.0000000 USDC from "Lagos Girls Monthly Ajo" will be processed in 24 hours. Make sure your Stellar wallet is ready!
```

### 2. Payout Processed
**Trigger:** When a payout is successfully sent  
**Recipients:** All active members in the circle  
**Frequency:** Once per payout  
**Example:**
```
Ajosave: Payout of 50.0000000 USDC processed for Fatima in "Lagos Girls Monthly Ajo". Check your circle dashboard for details.
```

### 3. Contribution Confirmed
**Trigger:** When a member's payment is verified by Paystack  
**Recipient:** The contributing member  
**Frequency:** Once per contribution  
**Example:**
```
Ajosave: Your contribution of 10.0000000 USDC to "Lagos Girls Monthly Ajo" (Cycle 3) has been confirmed. Thank you!
```

### 4. Missed Contribution
**Trigger:** When a member fails to contribute by the cycle deadline  
**Recipient:** The member who missed the contribution  
**Frequency:** Once per missed cycle  
**Example:**
```
Ajosave: You missed your contribution of 10.0000000 USDC to "Lagos Girls Monthly Ajo". Your status is now "defaulted" and you cannot receive future payouts. Contact support if this is an error.
```

### 5. Contribution Reminder
**Trigger:** Hourly cron, when `next_payout_at` is 24h or 2h away  
**Recipients:** Active members with no confirmed contribution for the current cycle  
**Frequency:** At most once per reminder window per cycle (idempotent via `contribution_reminders` table)  
**Examples:**
```
Ajosave: Your contribution of 10.0000000 USDC to "Lagos Girls Monthly Ajo" is due in 24 hours. Please contribute now to avoid being marked as defaulted!
```
```
Ajosave: Your contribution of 10.0000000 USDC to "Lagos Girls Monthly Ajo" is due in 2 hours. Please contribute now to avoid being marked as defaulted!
```

### 6. Join Request Approved
**Trigger:** When a circle creator approves a join request (private circles only)  
**Recipient:** The approved member  
**Frequency:** Once per approval  
**Example:**
```
Ajosave: Your join request for "Lagos Girls Monthly Ajo" has been approved! You'll be notified when the circle starts.
```

### 7. Join Request Rejected
**Trigger:** When a circle creator rejects a join request (private circles only)  
**Recipient:** The rejected member  
**Frequency:** Once per rejection  
**Example:**
```
Ajosave: Your join request for "Lagos Girls Monthly Ajo" has been declined by the creator.
```

## Opt-Out Mechanism

Users can disable SMS notifications from their settings page:

1. Navigate to `/settings`
2. Toggle "SMS Notifications" off
3. Changes take effect immediately

**Note:** Even with SMS disabled, users will still receive OTP codes for authentication (required for security).

## Implementation

### Database Schema

```sql
ALTER TABLE users ADD COLUMN sms_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
```

### Service Layer

All SMS notifications go through `notification.service.ts`, which:
1. Checks if the user has notifications enabled
2. Retrieves the user's phone number
3. Calls the appropriate SMS function
4. Handles errors gracefully (logs but doesn't throw)

### Cron Jobs

Two cron endpoints handle scheduled notifications:

#### `/api/cron/reminders` (Hourly)
- Finds circles with payouts due in 23-25 hours
- Sends reminder SMS to recipients
- Authorization: `Bearer <CRON_SECRET>`

#### `/api/cron/contribution-reminders` (Hourly)
- Finds circles with `next_payout_at` in the 23–25h or 1–3h window
- Sends reminder SMS to active members who haven't confirmed their contribution
- Idempotent: uses `contribution_reminders` table to prevent duplicate sends
- Authorization: `Bearer <CRON_SECRET>`

#### `/api/cron/missed-contributions` (Daily)
- Finds circles past their payout date
- Identifies members who haven't contributed
- Marks them as "defaulted"
- Sends missed contribution SMS

### Vercel Cron Configuration

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/reminders",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/contribution-reminders",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/missed-contributions",
      "schedule": "0 0 * * *"
    }
  ]
}
```

### GitHub Actions Alternative

If not using Vercel Cron, create `.github/workflows/cron.yml`:

```yaml
name: Scheduled Tasks

on:
  schedule:
    - cron: '0 * * * *'  # Hourly reminders
    - cron: '0 0 * * *'  # Daily missed contributions

jobs:
  reminders:
    runs-on: ubuntu-latest
    steps:
      - name: Send Payout Reminders
        run: |
          curl -X GET https://ajosave.app/api/cron/reminders \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
      - name: Send Contribution Reminders
        run: |
          curl -X GET https://ajosave.app/api/cron/contribution-reminders \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"

  missed-contributions:
    runs-on: ubuntu-latest
    steps:
      - name: Process Missed Contributions
        run: |
          curl -X GET https://ajosave.app/api/cron/missed-contributions \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

## Testing

### Manual Testing

```bash
# Test payout reminder
curl -X POST http://localhost:3000/api/test/sms \
  -H "Content-Type: application/json" \
  -d '{
    "type": "payout_reminder",
    "userId": "user_123",
    "circleName": "Test Circle",
    "amount": "50.0000000"
  }'

# Test contribution confirmation
curl -X POST http://localhost:3000/api/test/sms \
  -H "Content-Type: application/json" \
  -d '{
    "type": "contribution_confirmed",
    "userId": "user_123",
    "circleName": "Test Circle",
    "amount": "10.0000000",
    "cycleNumber": 1
  }'
```

### Unit Tests

```typescript
import { notifyPayoutReminder } from "@/server/services/notification.service";

describe("SMS Notifications", () => {
  it("should send payout reminder to user with notifications enabled", async () => {
    // Mock user with notifications enabled
    // Mock SMS service
    // Assert SMS was sent
  });

  it("should not send SMS to user with notifications disabled", async () => {
    // Mock user with notifications disabled
    // Assert SMS was not sent
  });
});
```

## Cost Estimation

Termii SMS pricing (Nigeria):
- ~₦2.50 per SMS

For a circle with 10 members over 10 cycles:
- Payout reminders: 10 SMS × ₦2.50 = ₦25
- Payout processed: 10 cycles × 10 members × ₦2.50 = ₦250
- Contribution confirmations: 10 cycles × 10 members × ₦2.50 = ₦250
- **Total: ~₦525 per circle**

## Rate Limits

Termii's published limits:

| Limit | Value | Applies to |
|---|---|---|
| Requests per second | 100 | All send endpoints |
| Messages per day | 10,000 (default plan) | Account-wide |

The app sends per-event, per-recipient (no fan-out batching), so day volume
scales with circle size × events. A 50-member circle at ~5 SMS per member per
cycle is ~250 SMS/cycle — well inside the default plan. If you approach the
daily ceiling, Termii returns HTTP 429 and messages are dropped for that day
(see the failure flow below), so alerting on sustained 4xx rates matters more
than the theoretical ceiling.

### How the app handles 429 responses

`sendOtp` (`src/lib/sms.ts`) posts to `/sms/send` with axios; a 429 surfaces
as a rejected promise like any other Termii error. There is **no in-process
retry**: the catch path in `notification.service.ts` logs the error and falls
back to email when the user has it enabled. Retrying inside the request would
risk duplicate sends once Termii's window recovers, and an SMS that is
already paid for twice is worse than one email. Sustained 429s therefore look
like: SMS error logs (`Failed to send … SMS`), then email deliveries, with no
user-visible gap beyond the channel change.

If 429s become routine, the durable fixes are operational, not code:
raise the Termii plan limit, or move bulk notification types (payout
processed, reminders) onto the queueing path described in
`outbox-processor.service.ts` with a send-rate cap.

## Delivery Failure Flow

Every notification goes through `notification.service.ts`, which owns the
fallback chain:

```
SMS (Termii)  ──success──▶ done
     │
     └──error──▶ log `Failed to send … SMS`
                     │
                     └──▶ email (if user has email notifications enabled
                              and an address on file)
                                │
                                └──error──▶ log `Failed to send … email`
```

- **Retry logic:** none at the SMS layer, by design — a failed send is never
  automatically re-attempted, so a timeout that actually delivered cannot
  duplicate. The next scheduled occurrence of the same notification (e.g. the
  next reminder window) naturally covers genuine non-deliveries.
- **Email fallback:** implemented for payout reminders, contribution
  reminders, and payout-processed notices (`sendPayoutReminderEmail`,
  `sendContributionReminderEmail`, … in `@/lib/email`). Fallback fires only
  when the user opted into email and has an address; opt-out of both channels
  means the event is simply logged.
- **Outbox events:** durable notification events pass through
  `outbox-processor.service.ts`. Unrecoverable handler errors are caught by
  the processor and the event is marked failed (`markEventFailed`) instead of
  wedging the queue — failed rows are the alerting surface: query
  `SELECT * FROM notification_outbox WHERE status = 'failed'` (or wire it to
  your monitoring) after deploys or Termii incidents.
- **Alerting:** alert on the log lines `Failed to send … SMS` /
  `Failed to send … email` and on growth of failed outbox rows. There is no
  third-party pager integration yet; a simple cron over the failed-outbox
  table opening a GitHub issue is enough at current volume.

## API Key Rotation (Zero Downtime)

`TERMII_API_KEY` is a single env var read per request
(`serverConfig.termii.apiKey`), so rotation is an env swap plus redeploy —
no schema change, no migration. The zero-downtime sequence:

1. In the Termii dashboard, **create a second API key** (do not regenerate
   the existing one yet — both stay valid during the overlap).
2. Update `TERMII_API_KEY` in Vercel (Production *and* Preview env vars) to
   the new key. Trigger a redeploy; during the rollout some instances still
   hold the old key, which remains valid, so no send fails mid-deploy.
3. Verify: watch logs for a successful send, or hit the OTP endpoint once.
4. **Revoke the old key** in the Termii dashboard — only after the new key
   has served traffic. This is the step that makes the rotation complete;
   an unrevoked old key is a standing credential.
5. If a key is ever suspected compromised, skip the overlap: revoke first,
   then update the env and redeploy — expect a short SMS outage window
   instead of standing exposure.

`TERMII_SENDER_ID` rotates the same way if the registered sender ID changes.

## SMS Content Templates, Character Limits, and Unicode

Termii segments messages by encoding:

| Encoding | Max chars per segment | Detected when |
|---|---|---|
| GSM-7 | 160 (single) / 153 (concatenated) | Body uses only GSM-7 charset |
| UCS-2 (Unicode) | 70 (single) / 67 (concatenated) | Any non-GSM character (₦, emoji, curly quotes, most African language diacritics) |

Rules the templates in this doc follow:

- **Never put `₦` or emoji in an SMS.** One Unicode character drops the whole
  message to 70-char segments — the 140-char payout-reminder example becomes
  three segments instead of one, tripling cost. Write `NGN` or lead with the
  USDC amount (all circle amounts are USDC anyway).
- Keep templates under **160 GSM-7 chars** for one segment. The longest
  template here (payout reminder, with a long circle name) is ~140 — verify
  after substituting real circle names, since names are user-controlled.
- Circle names are interpolated into the body; very long names can push past
  a segment boundary. If you extend a template, budget ~40 chars for the
  circle name slot.
- Concatenation still works past the single-segment limit (Termii auto-
  concatenates); it just bills per segment. Treat >1 segment as a smell, not
  an error.
- All current templates are `type: "plain"` (`src/lib/sms.ts`) — no GSM-7
  extension characters (e.g. `^ { } \ [ ] ~ |`) are used, so no encoding
  surprises beyond the Unicode rule above.

## Testing SMS in Local Dev

Three layers, from safest outward:

### 1. Unit tests (no network)

The service-layer tests mock the Termii client — assert that `sendOtp` is
called with the right phone/body and that a rejected send falls through to
the email path. This is the default for `npm test`; nothing leaves the
machine.

### 2. Mock / test endpoint (local, still no real SMS)

The manual test route exercises the full notification path with a fake
recipient:

```bash
curl -X POST http://localhost:3000/api/test/sms \
  -H "Content-Type: application/json" \
  -d '{
    "type": "payout_reminder",
    "userId": "user_123",
    "circleName": "Test Circle",
    "amount": "50.0000000"
  }'
```

With email notifications enabled on the test user, a Termii failure (or a
placeholder key) still produces the email fallback, which is the easiest way
to verify the failure flow end to end locally: point `TERMII_API_KEY` at
garbage, trigger the endpoint, confirm the email arrives and the SMS error is
logged.

### 3. Termii sandbox (real HTTP, delivered to Termii's test numbers)

Termii provides a sandbox environment with its own base URL and API keys —
messages there do not reach real subscribers and are free.

1. Create a **sandbox key** in the Termii dashboard (sandbox project).
2. Point local env at it (`TERMII_API_KEY=<sandbox key>` in `.env.local`;
   keep `STELLAR_NETWORK=testnet`).
3. Trigger the test endpoint or the OTP route with a phone number from
   Termii's sandbox recipient list.
4. Confirm delivery in the Termii sandbox inbox/dashboard rather than on a
   phone.

Never paste a production key into `.env.local` for a smoke test — use the
sandbox, and remember `gitleaks` runs on every push precisely because real
keys have tried to reach the repo before.

## Privacy & Compliance

- Phone numbers are stored securely in PostgreSQL
- SMS opt-out is honored immediately
- No SMS content contains sensitive data (wallet keys, passwords)
- Users can request data deletion (GDPR compliance)

## Future Enhancements

- [ ] WhatsApp notifications (Termii supports this)
- [x] Email notifications as fallback (implemented — see Delivery Failure Flow)
- [ ] Customizable notification preferences (per event type)
- [ ] SMS delivery status tracking
- [ ] Multi-language support
