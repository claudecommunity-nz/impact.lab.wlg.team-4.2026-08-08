import { z } from "zod";
import { MEMBER_OF, PCA3, VerificationSchema } from "@/db/vocabulary";
import { type Group } from "@/repositories/groups/group-schema";
import { type SignalVector } from "@/repositories/signal-vectors/signal-vector-schema";
import { type Signal } from "@/repositories/signals/signal-schema";
import { getEdgesForNodesUseCase } from "@/use-cases/edges/get-edges-for-nodes-use-case";
import { getGroupsUseCase } from "@/use-cases/groups/get-groups-use-case";
import { getSignalVectorsUseCase } from "@/use-cases/signal-vectors/get-signal-vectors-use-case";
import { getLatestOccurredAtUseCase } from "@/use-cases/signals/get-latest-occurred-at-use-case";
import { getSignalsForGroupsUseCase } from "@/use-cases/signals/get-signals-for-groups-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { resolveWindow } from "@/utilities/window";
import { INCIDENT_LEVEL, VELOCITY_WINDOW_MS } from "./assign-signal-use-case";

/**
 * The board: one row per bubble in the window, with everything needed to draw
 * it and nothing needed to read it in detail.
 *
 * Size, velocity, source diversity and verification are read straight off the
 * group's cached fold — they are not recomputed here, because a read that folds
 * is a read that gets slower as the day goes on. `memberCount` IS counted from
 * the edges on every call, deliberately: it is the cheap invariant that proves
 * the cache is honest (`size === memberCount`, and scripts/verify.mjs asserts
 * it). If those two ever disagree, the pipeline is at fault and the board says
 * so rather than hiding it.
 *
 * `center` is the mean of the members' galaxy coordinates, not a projection of
 * the group's centroid embedding. Those are nearly the same point, but only one
 * of them is guaranteed to sit among the points the UX layer actually draws.
 */

/** More bubbles than a four-minute demo — or an operator — can look at. */
export const GROUPS_LIMIT = 500;

export const Vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
export const GeoPointSchema = z.object({ lat: z.number(), lng: z.number() });

export const GroupViewSchema = z.object({
  id: z.uuid(),
  /** Mean of the members' projected coordinates; null until any member is projected. */
  center: Vec3Schema.nullable(),
  /** Mean position of members that carry coordinates — plot this on a map. */
  geoCentroid: GeoPointSchema.nullable(),
  /** Cached member count / weight — the bubble's radius. */
  size: z.number(),
  /** Members inside the last hour of the bubble's own occurred_at clock. */
  velocity: z.number(),
  /** COUNT(DISTINCT source_class) — how independent the corroboration is. */
  sourceDiversity: z.number().int(),
  /**
   * Counts of corroboration, never a verdict. Null before the first fold.
   *
   * `scoreBreakdown` inside it is the ONE thing said about ranking: bubbles come
   * back highest-`score` first, and that sentence is the arithmetic behind the
   * order. The score itself stays internal — a single blended number invites
   * exactly the false precision this problem statement is wary of.
   */
  verification: VerificationSchema.nullable(),
  /** Null until the pipeline names it — never invent a name at read time. */
  label: z.string().nullable(),
  /** Counted from member_of edges on every read; must equal `size`. */
  memberCount: z.number().int(),
  firstSeen: z.date(),
  lastSeen: z.date(),
});

export type GroupView = z.infer<typeof GroupViewSchema>;

