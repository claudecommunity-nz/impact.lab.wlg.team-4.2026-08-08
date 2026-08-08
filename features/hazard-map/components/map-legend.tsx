"use client";

import { useState } from "react";
import { ChevronDown, Layers, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import type { MapLayer } from "@/use-cases/gis/map-layer-schema";
import { paintFor } from "./layer-paint";

/**
 * Names each layer, counts it, and switches it on and off. Deliberately terse:
 * with five layers the full publisher-and-caveat text made the panel taller
 * than the map was useful. The detail hasn't been dropped — the publisher is in
 * the page footer and the caveat is in every feature popup, both of which are
 * read at the moment they matter.
 *
 * Doubles as the layer filter: the legend already names the layers and shows
 * their colours, so putting the on/off control anywhere else would duplicate
 * that. Presentational — visibility state lives in the -client file, which owns
 * it for the map too. Only the open/closed state is local widget state.
 *
 * Collapsible because it sits over the top-left of the map and hides the city
 * underneath it.
 */
/**
 * Swatch shapes, mirroring the markers drawn on the map. "block" is the
 * fallback for polygon and line layers, which have no marker of their own.
 */
const SWATCH_SHAPE: Record<string, string> = {
  block: "rounded-sm",
  square: "rounded-[3px]",
  circle: "rounded-full",
};

export function MapLegend({
  layers,
  hiddenDatasetIds,
  onToggleDataset,
  failedDatasetIds,
  pendingCount,
}: {
  layers: MapLayer[];
  hiddenDatasetIds: ReadonlySet<string>;
  onToggleDataset: (datasetId: string) => void;
  failedDatasetIds: readonly string[];
  pendingCount: number;
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

      <CollapsibleContent className="px-1.5 pt-0 pb-2">
        {layers.map((layer) => {
          const paint = paintFor(layer.datasetId);
          const visible = !hiddenDatasetIds.has(layer.datasetId);
          return (
            <div key={layer.datasetId}>
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
                className="h-auto w-full justify-start gap-2 px-1.5 py-1 font-normal"
              >
                <span
                  // The swatch takes the layer's marker shape, so the key
                  // describes what is actually drawn rather than a generic box.
                  className={`size-3 shrink-0 border ${SWATCH_SHAPE[paint.marker ?? "block"]}`}
                  style={{
                    // Hollow when off, so the swatch shows the state at a glance
                    // and still identifies the colour it will come back as.
                    backgroundColor: visible ? paint.fill : "transparent",
                    borderColor: paint.outline,
                  }}
                  aria-hidden
                />
                <span
                  className={`flex-1 text-left text-xs ${visible ? "" : "text-muted-foreground"}`}
                >
                  {layer.displayName}
                </span>
                <span className="text-muted-foreground text-[11px] tabular-nums">
                  {layer.featureCollection.features.length}
                </span>
              </Button>
              {/* A shaded layer is only readable if the shades are named, so
                  the classes get one compact row rather than a row each. */}
              {paint.graded && visible && (
                <div className="text-muted-foreground flex items-center gap-1.5 px-1.5 pb-1 pl-8 text-[11px]">
                  <span>Zone</span>
                  {paint.graded.stops.map((stop) => (
                    <span key={stop.label} className="flex items-center gap-1" title={stop.title}>
                      <span
                        className="size-2.5 rounded-[2px] border"
                        style={{ backgroundColor: stop.colour, borderColor: paint.outline }}
                        aria-hidden
                      />
                      {stop.label}
                    </span>
                  ))}
                  <span className="sr-only">
                    {paint.graded.stops.map((s) => s.title).join(", ")}
                  </span>
                </div>
              )}

              {layer.truncated && (
                <p className="text-destructive px-1.5 pb-1 pl-8 text-[11px]">
                  Showing a subset of this layer.
                </p>
              )}
            </div>
          );
        })}

        {/* Layers stream in, so say what's still coming rather than leaving a
            gap the reader might take for "there is nothing here". */}
        {pendingCount > 0 && (
          <p className="text-muted-foreground flex items-center gap-1.5 px-1.5 pt-1 text-[11px]">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Loading {pendingCount} more {pendingCount === 1 ? "layer" : "layers"}…
          </p>
        )}

        {/* A layer that failed to load is a hole in the picture, so it gets
            named rather than just going missing. */}
        {failedDatasetIds.length > 0 && (
          <p className="text-destructive px-1.5 pt-1 text-[11px] leading-snug">
            Couldn&apos;t load: {failedDatasetIds.join(", ")}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
