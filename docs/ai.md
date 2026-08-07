# AI

All AI calls are **thin integration use cases** in `use-cases/ai/` — same factory,
same rules as everything else (see [use-cases](./use-cases.md)).

## Rules

- **`use-cases/ai/models.ts` is the ONLY place model ids live.** Plain strings route
  through Vercel AI Gateway (`AI_GATEWAY_API_KEY`) — no provider packages:
  `MODELS.fast` (high-volume/low-stakes), `MODELS.smart` (user-facing quality),
  `MODELS.embed`.
- Generation is ALWAYS structured: `generateText` with `Output.object({ schema })`
  (zod) — never parse free-text model output, and don't use `generateObject`
  (deprecated). Embeddings via `embedMany`.
- One external call per use case, no business logic around it — composition happens
  in business-logic use cases.
- Prompts live next to the call. Describe output constraints in the zod schema's
  `.describe()`, not just the prompt.

Reference: `use-cases/ai/suggest-note-title-use-case.ts`.

## AI UI — AI Elements

`components/ai-elements/` has Vercel's full AI Elements set (48 components:
`conversation`, `message`, `prompt-input`, `chain-of-thought`, `sources`,
`model-selector`, `canvas`, …). **Any chat/agent/AI-facing UI defaults to these —
never hand-roll a message thread, prompt box, or streaming display.** They compose
with the same shadcn primitives and theme tokens as everything else.

Ten of the vendored files carry a `@ts-nocheck` banner — they were generated
against radix-based shadcn and our preset uses Base UI, so a few props skew.
When you first USE one of those components, remove the banner and fix the
handful of prop types it reports.

## Docs

The `ai-sdk` skill in `.claude/skills/` explains how to look up current AI SDK docs —
they're bundled in `node_modules/ai/docs/` (search there rather than trusting memory;
the SDK moves fast).
