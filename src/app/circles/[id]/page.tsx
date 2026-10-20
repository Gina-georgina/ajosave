import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCircleById, getMembersByCircle } from "@/server/services/circle.service";
import { getPayoutHistoryByCircle } from "@/server/services/payout.service";
import { getContributionsByCircle } from "@/server/services/contribution.service";
import { CircleStatusBadge } from "@/components/ui/CircleStatusBadge";
import { CopyButton } from "@/components/ui/CopyButton";
import { MemberPayoutList } from "@/components/circle/MemberPayoutList";
import { CircleActions } from "@/components/circle/CircleActions";
import { PayoutCountdown } from "@/components/circle/PayoutCountdown";
import { PayoutHistory } from "@/components/circle/PayoutHistory";
import { ContributionHistory } from "@/components/circle/ContributionHistory";
import { CircleAdminTab } from "@/components/circle/CircleAdminTab";
import { getCurrencySymbol, SupportedCurrency } from "@/lib/currency";
import { format } from "date-fns";
import type { Metadata } from "next";
import { LazyCircleChat } from "@/components/circle/LazyCircleChat";
import { CircleWaitlist } from "@/components/circle/CircleWaitlist";
import { CircleCompletionScreen } from "@/components/circle/CircleCompletionScreen";
import { ContributeButton } from "@/components/circle/ContributeButton";
import { DisputeForm } from "@/components/circle/DisputeForm";
import { EarlyExitButton } from "@/components/circle/EarlyExitButton";
import styles from "./page.module.css";

