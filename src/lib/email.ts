/**
 * Email notification service using Resend
 * Provides transactional emails for circle activities
 */

import { Resend } from "resend";
import { serverConfig } from "@/server/config";

const resend = new Resend(serverConfig.resend.apiKey);

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Helper to create unsubscribe link
 */
function getUnsubscribeLink(userId: string): string {
  return `${serverConfig.app.url}/settings?unsubscribe=${userId}`;
}

/**
 * Helper to create unsubscribe footer for HTML emails
 */
function getUnsubscribeFooterHtml(userId: string): string {
  const link = getUnsubscribeLink(userId);
  return `
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
      <p>You're receiving this email because you're a member of Ajosave.</p>
      <p><a href="${link}" style="color: #4F46E5;">Unsubscribe from email notifications</a></p>
    </div>
  `;
}

/**
 * Helper to create unsubscribe footer for plain text emails
 */
function getUnsubscribeFooterText(userId: string): string {
  const link = getUnsubscribeLink(userId);
  return `

---
You're receiving this email because you're a member of Ajosave.
Unsubscribe from email notifications: ${link}
`;
}

/**
 * Send a generic email
 */
export async function sendEmail(params: EmailParams): Promise<void> {
  try {
    await resend.emails.send({
      from: serverConfig.resend.fromEmail,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
  } catch (error) {
    console.error("[email] Failed to send email:", error);
    throw error;
  }
}

/**
 * Send welcome email when user joins the platform
 */
export async function sendWelcomeEmail(
  email: string,
  displayName: string,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .button { display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Ajosave!</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>Welcome to Ajosave, the trustless rotating savings platform powered by Stellar blockchain.</p>
            <p>With Ajosave, you can:</p>
            <ul>
              <li>Join or create savings circles with friends and community</li>
              <li>Make regular contributions in your preferred currency</li>
              <li>Receive payouts automatically through smart contracts</li>
              <li>Build your on-chain reputation</li>
            </ul>
            <a href="${serverConfig.app.url}/dashboard" class="button">Go to Dashboard</a>
            <p>If you have any questions, feel free to reach out to our support team.</p>
            <p>Happy saving!</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Welcome to Ajosave!
    
    Hi ${displayName},
    
    Welcome to Ajosave, the trustless rotating savings platform powered by Stellar blockchain.
    
    With Ajosave, you can:
    - Join or create savings circles with friends and community
    - Make regular contributions in your preferred currency
    - Receive payouts automatically through smart contracts
    - Build your on-chain reputation
    
    Visit your dashboard: ${serverConfig.app.url}/dashboard
    
    Happy saving!
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: "Welcome to Ajosave!",
    html,
    text,
  });
}

/**
 * Send email notification when user receives a payout
 */
export async function sendPayoutReceivedEmail(
  email: string,
  displayName: string,
  circleName: string,
  amount: string,
  currency: string,
  txHash: string,
  userId: string
): Promise<void> {
  const explorerUrl = `${serverConfig.stellar.horizonUrl.replace("api", "explorer")}/tx/${txHash}`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10B981; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .amount { font-size: 32px; font-weight: bold; color: #10B981; text-align: center; margin: 20px 0; }
          .button { display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Payout Received!</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>Great news! You've received your payout from the <strong>${circleName}</strong> circle.</p>
            <div class="amount">${amount} ${currency}</div>
            <p>The funds have been transferred to your Stellar wallet via USDC.</p>
            <a href="${explorerUrl}" class="button">View Transaction</a>
            <p><strong>Transaction Hash:</strong><br><code style="font-size: 12px; word-break: break-all;">${txHash}</code></p>
            <p>Continue contributing to build your reputation and unlock more opportunities!</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Payout Received!
    
    Hi ${displayName},
    
    Great news! You've received your payout from the ${circleName} circle.
    
    Amount: ${amount} ${currency}
    
    The funds have been transferred to your Stellar wallet via USDC.
    
    Transaction Hash: ${txHash}
    View on Explorer: ${explorerUrl}
    
    Continue contributing to build your reputation and unlock more opportunities!
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Payout Received: ${amount} ${currency}`,
    html,
    text,
  });
}

/**
 * Send OTP verification email
 */
export async function sendOtpEmail(
  email: string,
  displayName: string,
  otp: string,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .otp { font-size: 36px; font-weight: bold; text-align: center; margin: 20px 0; letter-spacing: 10px; color: #4F46E5; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Verify Your Email</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>Your verification code is:</p>
            <div class="otp">${otp}</div>
            <p>This code is valid for 10 minutes. Please do not share this code with anyone.</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Verify Your Email
    
    Hi ${displayName},
    
    Your verification code is: ${otp}
    
    This code is valid for 10 minutes. Please do not share this code with anyone.
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: "Your Ajosave Verification Code",
    html,
    text,
  });
}

/**
 * Send payout reminder email
 */
export async function sendPayoutReminderEmail(
  email: string,
  displayName: string,
  circleName: string,
  amount: string,
  hoursUntilPayout: number,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #3B82F6; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .amount { font-size: 24px; font-weight: bold; color: #3B82F6; text-align: center; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎁 Payout Coming Soon!</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>Great news! Your payout from the <strong>${circleName}</strong> circle will be processed in ${hoursUntilPayout} hours!</p>
            <div class="amount">${amount} USDC</div>
            <p>Make sure your Stellar wallet is ready to receive the funds!</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Payout Coming Soon!
    
    Hi ${displayName},
    
    Great news! Your payout from the ${circleName} circle will be processed in ${hoursUntilPayout} hours!
    
    Amount: ${amount} USDC
    
    Make sure your Stellar wallet is ready to receive the funds!
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Payout Reminder: ${amount} USDC from ${circleName}`,
    html,
    text,
  });
}

/**
 * Send contribution reminder email
 */
export async function sendContributionReminderEmail(
  email: string,
  displayName: string,
  circleName: string,
  amount: string,
  currency: string,
  dueDate: Date,
  userId: string
): Promise<void> {
  const formattedDate = dueDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #F59E0B; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .amount { font-size: 24px; font-weight: bold; color: #F59E0B; text-align: center; margin: 20px 0; }
          .button { display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⏰ Contribution Reminder</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>This is a friendly reminder that your contribution for the <strong>${circleName}</strong> circle is due soon.</p>
            <div class="amount">${amount} ${currency}</div>
            <p><strong>Due Date:</strong> ${formattedDate}</p>
            <p>Making your contribution on time helps maintain your reputation score and keeps the circle running smoothly for everyone.</p>
            <a href="${serverConfig.app.url}/circles" class="button">Make Contribution</a>
            <p>Thank you for being a reliable member!</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Contribution Reminder
    
    Hi ${displayName},
    
    This is a friendly reminder that your contribution for the ${circleName} circle is due soon.
    
    Amount: ${amount} ${currency}
    Due Date: ${formattedDate}
    
    Making your contribution on time helps maintain your reputation score and keeps the circle running smoothly for everyone.
    
    Make your contribution: ${serverConfig.app.url}/circles
    
    Thank you for being a reliable member!
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Reminder: ${amount} ${currency} contribution due for ${circleName}`,
    html,
    text,
  });
}

/**
 * Send email when a circle is completed
 */
export async function sendCircleCompletedEmail(
  email: string,
  displayName: string,
  circleName: string,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #8B5CF6; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .button { display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎊 Circle Completed!</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>Congratulations! The <strong>${circleName}</strong> circle has been successfully completed.</p>
            <p>All members have received their payouts, and your reputation has been updated based on your participation.</p>
            <p>Thank you for being a committed member. Your on-time contributions help build trust in the community.</p>
            <a href="${serverConfig.app.url}/circles" class="button">Join Another Circle</a>
            <p>Ready to start another savings journey?</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Circle Completed!
    
    Hi ${displayName},
    
    Congratulations! The ${circleName} circle has been successfully completed.
    
    All members have received their payouts, and your reputation has been updated based on your participation.
    
    Thank you for being a committed member. Your on-time contributions help build trust in the community.
    
    Join another circle: ${serverConfig.app.url}/circles
    
    Ready to start another savings journey?
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Circle Completed: ${circleName}`,
    html,
    text,
  });
}

