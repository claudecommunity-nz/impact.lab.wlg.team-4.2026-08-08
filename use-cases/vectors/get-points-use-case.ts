import { z } from "zod";
import { MEMBER_OF, PCA3 } from "@/db/vocabulary";
import { getEdgesForNodesUseCase } from "@/use-cases/edges/get-edges-for-nodes-use-case";
import { getSignalVectorsUseCase } from "@/use-cases/signal-vectors/get-signal-vectors-use-case";
import { getLatestOccurredAtUseCase } from "@/use-cases/signals/get-latest-occurred-at-use-case";
import { getSignalsInWindowUseCase } from "@/use-cases/signals/get-signals-in-window-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { resolveWindow } from "@/utilities/window";

/**
 * Every signal in the window as a point in the galaxy, with the bubble it
 * belongs to. The smallest possible read: the UX layer draws from this and
 * drills into `vectors.groupDetail` for anything else.
 *
 * Two nulls are legitimate here and must be rendered, not filtered:
 *   - `x/y/z` null — the projection basis is fitted once, on the first 20+
 *     embedded signals. Before that, and for a signal ingested since the last
 *     `vectors.process` run, there are honestly no coordinates. Assuming the
 *     origin would pile unplaced points on top of each other at the centre of
 *     the map, which reads as a real cluster and is a lie.
 *   - `groupId` null — ingested but not yet grouped. Same reasoning: a point
 *     with no bubble is a fact about the pipeline's progress.
 */

/** One screen of galaxy. Well past what a 3D view can usefully draw at once. */
export const POINTS_LIMIT = 2000;

export const PointSchema = z.object({
  signalId: z.uuid(),
  /** null until the basis exists and this signal has been projected through it. */
  x: z.number().nullable(),
  y: z.number().nullable(),
  z: z.number().nullable(),
  /** null = ingested but not yet placed in a bubble. */
  groupId: z.uuid().nullable(),
});

export type Point = z.infer<typeof PointSchema>;

export const getPointsUseCase = createUseCase(
  {
    id: "get-points",
    inputSchema: z.object({
      /** Absent = everything we hold. See utilities/window.ts for the anchor. */
      windowMins: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(POINTS_LIMIT).optional(),
      /** Absent = every namespace. A dataset-scoped board must always pass it. */
      datasetId: z.string().min(1).optional(),
    }),
    outputSchema: z.array(PointSchema),
  },
  async ({ success, error }, { windowMins, limit, datasetId, log }) => {
    const latest = await getLatestOccurredAtUseCase({ log });
    if (latest.error) return error(latest.error);

    const window = resolveWindow({ latestOccurredAt: latest.data, windowMins });

    const signals = await getSignalsInWindowUseCase({
      from: window.from,
      to: window.to,
      limit: limit ?? POINTS_LIMIT,
      datasetId,
      log,
    });
    if (signals.error) return error(signals.error);

    const signalIds = signals.data.map((s) => s.id);

    const vectors = await getSignalVectorsUseCase({ kind: PCA3, signalIds, log });
    if (vectors.error) return error(vectors.error);

    const edges = await getEdgesForNodesUseCase({ nodeIds: signalIds, log });
    if (edges.error) return error(edges.error);

    const coordinates = new Map(vectors.data.map((v) => [v.signalId, v]));
    // A signal belongs to at most one group — the unique index on (from_id)
    // where rel = 'member_of' makes that structural, not a convention.
    const membership = new Map(
      edges.data.filter((e) => e.rel === MEMBER_OF).map((e) => [e.fromId, e.toId]),
    );

    return success(
      signals.data.map((signal) => {
        const vec3 = coordinates.get(signal.id) ?? null;
        return {
          signalId: signal.id,
          x: vec3?.x ?? null,
          y: vec3?.y ?? null,
          z: vec3?.z ?? null,
          groupId: membership.get(signal.id) ?? null,
        };
      }),
    );
  },
);
