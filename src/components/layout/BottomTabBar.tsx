"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./BottomTabBar.module.css";

// ─── SVG icons (inline — no extra dependency) ────────────────────────────────

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function CirclesIcon({ active }: { active: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function ExploreIcon({ active }: { active: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  {
    href: "/dashboard",
    label: "Home",
    Icon: HomeIcon,
    matchPaths: ["/dashboard"],
  },
  {
    href: "/dashboard/circles",
    label: "My Circles",
    Icon: CirclesIcon,
    matchPaths: ["/dashboard/circles"],
  },
  {
    href: "/circles",
    label: "Explore",
    Icon: ExploreIcon,
    matchPaths: ["/circles"],
  },
  {
    href: "/profile",
    label: "Profile",
    Icon: ProfileIcon,
    matchPaths: ["/profile"],
  },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav
      className={styles.tabBar}
      aria-label="Mobile bottom navigation"
    >
      {TABS.map(({ href, label, Icon, matchPaths }) => {
        const active = matchPaths.some((p) => pathname === p || pathname.startsWith(p + "/"));
        return (
          <Link
            key={href}
            href={href}
            className={`${styles.tab} ${active ? styles.tabActive : ""}`}
            aria-label={label}
            aria-current={active ? "page" : undefined}
          >
            <span className={styles.tabIcon}>
              <Icon active={active} />
            </span>
            <span className={styles.tabLabel}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
