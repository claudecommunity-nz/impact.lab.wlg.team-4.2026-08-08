import { z } from "zod";
import { embedMany } from "ai";
import { EmbeddingSchema } from "@/db/vocabulary";
import { createUseCase } from "@/utilities/create-use-case";
import { EMBED_DIMENSIONS, MODELS } from "./models";
import { stubEmbedding } from "./stub-embedding";

/**
 * Thin INTEGRATION use case — one external call (`embedMany` through the AI
 * Gateway), batched because embedding one string at a time is a round trip per
 * signal.
 *
 * The one branch it is allowed: when `AI_GATEWAY_API_KEY` is absent there is no
 * external call to make, so it falls back to the deterministic stub behind the
 * SAME interface — same width, same shape, same `{ data, error }`. Everything
 * downstream (centroids, cosine, the PCA basis, the galaxy) works today and
 * upgrades the moment a key is pasted in, with no code change. `stub: true`
 * comes back in the result so the UI can say so rather than implying the
 * grouping is semantic when it is lexical.
 */

export const EmbedSignalsResultSchema = z.object({
  embeddings: z.array(EmbeddingSchema),
  /** The model id used, or the stub's name — kept for the traceability chain. */
  model: z.string(),
  /** TRUE = offline stub, lexical not semantic. Never hide this from the UI. */
  stub: z.boolean(),
  dimensions: z.number().int(),
});

export type EmbedSignalsResult = z.infer<typeof EmbedSignalsResultSchema>;

/** The stub's model id — it appears in logs and results exactly like a real one. */
export const STUB_EMBED_MODEL = "stub/lexical-hash-1536";

/** One warning per process, not one per batch — the fact is static, not an event. */
let warnedAboutStub = false;

export const embedSignalsUseCase = createUseCase(
  {
    id: "embed-signals",
    inputSchema: z.object({ texts: z.array(z.string().min(1)) }),
    outputSchema: EmbedSignalsResultSchema,
  },
  async ({ success, error }, { texts, log }) => {
    if (texts.length === 0) {
      return success({
        embeddings: [],
        model: MODELS.embed,
        stub: false,
        dimensions: EMBED_DIMENSIONS,
      });
    }

    if (!process.env.AI_GATEWAY_API_KEY) {
      if (!warnedAboutStub) {
        warnedAboutStub = true;
        log?.warn(
          { model: STUB_EMBED_MODEL, replaces: MODELS.embed },
          "AI_GATEWAY_API_KEY is not set — embedding with the deterministic offline stub. Grouping is lexical, not semantic, until a key is set.",
        );
      }
      return success({
        embeddings: texts.map(stubEmbedding),
        model: STUB_EMBED_MODEL,
        stub: true,
        dimensions: EMBED_DIMENSIONS,
      });
    }

    const { embeddings } = await embedMany({ model: MODELS.embed, values: texts });
    if (embeddings.length !== texts.length) {
      return error({
        message: `Embedding returned ${embeddings.length} vectors for ${texts.length} texts`,
        kind: "embed_count_mismatch",
      });
    }

    return success({
      embeddings,
      model: MODELS.embed,
      stub: false,
      dimensions: embeddings[0]?.length ?? EMBED_DIMENSIONS,
    });
  },
);
