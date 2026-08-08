import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/trpc/router";

/**
 * The board's view of the API, inferred from the router rather than restated.
 *
 * The published shapes are frozen and additive (fields get added, never renamed
 * — see the vectors and signals routers), so inferring means the board picks up
 * new fields the moment the server grows them and stops compiling the moment
 * anything it depends on actually changes. Hand-written mirrors of these shapes
 * would quietly drift instead.
 */
type Outputs = inferRouterOutputs<AppRouter>;

/** `signals.geojson` — the map layer. */
export type SignalCollection = Outputs["signals"]["geojson"];
export type SignalFeature = SignalCollection["features"][number];
export type SignalProperties = SignalFeature["properties"];
/** Clusters we hold evidence for but cannot place. Never hidden. */
export type UnmappableSignal = SignalCollection["unmappable"][number];

/** `signals.detail` — the drill panel. */
export type SignalDetail = Outputs["signals"]["detail"];
export type ProvenanceEntry = SignalDetail["provenance"][number];

/** `vectors.points` / `vectors.groups` — the galaxy. */
export type GalaxyPoint = Outputs["vectors"]["points"][number];
export type GalaxyGroup = Outputs["vectors"]["groups"][number];
