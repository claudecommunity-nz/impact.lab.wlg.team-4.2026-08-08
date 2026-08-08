import { z } from "zod";

/**
 * The contract with the trust API. That service is NOT yet defined, so this file
 * is the seam: we own the wire shape, and the remote implementation can be
 * swapped in by setting TRUST_API_URL without touching any calling code.
 *
 * Until it exists, `assess-trust-use-case.ts` falls back to a local, transparent
 * heuristic — so the pipeline runs end-to-end today and the demo never depends
 * on a service that might not ship.
 */

/** What we send. A trust service should not need our internal types to read it. */
export const TrustRequestSchema = z.object({
  signals: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      sourceKind: z.string(),
      text: z.string(),
      observedAt: z.string(),
      hazardType: z.string(),
      lng: z.number().nullable(),
      lat: z.number().nullable(),
      locationConfidence: z.number().nullable(),
      locationMethod: z.string(),
      url: z.string().nullable(),
    }),
  ),
});

/** Bands, not just a number — a score with no label invites false precision. */
export const TrustBandSchema = z.enum([
  /** Multiple independent source kinds agree. Still not "confirmed". */
  "corroborated",
  /** More than one signal, but same source kind or same author cluster. */
  "emerging",
  /** A lone unverified report. */
  "single-source",
  /** Too little to say anything. */
  "insufficient",
]);

export const TrustAssessmentSchema = z.object({
  signalId: z.string(),
  /** 0–1. Confidence that something real is happening — NOT proof that it is. */
  score: z.number().min(0).max(1),
  band: TrustBandSchema,
  /** How many distinct source kinds describe the same event. */
  independentSourceCount: z.number().int().min(0),
  /** Ids of signals that appear to describe the same event. */
  corroboratingSignalIds: z.array(z.string()),
  /** Plain-language reasons. Shown to the user — the score is never bare. */
  reasons: z.array(z.string()),
  /** Which implementation produced this, so the UI can say so. */
  assessedBy: z.enum(["trust-api", "local-fallback"]),
});

export const TrustResponseSchema = z.object({
  assessments: z.array(TrustAssessmentSchema),
});

export type TrustRequest = z.infer<typeof TrustRequestSchema>;
export type TrustAssessment = z.infer<typeof TrustAssessmentSchema>;
export type TrustResponse = z.infer<typeof TrustResponseSchema>;
