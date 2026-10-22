import { clsx } from "clsx";
import type { CircleStatus } from "@/types";

const labels: Record<CircleStatus, string> = {
  open: "Open",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  paused: "Paused",
};

export function CircleStatusBadge({ status }: { status: CircleStatus }) {
  return <span className={clsx("badge", `badge--${status}`)}>{labels[status]}</span>;
}
