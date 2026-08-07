import { z } from "zod";
import { MEMBER_OF, PCA3, VerificationSchema } from "@/db/vocabulary";
import { type Group } from "@/repositories/groups/group-schema";
import { type SignalVector } from "@/repositories/signal-vectors/signal-vector-schema";
import { getEdgesForNodesUseCase } from "@/use-cases/edges/get-edges-for-nodes-use-case";
import { getGroupsUseCase } from "@/use-cases/groups/get-groups-use-case";
import { getSignalVectorsUseCase } from "@/use-cases/signal-vectors/get-signal-vectors-use-case";
import { getLatestOccurredAtUseCase } from "@/use-cases/signals/get-latest-occurred-at-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { resolveWindow } from "@/utilities/window";
import { INCIDENT_LEVEL } from "./assign-signal-use-case";

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
  /** Counts of corroboration, never a verdict. Null before the first fold. */
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
    }),
    outputSchema: z.array(GroupViewSchema),
  },
  async ({ success, error }, { windowMins, limit, log }) => {
    const latest = await getLatestOccurredAtUseCase({ log });
    if (latest.error) return error(latest.error);

    const window = resolveWindow({ latestOccurredAt: latest.data, windowMins });

    const groups = await getGroupsUseCase({
      level: INCIDENT_LEVEL,
      from: window.from,
      to: window.to,
      limit: limit ?? GROUPS_LIMIT,
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

    return success(
      groups.data.map((group) =>
        toGroupView({
          group,
          memberIds: membersByGroup.get(group.id) ?? [],
          coordinates,
        }),
      ),
    );
  },
);

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
