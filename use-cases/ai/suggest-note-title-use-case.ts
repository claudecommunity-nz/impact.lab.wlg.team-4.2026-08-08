import { z } from "zod";
import { generateText, Output } from "ai";
import { createUseCase } from "@/utilities/create-use-case";
import { MODELS } from "./models";

/**
 * Thin INTEGRATION use case — wraps exactly one external call, no logic; the
 * third-party twin of a thin CRUD use case. All model output is structured:
 * generateText + Output.object with a zod schema, never free-text parsing.
 */
export const suggestNoteTitleUseCase = createUseCase(
  {
    id: "suggest-note-title",
    inputSchema: z.object({ content: z.string().min(1) }),
    outputSchema: z.object({ title: z.string() }),
  },
  async ({ success, error }, { content }) => {
    const { output } = await generateText({
      model: MODELS.fast,
      output: Output.object({
        schema: z.object({ title: z.string().describe("≤6 words, no quotes") }),
      }),
      prompt: `Suggest a title for this note:\n\n${content}`,
    });
    if (!output) return error({ message: "Model returned no structured output" });
    return success({ title: output.title });
  },
);
