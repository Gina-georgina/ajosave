import { Suspense } from "react";
import type { Metadata } from "next";
import styles from "./page.module.css";
import FaqSearch from "./FaqSearch";
import type { FaqSection } from "./FaqSearch";

export const metadata: Metadata = {
  title: "FAQ - Ajosave",
  description:
    "Frequently asked questions about Ajosave, Ajo savings circles, and Stellar blockchain",
};

// ─── Static FAQ data ───────────────────────────────────────────────────────────
// Centralised here so it can be shared with server-side search or i18n later.

const FAQ_SECTIONS: FaqSection[] = [
  {
    id: "about",
    title: "About Ajo & Ajosave",
    items: [
      {
        id: "what-is-ajo",
        question: "What is Ajo?",
        answer:
          "Ajo (also called Esusu or Susu) is a traditional West African rotating savings system. A group of people contribute a fixed amount regularly, and one member receives the full pot each cycle until everyone has received their payout. It's a community-based way to save money and access lump sums without traditional banking.",
      },
      {
        id: "how-different",
        question: "How is Ajosave different from traditional Ajo?",
        answer:
          "Traditional Ajo relies entirely on trust — there's no guarantee members will pay or that the organizer won't disappear with the money. Ajosave uses blockchain smart contracts on Stellar to make the process trustless and automatic. Contributions are locked in the contract, payouts happen automatically, and no one can cheat the system.",
      },
      {
        id: "vs-bank",
        question: "Why should I use Ajosave instead of a bank savings account?",
        answer:
          "Ajosave offers several advantages: no minimum balance requirements, no monthly fees, automatic discipline through group commitment, and access to lump sums earlier in the cycle. Plus, your funds are held in USDC stablecoin, protecting you from currency devaluation.",
      },
    ],
  },
  {
    id: "payouts",
    title: "How Payouts Work",
    items: [
      {
        id: "payout-order",
        question: "How is the payout order determined?",
        answer:
          "When you join a circle, you're assigned a position number. The payout order is randomized when the circle starts (once all members have joined). Position 1 receives the first payout, position 2 receives the second, and so on. You can see your position on the circle details page.",
      },
      {
        id: "when-payout",
        question: "When do I receive my payout?",
        answer:
          "Payouts happen automatically at the end of each cycle based on the circle's frequency (weekly, bi-weekly, or monthly). You'll receive an SMS notification 24 hours before your payout is processed. The funds are sent directly to your Stellar wallet.",
      },
      {
        id: "missed-contribution",
        question: "What happens if someone misses a contribution?",
        answer:
          "If a member misses a contribution, they're marked as \"defaulted\" and cannot receive future payouts. The circle continues with remaining active members. Defaulted members are still responsible for their missed contributions and may face reputation score penalties.",
      },
      {
        id: "early-payout",
        question: "Can I receive my payout early?",
        answer:
          "No, the payout order is fixed when the circle starts and cannot be changed. This ensures fairness for all members. However, you can join multiple circles with different start dates to receive payouts at different times.",
      },
    ],
  },
  {
    id: "usdc-stellar",
    title: "About USDC & Stellar",
    items: [
      {
        id: "what-is-usdc",
        question: "What is USDC?",
        answer:
          "USDC (USD Coin) is a stablecoin — a cryptocurrency that's always worth $1 USD. It's backed by real US dollars held in reserve, so it doesn't fluctuate in value like Bitcoin or other cryptocurrencies. This makes it perfect for savings circles where you need predictable amounts.",
      },
      {
        id: "what-is-stellar",
        question: "What is Stellar?",
        answer:
          "Stellar is a blockchain network designed for fast, low-cost payments. Transactions cost fractions of a cent and settle in 3-5 seconds. Ajosave uses Stellar because it's perfect for financial applications — reliable, affordable, and built for moving money globally.",
      },
      {
        id: "no-blockchain-needed",
        question: "Do I need to understand blockchain to use Ajosave?",
        answer:
          "No! We handle all the blockchain complexity behind the scenes. You just need a phone number to sign up and a Stellar wallet to receive payouts. Think of it like using a banking app — you don't need to understand how banks work internally.",
      },
      {
        id: "ngn-to-usdc",
        question: "Why do I contribute in Naira but receive USDC?",
        answer:
          "You pay in Naira (₦) via Paystack for convenience, and we automatically convert it to USDC at the current exchange rate. This protects your savings from Naira devaluation during the circle duration. When you receive your payout in USDC, you can convert it back to Naira or keep it as dollars.",
      },
    ],
  },
  {
    id: "security",
    title: "Security & Trust",
    items: [
      {
        id: "is-safe",
        question: "Is my money safe?",
        answer:
          "Yes. Your contributions are held in a Soroban smart contract on the Stellar blockchain — not in a bank account controlled by Ajosave or any person. The contract code is public and auditable. Once funds are in the contract, they can only be released according to the programmed rules (automatic payouts to members in order).",
      },
      {
        id: "can-steal",
        question: "Can Ajosave steal my money?",
        answer:
          "No. Ajosave doesn't have access to funds once they're in the smart contract. We can't withdraw, freeze, or redirect your money. The contract is immutable — even we can't change how it works after deployment.",
      },
      {
        id: "reputation-score",
        question: "What is a reputation score?",
        answer:
          "Your reputation score (0-100) is built from your contribution history across all circles. On-time payments increase your score, while missed contributions decrease it. A higher score makes you more trustworthy to other members and may unlock benefits like priority positions in future circles.",
      },
    ],
  },
  {
    id: "getting-started",
    title: "Getting Started",
    items: [
      {
        id: "how-to-join",
        question: "How do I join a circle?",
        answer:
          "1. Sign up with your phone number. 2. Browse available circles on the Circles page. 3. Click \"Join Circle\" on one that fits your budget and timeline. 4. Set up your Stellar wallet (we'll guide you). 5. Wait for the circle to fill up and start. 6. Make your first contribution when prompted.",
      },
      {
        id: "create-circle",
        question: "Can I create my own circle?",
        answer:
          "Yes! Click \"Create Circle\" from the dashboard. You'll set the contribution amount, number of members, and cycle frequency. You can make it public (anyone can join) or private (you approve each member). As the creator, you're also a member and will receive a payout in the rotation.",
      },
      {
        id: "more-questions",
        question: "What if I have more questions?",
        answer:
          "Check out our Help Center for detailed guides, or contact us at support@ajosave.app. We're here to help!",
      },
    ],
  },
];

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function FaqPage() {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Frequently Asked Questions</h1>
        <p className={styles.subtitle}>
          Everything you need to know about Ajosave and how it works
        </p>

        {/*
          Wrap FaqSearch in Suspense because it calls useSearchParams()
          which requires a Suspense boundary in Next.js App Router.
        */}
        <Suspense fallback={<p>Loading FAQ…</p>}>
          <FaqSearch sections={FAQ_SECTIONS} />
        </Suspense>
      </div>
    </div>
  );
}