interface Props {
  params: { id: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const circle = await getCircleById(params.id);
  if (!circle) return { title: "Circle Not Found" };

  const symbol = getCurrencySymbol(circle.contributionCurrency as SupportedCurrency);
  const title = `${circle.name} | Ajosave`;
  const description = `Join ${circle.name} — a savings circle with ${symbol}${circle.contributionFiat.toLocaleString()} contributions every ${circle.cycleFrequency}. Powered by Stellar.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://www.ajosave.app/circles/${params.id}`,
      siteName: "Ajosave",
      type: "website",
      images: [{ url: "/og-default.svg", width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-default.svg"],
    },
  };
}

// CircleDetailPage
export default async function CircleDetailPage({ params }: Props) {
  const [circle, members, session, payoutHistory, contributions] = await Promise.all([
    getCircleById(params.id),
    getMembersByCircle(params.id),
    getServerSession(authOptions),
    getPayoutHistoryByCircle(params.id),
    getContributionsByCircle(params.id),
  ]);

  if (!circle) notFound();

  const userId = (session?.user as { id?: string } | undefined)?.id;
  const userRole = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = userRole === "admin";
  const isCreator = userId === circle.creatorId;
  const isMember = members.some((m) => m.userId === userId);
  const isActiveMember = members.some((m) => m.userId === userId && m.status === "active");
  const currencySymbol = getCurrencySymbol(circle.contributionCurrency as SupportedCurrency);

  // Load waitlist status for this user
  let isOnWaitlist = false;
  let waitlistPosition: number | null = null;
  if (userId) {
    const { getWaitlistStatus } = await import("@/server/services/waitlist.service");
    const status = await getWaitlistStatus(circle.id, userId);
    isOnWaitlist = status.isOnWaitlist;
    waitlistPosition = status.position;
  }

  if (circle.status === "completed") {
    return (
      <div className={styles.page}>
        <div className="container">
          <CircleCompletionScreen circle={circle} members={members} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{circle.name}</h1>
            <CircleStatusBadge status={circle.status} />
          </div>
          {userId && (
            <CircleActions
              circleId={circle.id}
              isCreator={isCreator}
              isMember={isMember}
              status={circle.status}
            />
          )}
        </div>

        {isActiveMember && circle.status === "active" && (
          <div style={{ marginBottom: "var(--space-6)" }}>
            <ContributeButton
              circleId={circle.id}
              circleName={circle.name}
              amountNgn={circle.contributionFiat}
              cycleFrequency={circle.cycleFrequency}
              currentCycle={circle.currentCycle}
            />
          </div>
        )}

        {/* Show waitlist card when circle is full and the user is not already a member */}
        {userId && !isMember && members.length >= circle.maxMembers && (
          <div style={{ marginBottom: "var(--space-6)" }}>
            <CircleWaitlist
              circleId={circle.id}
              circleName={circle.name}
              initialIsOnWaitlist={isOnWaitlist}
              initialPosition={waitlistPosition}
            />
          </div>
        )}

        <div className={styles.grid}>
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h2 className={styles.sectionTitle}>Payout History</h2>
            <PayoutHistory circleId={circle.id} initialPayouts={payoutHistory} />
          </div>

          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h2 className={styles.sectionTitle}>Contribution History</h2>
            <ContributionHistory circleId={circle.id} initialData={contributions} />
          </div>

          <div className="card">
            <h2 className={styles.sectionTitle}>Circle Details</h2>
            
            {circle.nextPayoutAt && circle.status === "active" && (
              <div style={{ marginBottom: "var(--space-6)" }}>
                <PayoutCountdown nextPayoutAt={circle.nextPayoutAt} />
              </div>
            )}

            <dl className={styles.details}>
              <div className={styles.detailRow}>
                <dt>Contribution</dt>
                <dd>
                  {currencySymbol}
                  {circle.contributionFiat.toLocaleString()} / {circle.cycleFrequency}
                </dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Members</dt>
                <dd>
                  {members.length} / {circle.maxMembers}
                </dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Current Cycle</dt>
                <dd>{circle.currentCycle > 0 ? `Cycle ${circle.currentCycle}` : "Not started"}</dd>
              </div>
              {circle.nextPayoutAt && (
                <div className={styles.detailRow}>
                  <dt>Next Payout</dt>
                  <dd>{format(new Date(circle.nextPayoutAt), "MMM d, yyyy")}</dd>
                </div>
              )}
              {isCreator && (
                <div className={styles.detailRow}>
                  <dt>Invite Link</dt>
                  <dd className={styles.inviteLinkCell}>
                    <span className={styles.inviteLinkText}>
                      {`${process.env.NEXT_PUBLIC_APP_URL}/circles/${circle.id}/join`}
                    </span>
                    <CopyButton
                      text={`${process.env.NEXT_PUBLIC_APP_URL}/circles/${circle.id}/join`}
                      label="Copy invite link"
                    />
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <MemberPayoutList circle={circle} initialMembers={members} isCreator={isCreator} currentUserId={userId} />
        </div>

        {isAdmin && (
          <div className="card" style={{ marginTop: "var(--space-6)" }}>
            <h2 className={styles.sectionTitle}>Admin: Circle Management</h2>
            <CircleAdminTab circle={circle} />
          </div>
        )}

        {userId && (
          <LazyCircleChat circleId={circle.id} isActiveMember={isActiveMember} currentUserId={userId} />
        )}

        {isActiveMember && circle.status === "active" && (
          <div className="card" style={{ marginTop: "var(--space-6)" }}>
            <h2 className={styles.sectionTitle}>Raise a Dispute</h2>
            <DisputeForm
              circleId={circle.id}
              memberId={members.find((m) => m.userId === userId)?.id ?? ""}
            />
          </div>
        )}

        {isActiveMember && circle.status === "active" && circle.creatorId !== userId && (
          <div className="card" style={{ marginTop: "var(--space-6)" }}>
            <h2 className={styles.sectionTitle}>Early Exit</h2>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "var(--space-4)" }}>
              You may request to exit this circle early. A penalty will be applied to your contributions.
            </p>
            <EarlyExitButton circleId={circle.id} />
          </div>
        )}
      </div>
    </div>
  );
}
