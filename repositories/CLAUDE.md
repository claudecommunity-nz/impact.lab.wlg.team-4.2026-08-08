# Repositories — how to work in this folder

Full guide: @docs/repositories.md

The only layer that touches the database. Drizzle queries, nothing else.

- One entity folder per entity: `notes/`, each with `<entity>-schema.ts` (zod contract)
  and one file per operation: `get-<entity>s-repo.ts`, `create-<entity>-repo.ts`, …
- **Return full entities, never individual columns.**
- `db` is passed in (`args: { db: Db }`) — never import the client here.
- Repos throw on failure; the use-case factory catches. No `{ data, error }` here,
  no logging, no business logic, no AI.
- Repos are called ONLY by thin CRUD use cases and pure-fetch query procedures
  (`<domain>-router.ts`) — nothing else.
- Tables live in `db/schema.ts`; after changing it run `npm run db:push`.

Reference: `repositories/notes/`.
