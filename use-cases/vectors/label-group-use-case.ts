import { z } from "zod";
import { LABEL_SAMPLE_SIZE, nameGroupUseCase } from "@/use-cases/ai/name-group-use-case";
import { getAnnotationsForNodesUseCase } from "@/use-cases/annotations/get-annotations-for-nodes-use-case";
import { updateGroupUseCase } from "@/use-cases/groups/update-group-use-case";
import { getSignalsForGroupUseCase } from "@/use-cases/signals/get-signals-for-group-use-case";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Give a bubble a name, from what its members actually say.
 *
 * Business-logic use case: it gathers the members and their annotations, hands
 * those to the naming integration, and caches the result on the group. The name
 * is written at WRITE time, not derived at read time, for two reasons — a read
 * that calls a model is a read that costs money and latency per viewer, and a
 * name that changes every time you refresh is not a name.
 *
 * Bubbles are re-named as they grow: a bubble of two reports and the same
 * bubble at eleven are different things, and the eleventh report often changes
 * what it should be called.
 */

/** The annotation keys that feed the offline template (see name-group). */
const HAZARD_KEY = "hazard";
const LOCATION_TEXT_KEY = "location_text";

export const LabelGroupResultSchema = z.object({
  groupId: z.uuid(),
  label: z.string(),
  /** TRUE = named by the offline template rather than a model. */
  stub: z.boolean(),
});

export const labelGroupUseCase = createUseCase(
  {
    id: "label-group",
    inputSchema: z.object({ groupId: z.uuid() }),
    outputSchema: LabelGroupResultSchema,
  },
  async ({ success, error }, { groupId, log }) => {
    const members = await getSignalsForGroupUseCase({ groupId, log });
    if (members.error) return error(members.error);

    if (members.data.length === 0) {
      return error({ message: `Group ${groupId} has no members to name`, kind: "empty_group" });
    }

    const annotations = await getAnnotationsForNodesUseCase({
      nodeIds: members.data.map((m) => m.id),
      log,
    });
    if (annotations.error) return error(annotations.error);

    const valuesFor = (key: string) =>
      annotations.data.filter((a) => a.key === key).map((a) => a.value);

    // Members arrive newest first; the model sees the most recent reports.
    const named = await nameGroupUseCase({
      texts: members.data.slice(0, LABEL_SAMPLE_SIZE).map((m) => m.text),
      hazards: valuesFor(HAZARD_KEY),
      places: valuesFor(LOCATION_TEXT_KEY),
      sources: members.data.map((m) => m.source),
      log,
    });
    if (named.error) return error(named.error);

    const updated = await updateGroupUseCase({ id: groupId, label: named.data.label, log });
    if (updated.error) return error(updated.error);

    log?.info(
      { groupId, label: named.data.label, model: named.data.model, stub: named.data.stub },
      "Named a bubble",
    );

    return success({ groupId, label: named.data.label, stub: named.data.stub });
  },
);
