"use client";

import { useState } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import type { MapLayer } from "@/use-cases/gis/map-layer-schema";
import { paintFor } from "./layer-paint";

/**
 * Carries each layer's publisher, feature count and caveat because the map is
 * only honest if you can see whose data it is, how much of it loaded, and what
 * it doesn't tell you — and the caveat differs per layer.
 *
 * Doubles as the layer filter: the legend already names the layers and shows
 * their colours, so putting the on/off control anywhere else would duplicate
 * that. Presentational — visibility state lives in the -client file, which owns
 * it for the map too. Only the open/closed state is local widget state.
 *
 * Collapsible because it sits over the top-left of the map and hides the city
 * underneath it. Open by default: the caveats are the point, so you have to
 * choose to dismiss them rather than choose to find them.
 */
export function MapLegend({
  layers,
  hiddenDatasetIds,
  onToggleDataset,
}: {
  layers: MapLayer[];
  hiddenDatasetIds: ReadonlySet<string>;
  onToggleDataset: (datasetId: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      /* Takes pointer events so the trigger and the layer toggles are clickable;
         collapsing it is the way to get at the map underneath. */
      className="bg-background/95 pointer-events-auto absolute top-3 left-3 z-10 max-w-64 rounded-md border shadow-sm backdrop-blur"
    >
      <CollapsibleTrigger className="hover:bg-muted/60 focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none">
        <Layers className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1 text-left">Legend</span>
        {/* No sr-only state text: the trigger carries aria-expanded, so spelling
            out "hide/show" only makes the announced name longer. */}
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-2.5 px-3 pt-0 pb-3">
        {layers.map((layer) => {
          const paint = paintFor(layer.datasetId);
          const visible = !hiddenDatasetIds.has(layer.datasetId);
          return (
            <div key={layer.datasetId} className="space-y-0.5">
              {/*
                A toggle button rather than a checkbox: this repo's checkbox
                primitive renders a <button>, and a <label htmlFor> pointing at
                a button doesn't forward clicks, so the layer name would look
                clickable and not be. aria-pressed carries the state instead.
              */}
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={visible}
                onClick={() => onToggleDataset(layer.datasetId)}
                className="h-auto w-full justify-start gap-2 px-1 py-0.5 font-normal"
              >
                <span
                  className="size-3 shrink-0 rounded-sm border"
                  style={{
                    // Hollow when off, so the swatch shows the state at a glance
                    // and still identifies the colour it will come back as.
                    backgroundColor: visible ? paint.fill : "transparent",
                    borderColor: paint.outline,
                  }}
                  aria-hidden
                />
                <span className={`text-xs font-medium ${visible ? "" : "text-muted-foreground"}`}>
                  {layer.displayName}
                </span>
              </Button>
              <p className="text-muted-foreground pl-5 text-[11px]">
                {layer.featureCollection.features.length} features · {layer.authority}
                {!visible && " · hidden"}
              </p>
              {/* Muted and tight: it must be readable over the map without
                  crowding out the layer names it qualifies. */}
              <p className="text-muted-foreground pl-5 text-[11px] leading-snug text-pretty">
                {layer.caveat}
              </p>
              {layer.truncated && (
                <p className="text-destructive pl-5 text-[11px]">
                  Showing a subset — the server had more features than we requested.
                </p>
              )}
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}