/**
 * Send payout processed email to circle members
 */
export async function sendPayoutProcessedEmail(
  email: string,
  displayName: string,
  circleName: string,
  amount: string,
  recipientName: string,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10B981; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💸 Payout Processed</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>A payout of <strong>${amount} USDC</strong> has been processed for <strong>${recipientName}</strong> in the <strong>${circleName}</strong> circle.</p>
            <p>Check your circle dashboard for details.</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Payout Processed
    
    Hi ${displayName},
    
    A payout of ${amount} USDC has been processed for ${recipientName} in the ${circleName} circle.
    
    Check your circle dashboard for details.
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Payout Processed in ${circleName}`,
    html,
    text,
  });
}

/**
 * Send missed contribution email
 */
export async function sendMissedContributionEmail(
  email: string,
  displayName: string,
  circleName: string,
  amount: string,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #EF4444; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⚠️ Missed Contribution</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>You missed your contribution of <strong>${amount} USDC</strong> to the <strong>${circleName}</strong> circle.</p>
            <p>Your status is now "defaulted" and you cannot receive future payouts. Contact support if this is an error.</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Missed Contribution
    
    Hi ${displayName},
    
    You missed your contribution of ${amount} USDC to the ${circleName} circle.
    
    Your status is now "defaulted" and you cannot receive future payouts. Contact support if this is an error.
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Missed Contribution for ${circleName}`,
    html,
    text,
  });
}

