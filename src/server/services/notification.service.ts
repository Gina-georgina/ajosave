import { query } from "@/lib/db";
import {
  sendPayoutReminderSms,
  sendPayoutProcessedSms,
  sendMissedContributionSms,
  sendContributionReminderSms,
  sendContributionReceivedSms,
  sendJoinRequestApprovedSms,
  sendJoinRequestRejectedSms,
  sendCircleCancelledSms,
  sendCircleCancelledNoRefundSms,
  sendCirclePausedSms,
  sendCircleResumedSms,
  sendWaitlistSpotOpenedSms,
} from "@/lib/sms";
import {
  sendPayoutReminderEmail,
  sendPayoutProcessedEmail,
  sendMissedContributionEmail,
  sendContributionReminderEmail,
  sendContributionReceivedEmail,
  sendJoinRequestApprovedEmail,
  sendJoinRequestRejectedEmail,
  sendCircleCancelledEmail,
  sendCirclePausedEmail,
  sendCircleResumedEmail,
  sendCircleCompletedEmail,
  sendInviteRedeemedEmail,
} from "@/lib/email";

interface UserDetails {
  phone: string | null;
  email: string | null;
  displayName: string;
  smsNotificationsEnabled: boolean;
  emailNotificationsEnabled: boolean;
}

async function getUserDetails(userId: string): Promise<UserDetails | null> {
  const { rows } = await query(
    "SELECT phone, email, display_name AS \"displayName\", sms_notifications_enabled AS \"smsNotificationsEnabled\", email_notifications_enabled AS \"emailNotificationsEnabled\" FROM users WHERE id = $1",
    [userId]
  );
  return rows[0] || null;
}

/**
 * Send payout reminder 24 hours before payout
 */
export async function notifyPayoutReminder(
  userId: string,
  circleName: string,
  amount: string,
  hoursUntilPayout: number = 24
): Promise<void> {
  const userDetails = await getUserDetails(userId);
  if (!userDetails) return;

  let sent = false;

  // Try SMS first
  if (userDetails.smsNotificationsEnabled && userDetails.phone) {
    try {
      await sendPayoutReminderSms(userDetails.phone, circleName, amount, hoursUntilPayout);
      sent = true;
    } catch (error) {
      console.error(`Failed to send payout reminder SMS to ${userId}:`, error);
    }
  }

  // Try email if enabled, has email, and either SMS failed or not sent
  if (userDetails.emailNotificationsEnabled && userDetails.email) {
    try {
      await sendPayoutReminderEmail(userDetails.email, userDetails.displayName, circleName, amount, hoursUntilPayout, userId);
    } catch (error) {
      console.error(`Failed to send payout reminder email to ${userId}:`, error);
    }
  }
}

/**
 * Send a contribution reminder SMS to a member before the cycle deadline.
 * Checks that the user has SMS notifications enabled and a phone number on file.
 * Logs but does not throw if the SMS delivery fails.
 */
export async function notifyContributionReminder(
  userId: string,
  circleName: string,
  amount: string,
  hoursLeft: number
): Promise<void> {
  const userDetails = await getUserDetails(userId);
  if (!userDetails) return;

  let sent = false;

  // Try SMS first
  if (userDetails.smsNotificationsEnabled && userDetails.phone) {
    try {
      await sendContributionReminderSms(userDetails.phone, circleName, amount, hoursLeft);
      sent = true;
    } catch (error) {
      console.error(`Failed to send contribution reminder SMS to ${userId}:`, error);
    }
  }

  // Try email if enabled, has email
  if (userDetails.emailNotificationsEnabled && userDetails.email) {
    try {
      const dueDate = new Date(Date.now() + hoursLeft * 60 * 60 * 1000);
      await sendContributionReminderEmail(userDetails.email, userDetails.displayName, circleName, amount, "USDC", dueDate, userId);
    } catch (error) {
      console.error(`Failed to send contribution reminder email to ${userId}:`, error);
    }
  }
}

/**
 * Notify all circle members when a payout is processed
 */
export async function notifyPayoutProcessed(
  memberUserIds: string[],
  circleName: string,
  amount: string,
  recipientName: string
): Promise<void> {
  const notifications = memberUserIds.map(async (userId) => {
    const userDetails = await getUserDetails(userId);
    if (!userDetails) return;

    let sent = false;

    // Try SMS first
    if (userDetails.smsNotificationsEnabled && userDetails.phone) {
      try {
        await sendPayoutProcessedSms(userDetails.phone, circleName, amount, recipientName);
        sent = true;
      } catch (error) {
        console.error(`Failed to send payout processed SMS to ${userId}:`, error);
      }
    }

    // Try email if enabled, has email
    if (userDetails.emailNotificationsEnabled && userDetails.email) {
      try {
        await sendPayoutProcessedEmail(userDetails.email, userDetails.displayName, circleName, amount, recipientName, userId);
      } catch (error) {
        console.error(`Failed to send payout processed email to ${userId}:`, error);
      }
    }
  });

  await Promise.allSettled(notifications);
}

