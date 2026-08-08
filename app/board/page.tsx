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

/**
 * The dataset is a URL parameter rather than a toggle with hidden state, so a
 * board showing fabricated demo data always says so in its address bar. `live`
 * is the default because that is the operational picture; the demo fixture
 * lives in `demo` (see data/demo/demo-items.json).
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ dataset?: string }>;
}) {
  const { dataset } = await searchParams;

  return <Board datasetId={dataset?.trim() || "live"} />;
}
