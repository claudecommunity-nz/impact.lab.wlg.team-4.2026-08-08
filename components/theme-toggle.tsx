"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

// A store that never changes: the server snapshot is what hydration renders
// against, the client snapshot is what everything after it renders against.
const neverChanges = () => () => {};
const onServer = () => false;
const onClient = () => true;

/**
 * Floating light/dark/system switch, mounted once in the root layout.
 *
 * A toggle group rather than a dropdown: all three states stay visible and one
 * click away, and nothing gets portalled over the page. That second point
 * matters on /map, where MapLibre puts its own controls top-right inside the
 * map container — a popup unfurling across them is a layering problem this
 * shape simply doesn't have.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // The chosen theme is unknowable on the server and during hydration, so the
  // pressed state can only be applied once we are past both — otherwise the
  // markup React hydrates against is a guess. All three buttons render at full
  // size throughout, so nothing shifts when the real selection arrives.
  const hydrated = useSyncExternalStore(neverChanges, onClient, onServer);

  return (
    <ToggleGroup
      aria-label="Colour theme"
      size="sm"
      value={hydrated && theme ? [theme] : []}
      onValueChange={(value) => {
        // Base UI empties the group when you press the already-pressed item;
        // ignoring that keeps exactly one theme selected at all times.
        if (value[0]) setTheme(value[0]);
      }}
      // Positioning belongs to whoever places it — see app/layout.tsx.
      className="bg-background/90 text-foreground rounded-2xl border p-1 shadow-sm backdrop-blur"
    >
      {THEMES.map(({ value, label, Icon }) => (
        <ToggleGroupItem key={value} value={value}>
          <Icon aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
