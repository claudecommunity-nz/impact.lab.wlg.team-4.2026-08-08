import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

/**
 * Skeleton rule: ONLY the awaited data gets Skeleton blocks. Static chrome —
 * heading, composer form, card frames — renders for real (inert), so the
 * loading state looks like the page, not a wireframe of it.
 */
export function NotesSkeleton() {
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 p-6">
      {/* Static chrome — renders for real. Only the count is data: skeleton it. */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Notes</h1>
          <p className="text-muted-foreground text-sm">
            The reference vertical slice — copy this shape for real entities.
          </p>
        </div>
        <Badge variant="secondary">
          <Skeleton className="h-3 w-12" />
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
          <Input placeholder="Title (optional)" disabled />
          <Textarea placeholder="What's worth remembering?" rows={3} disabled />
          <div className="flex justify-end">
            <Button disabled>Create note</Button>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Dynamic: the notes list is what we're waiting for — skeleton it. */}
      <ul className="space-y-3">
        {[0, 1].map((i) => (
          <li key={i}>
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-44" />
                <Skeleton className="mt-1 h-3.5 w-24" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
