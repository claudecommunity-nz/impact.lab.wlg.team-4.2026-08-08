import { Suspense } from "react";
import { ErrorBoundary } from "@/components/errors/error-boundary";
import { FeatureError } from "@/components/errors/feature-error";
import { trpc, prefetch, HydrateClient } from "@/trpc/server";
import { NotesClient } from "./notes-client";
import { NotesSkeleton } from "./notes-skeleton";

/**
 * The feature entry — what pages render. Boundaries outside, prefetch inside:
 * ErrorBoundary → Suspense(skeleton) → prefetch via the server tRPC proxy
 * (in-process, no HTTP) → HydrateClient hands the data to NotesClient's
 * useQuery. First paint is real data; the skeleton shows only while streaming.
 */
export function Notes() {
  return (
    <ErrorBoundary fallback={<FeatureError name="notes" />}>
      <Suspense fallback={<NotesSkeleton />}>
        <NotesContent />
      </Suspense>
    </ErrorBoundary>
  );
}

async function NotesContent() {
  prefetch(trpc.notes.list.queryOptions());

  return (
    <HydrateClient>
      <NotesClient />
    </HydrateClient>
  );
}
