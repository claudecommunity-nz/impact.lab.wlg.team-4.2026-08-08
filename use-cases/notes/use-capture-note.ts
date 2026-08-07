"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTRPC } from "@/trpc/client";

/**
 * Mutation POLICY hook: invalidate-and-toast. Components call this, never the
 * raw mutation — the policy (which caches to invalidate, what to toast) lives
 * here in exactly one place. No optimistic cache surgery: the refetch after
 * invalidation is the source of truth.
 */
export function useCaptureNote() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.notes.capture.mutationOptions({
      onSuccess: () => {
        toast.success("Note created");
      },
      onError: (error) => {
        toast.error("Failed to create note", {
          description: error.message || "Please try again.",
        });
      },
      onSettled: () => {
        queryClient.invalidateQueries(trpc.notes.list.queryFilter());
      },
    }),
  );
}
