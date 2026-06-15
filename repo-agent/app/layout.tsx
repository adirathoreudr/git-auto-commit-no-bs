import type { Metadata } from "next";
import { Share_Tech_Mono, VT323, Press_Start_2P } from "next/font/google";
import "./globals.css";

const shareTechMono = Share_Tech_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: "400",
});

const vt323 = VT323({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const pressStart2P = Press_Start_2P({
  variable: "--font-pixel",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "REPO_AGENT // AUTONOMOUS REFACTOR SYS",
  description: "Autonomous GitHub refactoring agent. DeepSeek-powered. Git-native. Vercel-hosted.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${shareTechMono.variable} ${vt323.variable} ${pressStart2P.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
