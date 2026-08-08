import type { Metadata } from "next";
import { Board } from "@/features/board-shell/board-shell-server";

export const metadata: Metadata = {
  title: "Signal Board — Wellington emergency signals",
  description:
    "Public-information signals for Wellington, graded for reliability. Not verified fact.",
};

/**
 * The picture is live: every render must reflect what has been ingested in the
 * last few seconds, so nothing about this route may be cached or prerendered.
 */
export const dynamic = "force-dynamic";

export default function BoardPage() {
  return <Board />;
}
