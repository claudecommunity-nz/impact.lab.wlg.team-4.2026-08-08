import { z } from "zod";
import { embedSignalsUseCase } from "@/use-cases/ai/embed-signals-use-case";
import { createAnnotationsUseCase } from "@/use-cases/annotations/create-annotations-use-case";
import { acquireAdvisoryLockUseCase } from "@/use-cases/locks/acquire-advisory-lock-use-case";
import { releaseAdvisoryLockUseCase } from "@/use-cases/locks/release-advisory-lock-use-case";
import { getPendingSignalsUseCase } from "@/use-cases/signals/get-pending-signals-use-case";
import { updateSignalEmbeddingUseCase } from "@/use-cases/signals/update-signal-embedding-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { assignSignalUseCase } from "./assign-signal-use-case";
import { labelGroupUseCase } from "./label-group-use-case";
import { projectSignalsUseCase } from "./project-signals-use-case";

/**
 * The vector layer's one moving part: embed → assign → name → project, over the
 * signals that have not been placed yet, in occurred_at order.
 *
 * Business-logic use case — it composes other use cases and touches no repo and
 * no SDK. Call it from a procedure, a workflow, a cron, or a script; the logic
 * is identical because none of it lives in the transport.
 *
 * Bounded (50 signals a call) so one enormous backlog cannot hold a request
 * open, and idempotent: run it until `pending` comes back 0 and the state is
 * the same as a single big run would have produced.
 *
 * Serialised by a Postgres advisory lock. Two callers racing — the poller and
 * an operator hitting the button — would otherwise both read the same pending
 * queue and assign the same signal twice, or worse, spawn two bubbles for one
 * event. The second caller returns `locked: false` immediately rather than
 * queueing; there is nothing useful for it to do.
 */

/** One batch. Small enough to stay inside a request, big enough to make progress. */
export const PROCESS_BATCH_LIMIT = 50;

/** The lock every vector-pipeline run contends for. Arbitrary, but fixed forever. */
export const VECTORS_ADVISORY_LOCK_KEY = 41_208_004;

export const ProcessPendingResultSchema = z.object({
  /** false = another run holds the lock; nothing was done, and that is fine. */
  locked: z.boolean(),
  /** Signals taken off the pending queue this call. */
  pending: z.number().int(),
  embedded: z.number().int(),
  assigned: z.number().int(),
  groupsCreated: z.number().int(),
  groupsJoined: z.number().int(),
  projected: z.number().int(),
  /** Bubbles (re-)named this call — every bubble touched by the batch. */
  labelled: z.number().int(),
  /** True on the one call that fitted the projection basis. */
  fittedProjection: z.boolean(),
  /** True = embeddings came from the offline stub (lexical, not semantic). */
  stubEmbeddings: z.boolean(),
  /** Signals that could not be placed, with the reason, one entry each. */
  failures: z.array(z.object({ signalId: z.uuid(), error: z.string() })),
});

export type ProcessPendingResult = z.infer<typeof ProcessPendingResultSchema>;

const EMPTY_RUN: ProcessPendingResult = {
  locked: false,
  pending: 0,
  embedded: 0,
  assigned: 0,
  groupsCreated: 0,
  groupsJoined: 0,
  projected: 0,
  labelled: 0,
  fittedProjection: false,
  stubEmbeddings: false,
  failures: [],
};

