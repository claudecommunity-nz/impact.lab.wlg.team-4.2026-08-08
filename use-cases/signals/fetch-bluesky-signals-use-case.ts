import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { SignalSchema, SourceKind, LocationMethod } from "./signal-schema";
import {
  classifyHazard,
  extractUrls,
  pseudonymiseAuthor,
  resolvePlaceFromText,
} from "./signal-enrichment";

/**
 * Thin INTEGRATION use case — one call to Bluesky's public search.
 *
 * Host note, learned the hard way: `public.api.bsky.app` returns 403 for
 * searchPosts, while `api.bsky.app` serves it unauthenticated. Both are
 * reachable, so the 403 looks like a network problem and isn't.
 *
 * Bluesky posts carry NO coordinates. Everything located here is inferred from
 * prose against the suburb gazetteer, which is why each signal is stamped with
 * an explicit limitation rather than being quietly pinned to a map.
 */
export const fetchBlueskySignalsUseCase = createUseCase(
  {
    id: "fetch-bluesky-signals",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().positive().max(100).optional(),
    }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success, error }, { query, limit, log }) => {
    const url = new URL("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit ?? 25));

    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return error({
        message: `Bluesky search failed (${response.status})`,
        query,
      });
    }

    const body = await response.json();
    const posts: unknown[] = Array.isArray(body?.posts) ? body.posts : [];
    const collectedAt = new Date();

    const signals = posts.flatMap((raw) => {
      const post = raw as {
        uri?: string;
        author?: { handle?: string };
        record?: { text?: string; createdAt?: string };
        embed?: {
          $type?: string;
          external?: { uri?: string };
          images?: Array<{ fullsize?: string }>;
        };
      };

      const text = post.record?.text?.trim();
      if (!text || !post.uri) return [];

      const embedType = post.embed?.$type ?? "";
      const mediaType = embedType.includes("images")
        ? ("photo" as const)
        : embedType.includes("video")
          ? ("video" as const)
          : embedType.includes("external")
            ? ("link" as const)
            : ("none" as const);

      const location = resolvePlaceFromText(text);
      const handle = post.author?.handle ?? null;
      // Bluesky URIs are at://did/collection/rkey — the rkey makes a shareable link.
      const rkey = post.uri.split("/").pop();

      return [
        {
          id: `bluesky:${post.uri}`,
          externalId: post.uri,
          source: "bluesky-search",
          sourceKind: SourceKind.Social,
          text,
          observedAt: new Date(post.record?.createdAt ?? collectedAt),
          collectedAt,
          location,
          locationText: location?.matchedPlace ?? null,
          hazardType: classifyHazard(text),
          mediaType,
          url:
            handle && rkey
              ? `https://bsky.app/profile/${handle}/post/${rkey}`
              : null,
          mediaUrl: post.embed?.images?.[0]?.fullsize ?? null,
          // A shared article is not a second independent witness.
          quotedUrls: [
            ...extractUrls(text),
            ...(post.embed?.external?.uri ? [post.embed.external.uri] : []),
          ],
          authorRef: pseudonymiseAuthor(handle),
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
      { query, returned: posts.length, kept: signals.length },
      "Bluesky signals collected",
    );
    return success(signals);
  },
);
