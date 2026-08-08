import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ThemeToggle } from "@/components/theme-toggle";
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
            Inside Providers because it reads next-themes; app chrome, so every
            route gets it.

            The bar reserves vertical space rather than floating over the page:
            a viewport-fixed control sits above page headers, which are centred
            containers, so below ~1440px it lands on top of whatever they put at
            their right edge. Clearing a strip is the only placement that holds
            at every width. Pointer events are off on the strip and back on for
            the toggle, so the empty space stays click-through.
          */}
          <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-end p-3">
            <div className="pointer-events-auto">
              <ThemeToggle />
            </div>
          </div>
          <div className="flex flex-1 flex-col pt-16">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
