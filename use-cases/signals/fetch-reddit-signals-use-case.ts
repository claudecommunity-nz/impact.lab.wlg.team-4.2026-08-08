import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { SignalSchema, SourceKind } from "./signal-schema";
import {
  classifyHazard,
  extractUrls,
  pseudonymiseAuthor,
  resolvePlaceFromText,
} from "./signal-enrichment";

/**
 * Thin INTEGRATION use case — one call to a subreddit's public RSS feed.
 *
 * Access note: reddit.com/*.json returns 403 to server-side callers, but the
 * .rss endpoints serve fine with a browser User-Agent. RSS also avoids the
 * OAuth app registration entirely, which matters when the whole build is a day.
 *
 * Reddit posts have no coordinates; locations are inferred from prose and
 * flagged as such.
 */
export const fetchRedditSignalsUseCase = createUseCase(
  {
    id: "fetch-reddit-signals",
    inputSchema: z.object({
      subreddit: z.string().min(1).optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success, error }, { subreddit, limit, log }) => {
    const sub = subreddit ?? "Wellington";
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.rss?limit=${limit ?? 25}`;

    const response = await fetch(url, {
      headers: {
        accept: "application/atom+xml,application/xml,text/xml",
        // Reddit rejects generic/absent agents with 403.
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return error({
        message: `Reddit feed failed (${response.status})`,
        subreddit: sub,
      });
    }

    const xml = await response.text();
    const collectedAt = new Date();

    const entries = xml.split("<entry>").slice(1);

    const signals = entries.flatMap((entry) => {
      const pick = (tag: string) => {
        const match = entry.match(
          new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`),
        );
        return match ? decodeXml(match[1].trim()) : null;
      };

      const title = pick("title");
      const id = pick("id");
      if (!title || !id) return [];

      const linkMatch = entry.match(/<link[^>]*href="([^"]+)"/);
      const link = linkMatch ? decodeXml(linkMatch[1]) : null;
      const author =
        entry.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? null;
      const content = pick("content") ?? "";
      // Strip the HTML wrapper Reddit puts around post bodies.
      const body = content
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const text =
        body && !body.startsWith("submitted by") ? `${title} — ${body}` : title;
      const searchable = `${title} ${body}`;
      const location = resolvePlaceFromText(searchable);

      const hasImage = /\.(jpg|jpeg|png|gif|webp)\b/i.test(content);
      const hasVideo = /(v\.redd\.it|youtube\.com|youtu\.be|\.mp4\b)/i.test(
        content,
      );

      return [
        {
          id: `reddit:${id}`,
          externalId: id,
          source: `reddit-r-${sub.toLowerCase()}`,
          sourceKind: SourceKind.Social,
          text: text.slice(0, 2000),
          // The poster's own words (title and body).
          textGenerated: false,
          observedAt: new Date(
            pick("updated") ?? pick("published") ?? collectedAt,
          ),
          collectedAt,
          location,
          locationText: location?.matchedPlace ?? null,
          hazardType: classifyHazard(searchable),
          mediaType: hasVideo
            ? ("video" as const)
            : hasImage
              ? ("photo" as const)
              : link
                ? ("link" as const)
                : ("none" as const),
          url: link,
          mediaUrl: null,
          quotedUrls: extractUrls(content).filter(
            (u) => !u.includes("reddit.com"),
          ),
          authorRef: pseudonymiseAuthor(author),
          limitations: [
            "Unverified public social media post — a signal to investigate, not confirmed fact.",
            ...(location
              ? [
                  `Location inferred from the words "${location.matchedPlace}" in the post text, not from GPS. Approximate suburb centroid.`,
                ]
              : ["No location could be determined from this post."]),
          ],
        },
      ];
    });

    log?.info(
      { subreddit: sub, kept: signals.length },
      "Reddit signals collected",
    );
    return success(signals);
  },
);

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