/**
 * Notify member when they miss a contribution
 */
export async function notifyMissedContribution(
  userId: string,
  circleName: string,
  amount: string
): Promise<void> {
  const userDetails = await getUserDetails(userId);
  if (!userDetails) return;

  let sent = false;

  // Try SMS first
  if (userDetails.smsNotificationsEnabled && userDetails.phone) {
    try {
      await sendMissedContributionSms(userDetails.phone, circleName, amount);
      sent = true;
    } catch (error) {
      console.error(`Failed to send missed contribution SMS to ${userId}:`, error);
    }
  }

  // Try email if enabled, has email
  if (userDetails.emailNotificationsEnabled && userDetails.email) {
    try {
      await sendMissedContributionEmail(userDetails.email, userDetails.displayName, circleName, amount, userId);
    } catch (error) {
      console.error(`Failed to send missed contribution email to ${userId}:`, error);
    }
  }
}

/**
 * Notify member when their contribution is confirmed
 */
export async function notifyContributionReceived(
  userId: string,
  circleName: string,
  amount: string,
  cycleNumber: number
): Promise<void> {
  const userDetails = await getUserDetails(userId);
  if (!userDetails) return;

  let sent = false;

  // Try SMS first
  if (userDetails.smsNotificationsEnabled && userDetails.phone) {
    try {
      await sendContributionReceivedSms(userDetails.phone, circleName, amount, cycleNumber);
      sent = true;
    } catch (error) {
      console.error(`Failed to send contribution received SMS to ${userId}:`, error);
    }
  }

  // Try email if enabled, has email
  if (userDetails.emailNotificationsEnabled && userDetails.email) {
    try {
      await sendContributionReceivedEmail(userDetails.email, userDetails.displayName, circleName, amount, cycleNumber, userId);
    } catch (error) {
      console.error(`Failed to send contribution received email to ${userId}:`, error);
    }
  }
}

/**
 * Notify member when their join request is approved
 */
export async function notifyJoinRequestApproved(
  userId: string,
  circleName: string
): Promise<void> {
  const userDetails = await getUserDetails(userId);
  if (!userDetails) return;

  let sent = false;

  // Try SMS first
  if (userDetails.smsNotificationsEnabled && userDetails.phone) {
    try {
      await sendJoinRequestApprovedSms(userDetails.phone, circleName);
      sent = true;
    } catch (error) {
      console.error(`Failed to send join request approved SMS to ${userId}:`, error);
    }
  }

  // Try email if enabled, has email
  if (userDetails.emailNotificationsEnabled && userDetails.email) {
    try {
      await sendJoinRequestApprovedEmail(userDetails.email, userDetails.displayName, circleName, userId);
    } catch (error) {
      console.error(`Failed to send join request approved email to ${userId}:`, error);
    }
  }
}

/**
 * Notify member when their join request is rejected
 */
export async function notifyJoinRequestRejected(
  userId: string,
  circleName: string
): Promise<void> {
  const userDetails = await getUserDetails(userId);
  if (!userDetails) return;

  let sent = false;

  // Try SMS first
  if (userDetails.smsNotificationsEnabled && userDetails.phone) {
    try {
      await sendJoinRequestRejectedSms(userDetails.phone, circleName);
      sent = true;
    } catch (error) {
      console.error(`Failed to send join request rejected SMS to ${userId}:`, error);
    }
  }

  // Try email if enabled, has email
  if (userDetails.emailNotificationsEnabled && userDetails.email) {
    try {
      await sendJoinRequestRejectedEmail(userDetails.email, userDetails.displayName, circleName, userId);
    } catch (error) {
      console.error(`Failed to send join request rejected email to ${userId}:`, error);
    }
  }
}

/**
 * Toggle SMS notifications for a user
 */
export async function toggleSmsNotifications(
  userId: string,
  enabled: boolean
): Promise<void> {
  await query(
    "UPDATE users SET sms_notifications_enabled = $1 WHERE id = $2",
    [enabled, userId]
  );
}

/**
 * Notify circle creator (admin) that a member defaulted and a penalty was recorded.
 */
export async function notifyAdminOfDefault(
  adminUserId: string,
  defaulterUserId: string,
  circleName: string,
  penaltyAmount: string
): Promise<void> {
  if (!(await canSendSms(adminUserId))) return;
  const phone = await getUserPhone(adminUserId);
  if (!phone) return;

  try {
    const message = `Ajosave: A member defaulted in "${circleName}". Penalty of ${penaltyAmount} USDC recorded.`;
    await sendSms(phone, message);
  } catch (error) {
    console.error(`Failed to notify admin ${adminUserId} about default:`, error);
  }
}

/**
 * Notify all circle members when the circle completes (all payouts done)
 */