export const getGroupsViewUseCase = createUseCase(
  {
    id: "get-groups-view",
    inputSchema: z.object({
      windowMins: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(GROUPS_LIMIT).optional(),
      /** Absent = every namespace. A dataset-scoped board must always pass it. */
      datasetId: z.string().min(1).optional(),
      /**
       * Only evidence CAPTURED (ingested_at) by this instant. The cached fold
       * knows only NOW, so size, velocity and the clocks are refolded from the
       * members that had arrived by then — the board's time control needs every
       * strip of the scene to replay from one clock.
       */
      asAt: z.date().optional(),
    }),
    outputSchema: z.array(GroupViewSchema),
  },
  async ({ success, error }, { windowMins, limit, datasetId, asAt, log }) => {
    const latest = await getLatestOccurredAtUseCase({ log });
    if (latest.error) return error(latest.error);

    const window = resolveWindow({ latestOccurredAt: latest.data, windowMins });

    const groups = await getGroupsUseCase({
      level: INCIDENT_LEVEL,
      from: window.from,
      to: window.to,
      limit: limit ?? GROUPS_LIMIT,
      datasetId,
      log,
    });
    if (groups.error) return error(groups.error);

    if (groups.data.length === 0) return success([]);

    const edges = await getEdgesForNodesUseCase({
      nodeIds: groups.data.map((g) => g.id),
      log,
    });
    if (edges.error) return error(edges.error);

    const membersByGroup = new Map<string, string[]>();
    for (const edge of edges.data) {
      if (edge.rel !== MEMBER_OF) continue;
      const members = membersByGroup.get(edge.toId);
      if (members) members.push(edge.fromId);
      else membersByGroup.set(edge.toId, [edge.fromId]);
    }

    const memberIds = [...new Set([...membersByGroup.values()].flat())];
    const vectors = await getSignalVectorsUseCase({ kind: PCA3, signalIds: memberIds, log });
    if (vectors.error) return error(vectors.error);

    const coordinates = new Map(vectors.data.map((v) => [v.signalId, v]));

    // Time travel: fetch the members that had been captured by the instant, so
    // each row can be refolded from exactly that evidence.
    let membersAsAt: Map<string, Signal[]> | null = null;
    if (asAt) {
      const members = await getSignalsForGroupsUseCase({
        groupIds: groups.data.map((g) => g.id),
        asAt,
        log,
      });
      if (members.error) return error(members.error);
      membersAsAt = new Map();
      for (const row of members.data) {
        const list = membersAsAt.get(row.groupId);
        if (list) list.push(row.signal);
        else membersAsAt.set(row.groupId, [row.signal]);
      }
    }

    return success(
      groups.data.flatMap((group) => {
        if (membersAsAt === null) {
          return [
            toGroupView({ group, memberIds: membersByGroup.get(group.id) ?? [], coordinates }),
          ];
        }
        // A group none of whose members had arrived yet is simply not there —
        // the same refusal the map's as-at read makes (AC33.2).
        const present = membersAsAt.get(group.id) ?? [];
        if (present.length === 0) return [];
        const presentIds = new Set(present.map((m) => m.id));
        const view = toGroupView({
          group,
          memberIds: (membersByGroup.get(group.id) ?? []).filter((id) => presentIds.has(id)),
          coordinates,
        });
        return [refoldAsAt(view, present)];
      }),
    );
  },
);

/**
 * A board row as it stood at an instant. Size, velocity, diversity and the
 * clocks come from the members in hand; `verification` is withheld rather than
 * restated, because the cached counts describe evidence that had not all
 * arrived yet. Velocity keeps the fold's own-clock rule: members inside the
 * last hour of the group's occurred_at clock, not the wall clock.
 */
function refoldAsAt(view: GroupView, members: Signal[]): GroupView {
  const times = members.map((m) => m.occurredAt.getTime());
  const lastSeen = Math.max(...times);
  return {
    ...view,
    size: members.length,
    memberCount: members.length,
    velocity: times.filter((t) => t >= lastSeen - VELOCITY_WINDOW_MS).length,
    sourceDiversity: new Set(members.map((m) => m.sourceClass)).size,
    verification: null,
    firstSeen: new Date(Math.min(...times)),
    lastSeen: new Date(lastSeen),
  };
}

/**
 * The one place a stored group becomes a board row. Shared with the drill-down
 * read so a bubble cannot describe itself differently in two places.
 */
export function toGroupView(input: {
  group: Group;
  memberIds: string[];
  coordinates: Map<string, SignalVector>;
}): GroupView {
  const { group } = input;
  const placed = input.memberIds
    .map((id) => input.coordinates.get(id))
    .filter((v): v is SignalVector => v !== undefined);

  const center =
    placed.length === 0
      ? null
      : {
          x: placed.reduce((sum, v) => sum + v.x, 0) / placed.length,
          y: placed.reduce((sum, v) => sum + v.y, 0) / placed.length,
          z: placed.reduce((sum, v) => sum + v.z, 0) / placed.length,
        };

  return {
    id: group.id,
    center,
    geoCentroid:
      group.centroidLat === null || group.centroidLng === null
        ? null
        : { lat: group.centroidLat, lng: group.centroidLng },
    size: group.mass,
    velocity: group.velocity,
    sourceDiversity: group.sourceDiversity,
    verification: group.verification,
    label: group.label,
    memberCount: input.memberIds.length,
    firstSeen: group.firstSeen,
    lastSeen: group.lastSeen,
  };
}
