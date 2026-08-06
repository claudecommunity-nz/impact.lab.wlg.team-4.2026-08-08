---
name: new-entity
description: Stamp a complete vertical slice for a new entity (table → repo → use cases → router → feature block) from the notes reference implementation. Use when adding any new entity/domain to this codebase, e.g. "/new-entity incidents" or "add a signals entity".
---

# New entity generator

Generate a full pattern-conformant vertical slice for the entity named in the
arguments (e.g. `incidents`). The `notes` slice is the canonical template — read
its files as you go and mirror them exactly. Read `docs/architecture.md` first
if you haven't this session.

Ask the user only ONE question if not provided: the entity's fields (name, type,
required?). Everything else follows the pattern.

## Files to create (for entity `<x>`, plural `<xs>`)

1. **`db/schema.ts`** — append a `pgTable` for `<xs>` (uuid pk `defaultRandom()`,
   `createdAt` timestamptz `defaultNow()`, fields as given). Mirror `notes`.

2. **`repositories/<xs>/<x>-schema.ts`** — zod entity schema + type. Mirror
   `note-schema.ts` (`z.uuid()`, `z.coerce.date()`).

3. **`repositories/<xs>/get-<xs>-repo.ts`** and **`create-<x>-repo.ts`** —
   mirror the notes repos: `args: { db: Db, ... }`, return full entities,
   `.returning()` on inserts. Add update/delete repos only if asked.

4. **`use-cases/<xs>/create-<x>-use-case.ts`** — thin CRUD write:
   `createUseCase` wrapping the create repo, no logic. Mirror
   `create-note-use-case.ts`.

5. **`use-cases/<xs>/<xs>-router.ts`** — the boundary. Mirror `notes-router.ts`:
   - `list`: `.output(z.array(<X>Schema)).query(() => get<Xs>Repo({ db }))`
   - `create`: `.input(...).output(<X>Schema).mutation(({ ctx, input }) =>
     callUseCase(create<X>UseCase({ ...input, log: ctx.log })))`

6. **`trpc/router.ts`** — add one line: `<xs>: <xs>Router`.

7. **`use-cases/<xs>/use-create-<x>.ts`** — mutation policy hook
   (invalidate-and-toast). Mirror `use-capture-note.ts`; invalidate
   `trpc.<xs>.list.queryFilter()`.

8. **`features/<xs>/<xs>-server.tsx`**, **`<xs>-client.tsx`**,
   **`<xs>-skeleton.tsx`** — mirror the notes feature block: server = boundaries
   + `prefetch(trpc.<xs>.list.queryOptions())` + `<HydrateClient>`; client =
   `useQuery(trpc.<xs>.list.queryOptions())` + policy hook, isLoading→skeleton,
   isError→`<FeatureError>`; skeleton mirrors layout.

9. **`app/<xs>/page.tsx`** — thin page with `export const dynamic = "force-dynamic"`.

## After generating

- Run `npm run typecheck` and fix anything it reports.
- Tell the user to run `npm run db:push` (schema changed).
- Do NOT add business-logic use cases speculatively — those get written when a
  real operation needs one (see `capture-note-use-case.ts` for the shape).