/**
 * Send contribution received confirmation email
 */
export async function sendContributionReceivedEmail(
  email: string,
  displayName: string,
  circleName: string,
  amount: string,
  cycleNumber: number,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10B981; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Contribution Confirmed</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>Your contribution of <strong>${amount} USDC</strong> to <strong>${circleName}</strong> (Cycle ${cycleNumber}) has been confirmed.</p>
            <p>Thank you!</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Contribution Confirmed
    
    Hi ${displayName},
    
    Your contribution of ${amount} USDC to ${circleName} (Cycle ${cycleNumber}) has been confirmed.
    
    Thank you!
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Contribution Confirmed for ${circleName}`,
    html,
    text,
  });
}

/**
 * Send join request approved email
 */
export async function sendJoinRequestApprovedEmail(
  email: string,
  displayName: string,
  circleName: string,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10B981; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Join Request Approved</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>Your join request for <strong>${circleName}</strong> has been approved!</p>
            <p>You'll be notified when the circle starts.</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Join Request Approved
    
    Hi ${displayName},
    
    Your join request for ${circleName} has been approved!
    
    You'll be notified when the circle starts.
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Join Request Approved for ${circleName}`,
    html,
    text,
  });
}

/**
 * Notify an invite issuer that one of their invite links was redeemed.
 */
export async function sendInviteRedeemedEmail(
  email: string,
  displayName: string,
  circleName: string,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎟️ Invite Redeemed</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>One of your invite links to <strong>${circleName}</strong> has just been used to join the circle.</p>
            <p>Invite links are single-use, so this one is now closed.</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Invite Redeemed

    Hi ${displayName},

    One of your invite links to ${circleName} has just been used to join the circle.

    Invite links are single-use, so this one is now closed.

    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Your invite to ${circleName} was used`,
    html,
    text,
  });
}

/**
 * Send join request rejected email
 */
export async function sendJoinRequestRejectedEmail(
  email: string,
  displayName: string,
  circleName: string,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #6B7280; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>❌ Join Request Rejected</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>Your join request for <strong>${circleName}</strong> has been declined by the creator.</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Join Request Rejected
    
    Hi ${displayName},
    
    Your join request for ${circleName} has been declined by the creator.
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Join Request Rejected for ${circleName}`,
    html,
    text,
  });
}

