# Repositories

The only layer that touches the database. Drizzle queries, nothing else — no business
logic, no logging, no AI.

## File structure

```
repositories/<entity>s/
├── <entity>-schema.ts        # Zod entity schema + type (the shape all upper layers speak)
├── get-<entity>-repo.ts      # Single entity
├── get-<entity>s-repo.ts     # List
├── create-<entity>-repo.ts
├── update-<entity>-repo.ts   # (when needed)
└── delete-<entity>-repo.ts   # (when needed)
```

The Drizzle table itself lives in `db/schema.ts`; the zod schema here is the contract.

## Rules

- **Return full entities, never individual columns.** Consumers extract what they need.
- **`db` is passed in as an argument** (`args: { db: Db }`) — repos never import the
  client themselves. Keeps them testable and context-free.
- One exported async function per file, named exactly like the file.
- Simple args object in, entity (or entity[] / null) out. Repos do not return
  `{ data, error }` — they throw, and the use-case factory catches.

```ts
export async function getNotesRepo(args: { db: Db }): Promise<Note[]> {
  return args.db.select().from(notes).orderBy(desc(notes.createdAt));
}
```

## Drizzle notes

- Mutations use `.returning()` so the repo can return the full entity.
- Schema changes: edit `db/schema.ts`, run `npm run db:push` (drizzle-kit push — no
  migration files during the hackathon).
