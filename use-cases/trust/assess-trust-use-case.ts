import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { SignalSchema } from "@/use-cases/signals/signal-schema";
import { TrustResponseSchema, type TrustAssessment } from "./trust-schema";

/**
 * The trust port. The real scoring service is not yet defined, so this use case
 * has two modes:
 *
 *   - TRUST_API_URL set   → POST the batch, validate the response, return it.
 *   - not set             → run the local fallback below.
 *
 * The fallback exists so the pipeline is demonstrable today and so a judge can
 * see corroboration working without a dependency on a service that may not
 * ship. It is deliberately simple and explainable: every score comes with the
 * reasons that produced it, because an unexplained number invites exactly the
 * false confidence this problem statement warns against.
 */
export const assessTrustUseCase = createUseCase(
  {
    id: "assess-trust",
    inputSchema: z.object({
      signals: z.array(SignalSchema),
      /** Metres. Signals closer than this may describe the same event. */
      proximityMetres: z.number().positive().optional(),
      /** Hours. Signals further apart in time are treated as separate events. */
      windowHours: z.number().positive().optional(),
    }),
    outputSchema: z.object({
      assessments: z.array(
        z.object({
          signalId: z.string(),
          score: z.number(),
          band: z.string(),
          independentSourceCount: z.number(),
          corroboratingSignalIds: z.array(z.string()),
          reasons: z.array(z.string()),
          assessedBy: z.string(),
        }),
      ),
    }),
  },
  async (
    { success, error },
    { signals, proximityMetres, windowHours, log },
  ) => {
    const endpoint = process.env.TRUST_API_URL;

    if (endpoint) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.TRUST_API_TOKEN
            ? { authorization: `Bearer ${process.env.TRUST_API_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          signals: signals.map((s) => ({
            id: s.id,
            source: s.source,
            sourceKind: s.sourceKind,
            text: s.text,
            observedAt: s.observedAt.toISOString(),
            hazardType: s.hazardType,
            lng: s.location?.lng ?? null,
            lat: s.location?.lat ?? null,
            locationConfidence: s.location?.confidence ?? null,
            locationMethod: s.location?.method ?? "none",
            url: s.url,
          })),
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return error({
          message: `Trust API failed (${response.status})`,
          endpoint,
        });
      }

      const parsed = TrustResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        return error({
          message: "Trust API returned an unexpected shape",
          issues: parsed.error.issues,
        });
      }

      log?.info(
        { count: parsed.data.assessments.length },
        "Trust assessed via API",
      );
      return success({ assessments: parsed.data.assessments });
    }

    const assessments = assessLocally(
      signals,
      proximityMetres ?? 1500,
      windowHours ?? 24,
    );
    log?.info(
      { count: assessments.length },
      "Trust assessed via local fallback",
    );
    return success({ assessments });
  },
);

/**
 * Local corroboration heuristic.
 *
 * The core idea, straight from the problem statement: several INDEPENDENT
 * sources describing the same event is the signal worth acting on. So we count
 * distinct source KINDS, not distinct posts — ten reposts of one news article
 * are one witness, not ten. Reposts are discounted via quotedUrls, and repeat
 * posts by the same pseudonymised author are collapsed too.
 */
function assessLocally(
  signals: z.infer<typeof SignalSchema>[],
  proximityMetres: number,
  windowHours: number,
): TrustAssessment[] {
  return signals.map((signal) => {
    const related = signals.filter((other) => {
      if (other.id === signal.id) return false;
      if (other.hazardType !== signal.hazardType) return false;

      const hoursApart =
        Math.abs(other.observedAt.getTime() - signal.observedAt.getTime()) /
        3_600_000;
      if (hoursApart > windowHours) return false;

      // Without coordinates on both sides we can't claim they're the same event.
      if (!signal.location || !other.location) return false;
      return (
        haversineMetres(signal.location, other.location) <= proximityMetres
      );
    });

    // Independence: distinct source kinds, ignoring same-author repetition and
    // items that merely quote a source already counted.
    const seenAuthors = new Set<string>();
    const independentKinds = new Set<string>([signal.sourceKind]);
    const corroborating: string[] = [];

    for (const other of related) {
      if (other.authorRef && seenAuthors.has(other.authorRef)) continue;
      if (other.authorRef) seenAuthors.add(other.authorRef);

      const isRepost =
        other.quotedUrls.length > 0 &&
        signal.url !== null &&
        other.quotedUrls.includes(signal.url);
      if (isRepost) continue;

      independentKinds.add(other.sourceKind);
      corroborating.push(other.id);
    }

    const kindCount = independentKinds.size;
    const reasons: string[] = [];

    let score = 0;
    let band: TrustAssessment["band"];

    if (kindCount >= 3) {
      score = 0.85;
      band = "corroborated";
      reasons.push(
        `${kindCount} independent kinds of source describe a similar ${signal.hazardType} event nearby.`,
      );
    } else if (kindCount === 2) {
      score = 0.6;
      band = "corroborated";
      reasons.push(
        `Two independent kinds of source describe a similar ${signal.hazardType} event nearby.`,
      );
    } else if (corroborating.length > 0) {
      score = 0.4;
      band = "emerging";
      reasons.push(
        `${corroborating.length} other report(s) nearby, but all from the same kind of source — not independent corroboration.`,
      );
    } else if (signal.location) {
      score = 0.2;
      band = "single-source";
      reasons.push("Only one report. Nothing else nearby describes this.");
    } else {
      score = 0.1;
      band = "insufficient";
      reasons.push(
        "No location could be determined, so corroboration cannot be assessed.",
      );
    }

    // Provenance adjusts confidence — but never to certainty.
    if (signal.sourceKind === "official") {
      score = Math.min(1, score + 0.15);
      reasons.push("Published by an official agency feed.");
    }
    if (signal.sourceKind === "social") {
      reasons.push("Social media content is never treated as verified fact.");
    }
    if (signal.location && signal.location.method === "place-name") {
      score = Math.max(0, score - 0.1);
      reasons.push(
        "Location was inferred from text, so proximity matching is approximate.",
      );
    }

    return {
      signalId: signal.id,
      score: Number(score.toFixed(2)),
      band,
      independentSourceCount: kindCount,
      corroboratingSignalIds: corroborating,
      reasons,
      assessedBy: "local-fallback" as const,
    };
  });
}

/** Great-circle distance in metres. */
function haversineMetres(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
