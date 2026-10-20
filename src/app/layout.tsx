import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";
import "@/styles/components.css";
import { Navbar } from "@/components/layout/Navbar";

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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {/* Skip navigation — WCAG 2.4.1: keyboard users can jump past the nav */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Navbar />
        <main id="main-content">{children}</main>
      </body>
    </html>
  );
}
