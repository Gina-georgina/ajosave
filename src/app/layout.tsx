import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";
import "@/styles/components.css";
import { Navbar } from "@/components/layout/Navbar";
import { BottomTabBar } from "@/components/layout/BottomTabBar";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "STELLAR — On-Chain Rotating Savings on Stellar", template: "%s | STELLAR" },
  description:
    "Join or create trustless savings circles (Ajo/Esusu) powered by Stellar Soroban smart contracts and USDC.",
  keywords: ["ajo", "esusu", "savings", "stellar", "soroban", "usdc", "nigeria", "defi"],
  openGraph: {
    title: "STELLAR — On-Chain Rotating Savings",
    description: "Trustless Ajo/Esusu savings circles on Stellar.",
    url: "https://stellar.app",
    siteName: "STELLAR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "STELLAR",
    description: "Trustless rotating savings on Stellar.",
  },
  // Allow mobile browsers to resize the viewport when the software keyboard opens.
  // This is the primary mechanism that ensures the bottom tab bar slides out of view
  // when an input field has focus and the keyboard is visible.
  viewport: {
    width: "device-width",
    initialScale: 1,
    interactiveWidget: "resizes-visual",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {/* Top navbar — hidden on mobile (≤ 767 px) via CSS when bottom tab bar is present */}
        <Navbar />
        {/* Add bottom padding on mobile to prevent content from being hidden behind the tab bar */}
        <main style={{ paddingBottom: "var(--bottom-tab-bar-height, 0)" }}>
          {children}
        </main>
        {/* Fixed bottom tab bar — visible on mobile only */}
        <BottomTabBar />
      </body>
    </html>
  );
}