export const processPendingUseCase = createUseCase(
  {
    id: "process-pending",
    inputSchema: z.object({ limit: z.number().int().positive().max(500).optional() }),
    outputSchema: ProcessPendingResultSchema,
  },
  async ({ success, error }, { limit, log }) => {
    const lock = await acquireAdvisoryLockUseCase({ key: VECTORS_ADVISORY_LOCK_KEY, log });
    if (lock.error) return error(lock.error);

    if (!lock.data.token) {
      log?.info({}, "Vector pipeline already running elsewhere — skipping this call");
      return success(EMPTY_RUN);
    }

    const token = lock.data.token;
    try {
      const pending = await getPendingSignalsUseCase({
        limit: limit ?? PROCESS_BATCH_LIMIT,
        log,
      });
      if (pending.error) return error(pending.error);

      if (pending.data.length === 0) {
        // Still project: a basis may have become fittable, or coordinates may
        // be missing for signals grouped by an earlier, pre-basis run.
        const projection = await projectSignalsUseCase({ log });
        if (projection.error) return error(projection.error);
        return success({
          ...EMPTY_RUN,
          locked: true,
          projected: projection.data.projected,
          fittedProjection: projection.data.fitted,
        });
      }

      // ─── embed ──────────────────────────────────────────────────────────────
      const unembedded = pending.data.filter((s) => !s.embedding || s.embedding.length === 0);
      let stubEmbeddings = false;

      if (unembedded.length > 0) {
        const embedded = await embedSignalsUseCase({
          texts: unembedded.map((s) => s.text),
          log,
        });
        if (embedded.error) return error(embedded.error);
        stubEmbeddings = embedded.data.stub;

        for (const [index, signal] of unembedded.entries()) {
          const written = await updateSignalEmbeddingUseCase({
            id: signal.id,
            embedding: embedded.data.embeddings[index],
            log,
          });
          if (written.error) return error(written.error);
        }

        // Say WHICH embedder placed each signal. A bubble built by the lexical
        // stub and one built by the real model are not the same claim, and the
        // difference has to survive as data, not as a log line.
        const provenance = await createAnnotationsUseCase({
          annotations: unembedded.map((signal) => ({
            nodeId: signal.id,
            key: "embedding_model",
            value: embedded.data.model,
            annotator: "rule",
          })),
          log,
        });
        if (provenance.error) return error(provenance.error);
      }

      // ─── assign ─────────────────────────────────────────────────────────────
      // Sequential and in occurred_at order on purpose: each decision is made
      // against the bubbles the previous ones produced, so replaying the same
      // signals reproduces the same grouping.
      let assigned = 0;
      let groupsCreated = 0;
      let groupsJoined = 0;
      const failures: ProcessPendingResult["failures"] = [];
      const touched = new Set<string>();

      for (const signal of pending.data) {
        const placed = await assignSignalUseCase({ signalId: signal.id, log });
        if (placed.error) {
          // One unplaceable signal must not strand the other 49.
          failures.push({ signalId: signal.id, error: placed.error.message });
          continue;
        }
        assigned += 1;
        touched.add(placed.data.groupId);
        if (placed.data.joined) groupsJoined += 1;
        else groupsCreated += 1;
      }

      // ─── name ───────────────────────────────────────────────────────────────
      // Every bubble this batch touched, because a bubble that just gained five
      // reports may no longer be about what its old name says.
      //
      // The ONE place this pipeline does not propagate a composed error: a name
      // is a convenience on top of a grouping that has already been written and
      // is already correct. Failing the batch — and telling the caller nothing
      // was done — because a model call timed out would be a worse answer than
      // an unnamed bubble, which the read surface already renders as `null`.
      let labelled = 0;
      for (const groupId of touched) {
        const named = await labelGroupUseCase({ groupId, log });
        if (named.error) {
          log?.warn({ groupId, error: named.error.message }, "Could not name a bubble — it stays unnamed");
          continue;
        }
        labelled += 1;
      }

      // ─── project ────────────────────────────────────────────────────────────
      const projection = await projectSignalsUseCase({ log });
      if (projection.error) return error(projection.error);

      log?.info(
        {
          pending: pending.data.length,
          embedded: unembedded.length,
          assigned,
          groupsCreated,
          groupsJoined,
          projected: projection.data.projected,
          labelled,
          failed: failures.length,
          stubEmbeddings,
        },
        "Vector pipeline batch complete",
      );

      return success({
        locked: true,
        pending: pending.data.length,
        embedded: unembedded.length,
        assigned,
        groupsCreated,
        groupsJoined,
        projected: projection.data.projected,
        labelled,
        fittedProjection: projection.data.fitted,
        stubEmbeddings,
        failures,
      });
    } finally {
      const released = await releaseAdvisoryLockUseCase({ token, log });
      if (released.error) log?.error({ token }, "Failed to release the vector pipeline lock");
    }
  },
);
