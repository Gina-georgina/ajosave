/**
 * Paystack Refund Service
 *
 * Initiates refunds via the Paystack Refund API for early-exit payouts.
 * Refund outcomes (success/failure) are logged to the audit log.
 *
 * Issue: #229
 */

import { query } from "@/lib/db";
import logger from "@/lib/logger";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_API_URL = "https://api.paystack.co";

interface PaystackRefundResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    transaction: string;
    amount: number;
    currency: string;
    status: string;
    customer: string;
    createdAt: string;
  };
}

/**
 * Initiate a refund via Paystack API.
 *
 * @param transactionReference - The original Paystack transaction reference
 * @param amountUsdc - Amount to refund in USDC (converted to kobo for Paystack)
 * @returns The refund result
 */
export async function initiatePaystackRefund(
  transactionReference: string,
  amountUsdc: number
): Promise<{ success: boolean; reference?: string; error?: string }> {
  if (!PAYSTACK_SECRET_KEY) {
    logger.warn("[paystack-refund] PAYSTACK_SECRET_KEY not configured");
    return { success: false, error: "Paystack not configured" };
  }

  // Convert USDC to kobo (Paystack uses smallest currency unit)
  // Assuming USDC is treated as NGN equivalent for Paystack
  const amountKobo = Math.round(amountUsdc * 100);

  try {
    const response = await fetch(`${PAYSTACK_API_URL}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction: transactionReference,
        amount: amountKobo,
      }),
    });

    const result: PaystackRefundResponse = await response.json();

    if (!response.ok || !result.status) {
      logger.error(
        { transactionReference, amountUsdc, error: result.message },
        "[paystack-refund] Refund failed"
      );
      return { success: false, error: result.message };
    }

    logger.info(
      { transactionReference, amountUsdc, refundId: result.data.id },
      "[paystack-refund] Refund initiated successfully"
    );

    return {
      success: true,
      reference: result.data.id.toString(),
    };
  } catch (err) {
    logger.error(
      { transactionReference, amountUsdc, error: err instanceof Error ? err.message : String(err) },
      "[paystack-refund] Refund exception"
    );
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Log refund outcome to the audit log.
 */
export async function logRefundOutcome(
  exitRequestId: string,
  success: boolean,
  reference?: string,
  error?: string
): Promise<void> {
  await query(
    `INSERT INTO audit_logs (action, entity_type, entity_id, details, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [
      success ? "early_exit.refund.success" : "early_exit.refund.failure",
      "early_exit_request",
      exitRequestId,
      JSON.stringify({ reference, error }),
    ]
  );
}
