"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildLocaleCookie } from "@/lib/cookies";

const LOCALES = [
  { code: "en", label: "English" },
  { code: "yo", label: "Yorùbá" },
  { code: "ig", label: "Igbo" },
  { code: "ha", label: "Hausa" },
];

export function LanguageSelector({ currentLocale }: { currentLocale: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const locale = e.target.value;
    document.cookie = buildLocaleCookie(locale, window.location.protocol === "https:");
    startTransition(() => router.refresh());
  }

  return (
    <select
      value={currentLocale}
      onChange={handleChange}
      disabled={isPending}
      aria-label="Select language"
      style={{ fontSize: "0.875rem", padding: "2px 4px", borderRadius: "4px" }}
    >
      {LOCALES.map(({ code, label }) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </select>
  );
}
