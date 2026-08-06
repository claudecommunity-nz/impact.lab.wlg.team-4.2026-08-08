import { Notes } from "@/features/notes/notes-server";

// Live data — render per-request, never prerender at build.
export const dynamic = "force-dynamic";

/** Pages are trivially thin: compose feature entries, nothing else. */
export default function NotesPage() {
  return (
    <main className="flex-1">
      <Notes />
    </main>
  );
}
