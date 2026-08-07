"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTRPC } from "@/trpc/client";

/** Mutation policy hook: invalidate-and-toast, same shape as use-capture-note. */
export function useDeleteNote() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.notes.delete.mutationOptions({
      onSuccess: (deleted) => {
        toast.success(`Deleted "${deleted.title}"`);
      },
      onError: (error) => {
        toast.error("Failed to delete note", {
          description: error.message || "Please try again.",
        });
      },
      onSettled: () => {
        queryClient.invalidateQueries(trpc.notes.list.queryFilter());
      },
    }),
  );
}
