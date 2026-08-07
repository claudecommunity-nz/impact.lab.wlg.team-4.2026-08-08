"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/trpc/client";
import { useCaptureNote } from "@/use-cases/notes/use-capture-note";
import { useDeleteNote } from "@/use-cases/notes/use-delete-note";
import { formatRelativeTime } from "@/utilities/format-relative-time";
import { NotesSkeleton } from "./notes-skeleton";
import { FeatureError } from "@/components/errors/feature-error";

/**
 * The client half — the ONLY place in the feature that touches hooks. Reads go
 * straight through the tRPC proxy; mutations go through the policy hooks.
 *
 * The list is the reference for LONG LISTS: TanStack Virtual with dynamic
 * measurement — only the visible rows exist in the DOM, so 10,000 notes scroll
 * like 10. Trade-off: the virtualizer needs its scroll element, so the list
 * materialises on hydration (header/composer still server-render with real data).
 */
export function NotesClient() {
  const trpc = useTRPC();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const notes = useQuery(trpc.notes.list.queryOptions());
  const captureNote = useCaptureNote();
  const deleteNote = useDeleteNote();

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: notes.data?.length ?? 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => 150, // rough card height; measureElement corrects per row
    overscan: 8,
    getItemKey: (index) => notes.data?.[index]?.id ?? index,
  });

  if (notes.isLoading) return <NotesSkeleton />;
  if (notes.isError || !notes.data) return <FeatureError name="notes" />;

  const submit = () => {
    captureNote.mutate(
      { title: title.trim() === "" ? undefined : title.trim(), content },
      { onSuccess: () => (setTitle(""), setContent("")) },
    );
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Notes</h1>
          <p className="text-muted-foreground text-sm">
            The reference vertical slice — copy this shape for real entities.
          </p>
        </div>
        <Badge variant="secondary">
          {notes.data.length} {notes.data.length === 1 ? "note" : "notes"}
        </Badge>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>New note</CardTitle>
          <CardDescription className="flex items-center gap-1.5">
            <Sparkles className="size-3.5" aria-hidden />
            Leave the title blank and AI writes one from the content.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            placeholder="What's worth remembering?"
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">
              {content.trim().length > 0 ? `${content.trim().length} characters` : " "}
            </span>
            <Button onClick={submit} disabled={captureNote.isPending || content.trim() === ""}>
              {captureNote.isPending ? "Creating…" : "Create note"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {notes.data.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No notes yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Write one above — try leaving the title blank.
          </p>
        </div>
      ) : (
        /* Fixed-height scroll container — the virtualizer's viewport. */
        <div ref={listRef} className="h-[32rem] overflow-y-auto">
          {/* Spacer owns the full scroll height; rows position inside it. */}
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((row) => {
              const note = notes.data[row.index];
              return (
                <div
                  key={row.key}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  {/* Gap lives INSIDE the measured element so row heights include it. */}
                  <div className="pb-3">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">{note.title}</CardTitle>
                        <CardDescription>
                          <time dateTime={note.createdAt.toISOString()}>
                            {formatRelativeTime(note.createdAt)}
                          </time>
                        </CardDescription>
                        <CardAction>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete "${note.title}"`}
                            disabled={deleteNote.isPending}
                            onClick={() => deleteNote.mutate({ id: note.id })}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
