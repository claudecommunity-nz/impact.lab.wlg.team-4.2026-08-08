import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const geistHeading = Geist({subsets:['latin'],variable:'--font-heading'});

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", geist.variable, geistHeading.variable)}
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
