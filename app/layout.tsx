import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { cn } from "@/lib/utils";

/**
 * Manrope for prose and headings, IBM Plex Mono for EVERY number on the screen.
 * The split is the point: counts, grades, timestamps and rates are data an
 * operator compares down a column, and proportional digits make that harder
 * than it needs to be.
 */
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "claude-impact-wellington-t4",
  description: "Wellington Impact Lab — team 4",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full antialiased font-sans", manrope.variable, plexMono.variable)}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          {/*
            One look, deliberately. There is no theme switch and no system
            preference: the warm-paper palette IS the product's appearance, and
            a second variant is a second set of colour decisions to keep true
            for no benefit an operator asked for.
          */}
          <div className="flex flex-1 flex-col">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
