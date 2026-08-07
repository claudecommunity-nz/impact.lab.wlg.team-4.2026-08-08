import { z } from "zod";
import { PCA } from "ml-pca";
import { PCA3, Pca3ModelSchema, type Pca3Model } from "@/db/vocabulary";
import { getProjectionModelUseCase } from "@/use-cases/projection-models/get-projection-model-use-case";
import { putProjectionModelUseCase } from "@/use-cases/projection-models/put-projection-model-use-case";
import { getEmbeddedSignalsUseCase } from "@/use-cases/signals/get-embedded-signals-use-case";
import { getUnprojectedSignalsUseCase } from "@/use-cases/signals/get-unprojected-signals-use-case";
import { upsertSignalVectorsUseCase } from "@/use-cases/signal-vectors/upsert-signal-vectors-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { projectOnto } from "@/utilities/vector";

/**
 * The galaxy verb: 1536 dimensions → 3, through a FIXED basis.
 *
 * The stability rule, and the only rule that matters here: FIT ONCE, TRANSFORM
 * FOREVER. Refitting as data arrives would re-orient the whole space on every
 * run — bubbles would jump between frames, two time ranges would not be
 * comparable, and an operator could never learn the map. So the first batch of
 * at least 20 embedded signals fits a PCA basis, that basis is persisted as
 * plain numbers, and every signal after it is transformed through the stored
 * matrix. Nothing refits it. Rebuilding the coordinates from the stored basis
 * is byte-for-byte reproducible.
 *
 * Before the fit exists, signals legitimately have NO coordinates: downstream
 * must tolerate a null vec3 rather than assume the origin.
 */

/** Below this the basis would describe noise, not the data. */
export const MIN_FIT_SIGNALS = 20;

/** How many signals the one-off fit samples. */
export const FIT_SAMPLE_LIMIT = 500;

/** How many signals one call transforms. */
export const PROJECT_BATCH_LIMIT = 500;

export const ProjectSignalsResultSchema = z.object({
  kind: z.string(),
  /** True only on the single call that fitted the basis. */
  fitted: z.boolean(),
  /** False = still waiting for MIN_FIT_SIGNALS; points stay unprojected, by design. */
  hasModel: z.boolean(),
  projected: z.number().int(),
  /** Variance kept by x, y, z — an honest label for a 1536→3 squash. */
  explainedVariance: z.array(z.number()),
});

export type ProjectSignalsResult = z.infer<typeof ProjectSignalsResultSchema>;

export const projectSignalsUseCase = createUseCase(
  {
    id: "project-signals",
    inputSchema: z.object({ limit: z.number().int().positive().optional() }),
    outputSchema: ProjectSignalsResultSchema,
  },
  async ({ success, error }, { limit, log }) => {
    const stored = await getProjectionModelUseCase({ kind: PCA3, log });
    if (stored.error) return error(stored.error);

    let model: Pca3Model | null = null;
    let fitted = false;

    if (stored.data) {
      const parsed = Pca3ModelSchema.safeParse(stored.data.model);
      if (!parsed.success) {
        return error({
          message: `Stored ${PCA3} basis is unreadable: ${parsed.error.message}`,
          kind: "bad_projection_model",
        });
      }
      model = parsed.data;
    } else {
      const sample = await getEmbeddedSignalsUseCase({ limit: FIT_SAMPLE_LIMIT, log });
      if (sample.error) return error(sample.error);

      if (sample.data.length < MIN_FIT_SIGNALS) {
        log?.info(
          { embedded: sample.data.length, required: MIN_FIT_SIGNALS },
          "Projection basis not fitted yet — signals stay unprojected until there is enough to fit",
        );
        return success({
          kind: PCA3,
          fitted: false,
          hasModel: false,
          projected: 0,
          explainedVariance: [],
        });
      }

      const embeddings = sample.data
        .map((s) => s.embedding)
        .filter((e): e is number[] => Array.isArray(e) && e.length > 0);

      model = fitPca3(embeddings);
      const put = await putProjectionModelUseCase({ kind: PCA3, model, log });
      if (put.error) return error(put.error);
      fitted = true;

      log?.info(
        {
          fittedOn: model.fittedOn,
          dimensions: model.dimensions,
          explainedVariance: model.explainedVariance.map((v) => Number(v.toFixed(4))),
        },
        "Fitted the projection basis — this happens exactly once, and is never refitted",
      );
    }

    // ─── transform ────────────────────────────────────────────────────────────
    const pending = await getUnprojectedSignalsUseCase({
      kind: PCA3,
      limit: limit ?? PROJECT_BATCH_LIMIT,
      log,
    });
    if (pending.error) return error(pending.error);

    const basis = model;
    const vectors = pending.data
      .filter((s) => Array.isArray(s.embedding) && s.embedding.length > 0)
      .map((s) => ({
        signalId: s.id,
        x: projectOnto(s.embedding as number[], basis.mean, basis.components[0]),
        y: projectOnto(s.embedding as number[], basis.mean, basis.components[1]),
        z: projectOnto(s.embedding as number[], basis.mean, basis.components[2]),
      }));

    const written = await upsertSignalVectorsUseCase({ kind: PCA3, vectors, log });
    if (written.error) return error(written.error);

    return success({
      kind: PCA3,
      fitted,
      hasModel: true,
      projected: written.data.length,
      explainedVariance: basis.explainedVariance,
    });
  },
);

/**
 * The one-off fit. Stored as plain numbers rather than an ml-pca model dump, so
 * a notebook, another team, or a later rewrite can reproduce any coordinate
 * with `dot(embedding - mean, components[i])` and no dependency on this library.
 */
function fitPca3(embeddings: number[][]): Pca3Model {
  const pca = new PCA(embeddings, { center: true, scale: false });
  const loadings = pca.getLoadings().to2DArray();
  const variance = pca.getExplainedVariance();
  const dimensions = embeddings[0].length;

  // A fit on very few, very similar points can yield under three components;
  // a zero axis is honest (that axis carries nothing) and keeps the vec3 shape.
  const axis = (index: number) => loadings[index] ?? new Array<number>(dimensions).fill(0);

  return {
    mean: pca.toJSON().means,
    components: [axis(0), axis(1), axis(2)],
    explainedVariance: [variance[0] ?? 0, variance[1] ?? 0, variance[2] ?? 0],
    fittedOn: embeddings.length,
    dimensions,
  };
}