/**
 * Send circle cancelled email
 */
export async function sendCircleCancelledEmail(
  email: string,
  displayName: string,
  circleName: string,
  refundAmountUsdc: string | null,
  userId: string
): Promise<void> {
  let html, text;

  if (refundAmountUsdc) {
    html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #EF4444; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9fafb; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>❌ Circle Cancelled</h1>
            </div>
            <div class="content">
              <p>Hi ${displayName},</p>
              <p>The circle <strong>${circleName}</strong> has been cancelled by the creator.</p>
              <p>A refund of <strong>${refundAmountUsdc} USDC</strong> has been sent to your Stellar wallet.</p>
              <p><strong>The Ajosave Team</strong></p>
            </div>
            ${getUnsubscribeFooterHtml(userId)}
          </div>
        </body>
      </html>
    `;

    text = `
      Circle Cancelled
      
      Hi ${displayName},
      
      The circle ${circleName} has been cancelled by the creator.
      
      A refund of ${refundAmountUsdc} USDC has been sent to your Stellar wallet.
      
      The Ajosave Team
      ${getUnsubscribeFooterText(userId)}
    `;
  } else {
    html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #EF4444; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9fafb; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>❌ Circle Cancelled</h1>
            </div>
            <div class="content">
              <p>Hi ${displayName},</p>
              <p>The circle <strong>${circleName}</strong> has been cancelled by the creator.</p>
              <p>You had no confirmed contributions, so no refund is needed.</p>
              <p><strong>The Ajosave Team</strong></p>
            </div>
            ${getUnsubscribeFooterHtml(userId)}
          </div>
        </body>
      </html>
    `;

    text = `
      Circle Cancelled
      
      Hi ${displayName},
      
      The circle ${circleName} has been cancelled by the creator.
      
      You had no confirmed contributions, so no refund is needed.
      
      The Ajosave Team
      ${getUnsubscribeFooterText(userId)}
    `;
  }

  await sendEmail({
    to: email,
    subject: `Circle Cancelled: ${circleName}`,
    html,
    text,
  });
}

/**
 * Send circle paused email
 */
export async function sendCirclePausedEmail(
  email: string,
  displayName: string,
  circleName: string,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #F59E0B; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⏸️ Circle Paused</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>The circle <strong>${circleName}</strong> has been paused by the creator.</p>
            <p>Future payouts are temporarily suspended. You'll be notified when it resumes.</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Circle Paused
    
    Hi ${displayName},
    
    The circle ${circleName} has been paused by the creator.
    
    Future payouts are temporarily suspended. You'll be notified when it resumes.
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Circle Paused: ${circleName}`,
    html,
    text,
  });
}

/**
 * Send circle resumed email
 */
export async function sendCircleResumedEmail(
  email: string,
  displayName: string,
  circleName: string,
  userId: string
): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10B981; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>▶️ Circle Resumed</h1>
          </div>
          <div class="content">
            <p>Hi ${displayName},</p>
            <p>The circle <strong>${circleName}</strong> has been resumed.</p>
            <p>Normal schedule and payouts have been restored.</p>
            <p><strong>The Ajosave Team</strong></p>
          </div>
          ${getUnsubscribeFooterHtml(userId)}
        </div>
      </body>
    </html>
  `;

  const text = `
    Circle Resumed
    
    Hi ${displayName},
    
    The circle ${circleName} has been resumed.
    
    Normal schedule and payouts have been restored.
    
    The Ajosave Team
    ${getUnsubscribeFooterText(userId)}
  `;

  await sendEmail({
    to: email,
    subject: `Circle Resumed: ${circleName}`,
    html,
    text,
  });
}