export async function notifyCircleCompleted(
  memberUserIds: string[],
  circleName: string
): Promise<void> {
  const notifications = memberUserIds.map(async (userId) => {
    const userDetails = await getUserDetails(userId);
    if (!userDetails) return;

    let sent = false;

    // Try SMS first
    if (userDetails.smsNotificationsEnabled && userDetails.phone) {
      try {
        await sendPayoutProcessedSms(userDetails.phone, circleName, "0", "everyone — the circle is complete!");
        sent = true;
      } catch (error) {
        console.error(`Failed to send circle completed SMS to ${userId}:`, error);
      }
    }

    // Try email if enabled, has email
    if (userDetails.emailNotificationsEnabled && userDetails.email) {
      try {
        await sendCircleCompletedEmail(userDetails.email, userDetails.displayName, circleName, userId);
      } catch (error) {
        console.error(`Failed to send circle completed email to ${userId}:`, error);
      }
    }
  });

  await Promise.allSettled(notifications);
}

/**
 * Notify a member that their circle was cancelled.
 * If a refund was issued, include the amount; otherwise send a no-refund variant.
 */
export async function notifyCircleCancelled(
  userId: string,
  circleName: string,
  refundAmountUsdc: string | null
): Promise<void> {
  const userDetails = await getUserDetails(userId);
  if (!userDetails) return;

  let sent = false;

  // Try SMS first
  if (userDetails.smsNotificationsEnabled && userDetails.phone) {
    try {
      if (refundAmountUsdc) {
        await sendCircleCancelledSms(userDetails.phone, circleName, refundAmountUsdc);
      } else {
        await sendCircleCancelledNoRefundSms(userDetails.phone, circleName);
      }
      sent = true;
    } catch (error) {
      console.error(`Failed to send circle cancelled SMS to ${userId}:`, error);
    }
  }

  // Try email if enabled, has email
  if (userDetails.emailNotificationsEnabled && userDetails.email) {
    try {
      await sendCircleCancelledEmail(userDetails.email, userDetails.displayName, circleName, refundAmountUsdc, userId);
    } catch (error) {
      console.error(`Failed to send circle cancelled email to ${userId}:`, error);
    }
  }
}

/**
 * Notify all circle members when the circle is paused
 */
export async function notifyCirclePaused(
  memberUserIds: string[],
  circleName: string
): Promise<void> {
  const notifications = memberUserIds.map(async (userId) => {
    const userDetails = await getUserDetails(userId);
    if (!userDetails) return;

    let sent = false;

    // Try SMS first
    if (userDetails.smsNotificationsEnabled && userDetails.phone) {
      try {
        await sendCirclePausedSms(userDetails.phone, circleName);
        sent = true;
      } catch (error) {
        console.error(`Failed to send circle paused SMS to ${userId}:`, error);
      }
    }

    // Try email if enabled, has email
    if (userDetails.emailNotificationsEnabled && userDetails.email) {
      try {
        await sendCirclePausedEmail(userDetails.email, userDetails.displayName, circleName, userId);
      } catch (error) {
        console.error(`Failed to send circle paused email to ${userId}:`, error);
      }
    }
  });

  await Promise.allSettled(notifications);
}

/**
 * Notify all circle members when the circle is resumed
 */
export async function notifyCircleResumed(
  memberUserIds: string[],
  circleName: string
): Promise<void> {
  const notifications = memberUserIds.map(async (userId) => {
    const userDetails = await getUserDetails(userId);
    if (!userDetails) return;

    let sent = false;

    // Try SMS first
    if (userDetails.smsNotificationsEnabled && userDetails.phone) {
      try {
        await sendCircleResumedSms(userDetails.phone, circleName);
        sent = true;
      } catch (error) {
        console.error(`Failed to send circle resumed SMS to ${userId}:`, error);
      }
    }

    // Try email if enabled, has email
    if (userDetails.emailNotificationsEnabled && userDetails.email) {
      try {
        await sendCircleResumedEmail(userDetails.email, userDetails.displayName, circleName, userId);
      } catch (error) {
        console.error(`Failed to send circle resumed email to ${userId}:`, error);
      }
    }
  });

  await Promise.allSettled(notifications);
}

/**
 * Notify a circle creator that one of their invite links was redeemed.
 * Invite links are single-use, so this confirms the invite has been consumed.
 * Notification failures are logged and never thrown.
 */
export async function notifyInviteRedeemed(
  issuerId: string,
  circleName: string,
  _redeemerId: string
): Promise<void> {
  const userDetails = await getUserDetails(issuerId);
  if (!userDetails) return;

  if (userDetails.emailNotificationsEnabled && userDetails.email) {
    try {
      await sendInviteRedeemedEmail(
        userDetails.email,
        userDetails.displayName,
        circleName,
        issuerId
      );
    } catch (error) {
      console.error(`Failed to send invite redeemed email to ${issuerId}:`, error);
    }
  }
}

/**
 * Notify a user that a spot has opened in a circle's waitlist
 */
export async function notifyWaitlistSpotOpened(
  userId: string,
  circleName: string
): Promise<void> {
  if (!(await canSendSms(userId))) return;
  const phone = await getUserPhone(userId);
  if (!phone) return;
  try {
    await sendWaitlistSpotOpenedSms(phone, circleName);
  } catch (error) {
    console.error(`Failed to send waitlist notification to ${userId}:`, error);
  }
}
