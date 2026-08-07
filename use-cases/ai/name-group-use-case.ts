import { z } from "zod";
import { generateText, Output } from "ai";
import { createUseCase } from "@/utilities/create-use-case";
import { MODELS } from "./models";

/**
 * Thin INTEGRATION use case — one external call (`generateText` through the AI
 * Gateway), turning a bubble's members into a name an operator can scan.
 *
 * Same shape as embed-signals, and for the same reason: when
 * `AI_GATEWAY_API_KEY` is absent there is no external call to make, so it falls
 * back to a template behind the SAME interface — "top hazard — locality or
 * source", built from the annotations the pipeline team already send us. The
 * board is readable today and gets better names the moment a key is pasted in,
 * with no code change. `stub: true` comes back so the UI can say which it was.
 *
 * The prompt is deliberately constrained to DESCRIBE, never to assess: naming a
 * bubble "confirmed major flooding" would launder unverified public posts into
 * a claim, which is the exact failure mode this problem statement is wary of.
 */

export const NameGroupResultSchema = z.object({
  label: z.string(),
  /** The model id used, or the template's name — part of the traceability chain. */
  model: z.string(),
  /** TRUE = offline template, not a model. Never hide this from the UI. */
  stub: z.boolean(),
});

export type NameGroupResult = z.infer<typeof NameGroupResultSchema>;

/** The template's "model" id — it appears in results exactly like a real one. */
export const TEMPLATE_LABEL_MODEL = "template/hazard-locality";

/** Used when no member carries a hazard annotation. */
export const UNCLASSIFIED_HAZARD = "unclassified";

/** How many member sentences the model is shown. Enough to see the pattern. */
export const LABEL_SAMPLE_SIZE = 8;

/** One warning per process — the missing key is a static fact, not an event. */
let warnedAboutTemplate = false;

export const nameGroupUseCase = createUseCase(
  {
    id: "name-group",
    inputSchema: z.object({
      /** Member sentences, newest first. */
      texts: z.array(z.string()),
      /** Values of members' `hazard` annotations, if any. */
      hazards: z.array(z.string()),
      /** Values of members' `location_text` annotations, if any. */
      places: z.array(z.string()),
      /** Member `source` values — the last resort for a place-ish word. */
      sources: z.array(z.string()),
    }),
    outputSchema: NameGroupResultSchema,
  },
  async ({ success, error }, { texts, hazards, places, sources, log }) => {
    const fallback = templateLabel({ hazards, places, sources });

    if (texts.length === 0) {
      return success({ label: fallback, model: TEMPLATE_LABEL_MODEL, stub: true });
    }

    if (!process.env.AI_GATEWAY_API_KEY) {
      if (!warnedAboutTemplate) {
        warnedAboutTemplate = true;
        log?.warn(
          { model: TEMPLATE_LABEL_MODEL, replaces: MODELS.fast },
          "AI_GATEWAY_API_KEY is not set — naming bubbles from the hazard/locality template instead of a model.",
        );
      }
      return success({ label: fallback, model: TEMPLATE_LABEL_MODEL, stub: true });
    }

    const { output } = await generateText({
      model: MODELS.fast,
      output: Output.object({
        schema: z.object({
          label: z
            .string()
            .describe("At most 6 words: what is happening and where. No quotes, no full stop."),
        }),
      }),
      prompt: [
        "These public reports were grouped as one possible emerging local impact in Wellington, New Zealand.",
        "Name the group so an emergency operator can scan a list of them.",
        "Describe only what the reports say. Never state or imply that anything is confirmed, verified or official.",
        "",
        `Reports:\n${texts.slice(0, LABEL_SAMPLE_SIZE).map((t) => `- ${t}`).join("\n")}`,
        hazards.length > 0 ? `Hazard tags supplied by the sources: ${unique(hazards).join(", ")}` : "",
        places.length > 0 ? `Locations supplied by the sources: ${unique(places).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    if (!output) return error({ message: "Model returned no structured output" });

    const label = output.label.trim();
    if (label.length === 0) return error({ message: "Model returned an empty label" });

    return success({ label, model: MODELS.fast, stub: false });
  },
);

// ─── the offline template ─────────────────────────────────────────────────────

/**
 * "flooding — Aro Street". The hazard the members agree on most, then the place
 * they agree on most, falling back to the source they agree on most. Every part
 * of it comes from what a source actually asserted; nothing is inferred.
 */
export function templateLabel(input: {
  hazards: string[];
  places: string[];
  sources: string[];
}): string {
  const hazard = mostCommon(input.hazards) ?? UNCLASSIFIED_HAZARD;
  const where = mostCommon(input.places) ?? mostCommon(input.sources) ?? "location unknown";
  return `${hazard} — ${where}`;
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (value.length === 0) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  // Ties break alphabetically so the same bubble always gets the same name.
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}
