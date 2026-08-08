import { z } from "zod";
import { GradeSchema } from "@/db/vocabulary";

/**
 * The scored-signal shape — the PRD's published vocabulary, and the ONE place it
 * is defined. `signals.geojson` puts it in `properties`; `signals.detail`
 * spreads it at the top level; `signals.alerts` embeds the grade half of it.
 * A cluster must not be able to describe itself differently in three places.
 *
 * Note what is NOT here (convergence Decision 3): there is no `score`, no
 * `confidence`, no percentage. `groups.score` exists internally to rank a queue
 * and is stripped from every response on this path. A single blended number is
 * false precision, and the whole point of the Admiralty grade is that "who said
 * it" and "how well corroborated is it" are two questions with two answers.
 */
export const ScoredSignalSchema = z.object({
  /** The cluster id — the PRD's "signal". Internally a level-1 group. */
  signalId: z.uuid(),
  datasetId: z.string(),
  /** Null until the cluster has been graded once. */
  grade: GradeSchema.nullable(),
  /** Ordered, most decisive first. Never empty once graded. */
  reasons: z.array(z.string()),
  /**
   * Distinct ORIGINS behind the cluster — never the item count. Three reposts
   * of one photograph are one origin, and showing "3 sources" for them would be
   * the single most misleading number this system could print.
   */
  independentSources: z.number().int(),
  /** Contributing items. Always shown beside independentSources, never instead. */
  itemCount: z.number().int(),
  /** Computed independently of the grade — an early weak signal still alerts. */
  alertWorthy: z.boolean(),
  /** True when ANY contributing item was authored for a demo or drill (AC34.3). */
  syntheticContributor: z.boolean(),
  /** A short name for the cluster, or null until the pipeline names it. */
  label: z.string().nullable(),
  /** "stated" when an item carried coordinates; "inferred" when we averaged. */
  locationCertainty: z.enum(["stated", "inferred", "unknown"]),
  /** Distinct source_class values behind the cluster — the diversity axis. */
  sourceClasses: z.array(z.string()),
  /** The cluster's lifespan on the occurred_at clock. */
  firstSeen: z.date(),
  lastSeen: z.date(),
  /** Name of the human who confirmed it, or null. NEVER machine-set. */
  confirmedBy: z.string().nullable(),
});

export type ScoredSignal = z.infer<typeof ScoredSignalSchema>;
