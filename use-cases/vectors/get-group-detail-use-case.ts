import { z } from "zod";
import { MEMBER_OF, PCA3, RawPayloadSchema } from "@/db/vocabulary";
import { type SignalVector } from "@/repositories/signal-vectors/signal-vector-schema";
import { getAnnotationsForNodesUseCase } from "@/use-cases/annotations/get-annotations-for-nodes-use-case";
import { getEdgesForNodesUseCase } from "@/use-cases/edges/get-edges-for-nodes-use-case";
import { getGroupUseCase } from "@/use-cases/groups/get-group-use-case";
import { getSignalVectorsUseCase } from "@/use-cases/signal-vectors/get-signal-vectors-use-case";
import { getSignalsForGroupUseCase } from "@/use-cases/signals/get-signals-for-group-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { GroupViewSchema, toGroupView } from "./get-groups-view-use-case";

/**
 * The whole traceability chain in one call: bubble → members → every finding
 * asserted about each member → the verbatim payload it came from.
 *
 * This read is the point of the module. A bubble that says "eleven reports,
 * three source classes" is worth nothing to an intelligence team unless they
 * can open it and read the eleven original posts, see who said what and when,
 * and see the sentence explaining why each one was placed here. So:
 *
 *   - `annotations` is EVERY annotation on the member, unfiltered — including
 *     keys we have never heard of. The pipeline team's findings arrive as
 *     annotations, and a read that only returned keys we know about would
 *     silently drop their work.
 *   - `membership` carries the weight AND the reason from the member_of edge.
 *     A grouping an operator cannot read is a grouping they cannot trust.
 *   - `raw` is the payload exactly as it was sent to us. It is never rewritten,
 *     never normalised, and outlives every derived number above it.
 */

export const MemberAnnotationSchema = z.object({
  key: z.string(),
  value: z.string(),
  confidence: z.number().nullable(),
  /** claude | feed | rule | operator — who asserted it. */
  annotator: z.string(),
  createdAt: z.date(),
});

export const MembershipSchema = z.object({
  /** Cosine against the bubble's centroid at the moment of the decision. */
  weight: z.number().nullable(),
  /** The same decision in words: "cosine 0.89; 107m and 16min apart". */
  reason: z.string(),
  createdAt: z.date(),
});

export const GroupMemberSchema = z.object({
  signalId: z.uuid(),
  occurredAt: z.date(),
  ingestedAt: z.date(),
  source: z.string(),
  /** OPEN TEXT — the diversity axis counts distinct values of this. */
  sourceClass: z.string(),
  text: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  geoConfidence: z.number().nullable(),
  /** Position in the galaxy, or null if this signal is not projected yet. */
  point: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable(),
  /** ALL of them, in the order they were asserted. */
  annotations: z.array(MemberAnnotationSchema),
  membership: MembershipSchema,
  /** The source payload, verbatim, forever. The end of the chain. */
  raw: RawPayloadSchema,
});

export const GroupDetailSchema = GroupViewSchema.extend({
  /** Newest first — an operator reads the latest report before the first one. */
  members: z.array(GroupMemberSchema),
});

export type GroupDetail = z.infer<typeof GroupDetailSchema>;

/** Stands in when a member row has no edge — structurally impossible, but never lie. */
const MISSING_MEMBERSHIP = "membership edge missing — this signal's placement is unexplained";

export const getGroupDetailUseCase = createUseCase(
  {
    id: "get-group-detail",
    inputSchema: z.object({ id: z.uuid() }),
    outputSchema: GroupDetailSchema,
  },
  async ({ success, error }, { id, log }) => {
    const group = await getGroupUseCase({ id, log });
    if (group.error) return error(group.error);
    if (!group.data) return error({ message: `Group ${id} not found`, kind: "not_found" });

    const members = await getSignalsForGroupUseCase({ groupId: id, log });
    if (members.error) return error(members.error);

    const memberIds = members.data.map((m) => m.id);

    const annotations = await getAnnotationsForNodesUseCase({ nodeIds: memberIds, log });
    if (annotations.error) return error(annotations.error);

    const edges = await getEdgesForNodesUseCase({ nodeIds: [id], log });
    if (edges.error) return error(edges.error);

    const vectors = await getSignalVectorsUseCase({ kind: PCA3, signalIds: memberIds, log });
    if (vectors.error) return error(vectors.error);

    const annotationsBySignal = new Map<string, typeof annotations.data>();
    for (const annotation of annotations.data) {
      const existing = annotationsBySignal.get(annotation.nodeId);
      if (existing) existing.push(annotation);
      else annotationsBySignal.set(annotation.nodeId, [annotation]);
    }

    const membershipBySignal = new Map(
      edges.data.filter((e) => e.rel === MEMBER_OF && e.toId === id).map((e) => [e.fromId, e]),
    );

    const coordinates = new Map<string, SignalVector>(vectors.data.map((v) => [v.signalId, v]));

    return success({
      ...toGroupView({ group: group.data, memberIds, coordinates }),
      members: members.data.map((signal) => {
        const edge = membershipBySignal.get(signal.id);
        const vec3 = coordinates.get(signal.id);
        return {
          signalId: signal.id,
          occurredAt: signal.occurredAt,
          ingestedAt: signal.ingestedAt,
          source: signal.source,
          sourceClass: signal.sourceClass,
          text: signal.text,
          lat: signal.lat,
          lng: signal.lng,
          geoConfidence: signal.geoConfidence,
          point: vec3 ? { x: vec3.x, y: vec3.y, z: vec3.z } : null,
          annotations: (annotationsBySignal.get(signal.id) ?? []).map((a) => ({
            key: a.key,
            value: a.value,
            confidence: a.confidence,
            annotator: a.annotator,
            createdAt: a.createdAt,
          })),
          membership: {
            weight: edge?.weight ?? null,
            reason: edge?.reason ?? MISSING_MEMBERSHIP,
            createdAt: edge?.createdAt ?? signal.ingestedAt,
          },
          raw: signal.raw,
        };
      }),
    });
  },
);
