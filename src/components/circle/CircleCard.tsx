import Link from "next/link";
import type { Circle, Member } from "@/types";
import { CircleStatusBadge } from "@/components/ui/CircleStatusBadge";
import { format } from "date-fns";
import styles from "./CircleCard.module.css";

interface CircleCardProps {
  circle: Circle;
  members: Member[];
  showJoin?: boolean;
}

export function CircleCard({ circle, members, showJoin = false }: CircleCardProps) {
  const spotsLeft = circle.maxMembers - members.length;

  return (
    <article className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.name}>{circle.name}</h3>
        <CircleStatusBadge status={circle.status} />
      </div>

      <div className={styles.amount}>
        ₦{circle.contributionNgn.toLocaleString("en-NG")}
        <span className={styles.freq}>/ {circle.cycleFrequency}</span>
      </div>

      <div className={styles.meta}>
        <span>
          {members.length} / {circle.maxMembers} members
        </span>
        {circle.nextPayoutAt && (
          <span>Next payout: {format(new Date(circle.nextPayoutAt), "MMM d, yyyy")}</span>
        )}
      </div>

      <div className={styles.progress}>
        <div
          className={styles.progressBar}
          style={{ width: `${(members.length / circle.maxMembers) * 100}%` }}
          role="progressbar"
          aria-valuenow={members.length}
          aria-valuemin={0}
          aria-valuemax={circle.maxMembers}
        />
      </div>

      {showJoin && circle.status === "open" && spotsLeft > 0 && (
        <Link
          href={`/circles/${circle.id}/join`}
          className="btn btn--accent btn--sm btn--full"
          data-onboarding="join-circle"
        >
          Join Circle — {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left
        </Link>
      )}

      {!showJoin && (
        <Link href={`/circles/${circle.id}`} className="btn btn--secondary btn--sm btn--full">
          View Details
        </Link>
      )}
    </article>
  );
}
