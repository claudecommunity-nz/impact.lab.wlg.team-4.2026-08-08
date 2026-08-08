import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { SignalSchema, SourceKind, LocationMethod } from "./signal-schema";

/**
 * Thin INTEGRATION use case — one call to GeoNet's quake API.
 *
 * GeoNet publishes natively in WGS84, so unlike the WCC ArcGIS layers there is
 * NO reprojection to do here; the coordinates arrive as lng/lat. The bounds
 * check below is therefore a cheap assertion, not a transform.
 *
 * Filtering note: an earthquake is felt far from its epicentre — the 2016
 * Kaikōura quake was centred ~200 km away and did significant damage in
 * Wellington. Filtering epicentres to the Wellington bbox would discard exactly
 * the events an emergency team cares about, so we filter by DISTANCE from the
 * city instead, with a generous default radius.
 */
export const fetchGeonetQuakeSignalsUseCase = createUseCase(
  {
    id: "fetch-geonet-quake-signals",
    inputSchema: z.object({
      /** Minimum Modified Mercalli intensity. GeoNet accepts 0–8. */
      minMmi: z.number().int().min(0).max(8).optional(),
      /** Epicentre distance from Wellington, km. Quakes are felt far away. */
      radiusKm: z.number().positive().optional(),
      /** Only quakes within this many hours. */
      sinceHours: z.number().positive().optional(),
    }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success, error }, { minMmi, radiusKm, sinceHours, log }) => {
    const mmi = minMmi ?? 3;
    const radius = radiusKm ?? 250;
    const hours = sinceHours ?? 72;

    const response = await fetch(`https://api.geonet.org.nz/quake?MMI=${mmi}`, {
      headers: { accept: "application/vnd.geo+json;version=2" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return error({ message: `GeoNet quake API failed (${response.status})` });
    }

    const body = await response.json();
    const features: unknown[] = Array.isArray(body?.features)
      ? body.features
      : [];
    const collectedAt = new Date();
    const cutoff = collectedAt.getTime() - hours * 3_600_000;

    const signals = features.flatMap((raw) => {
      const feature = raw as {
        geometry?: { coordinates?: [number, number] };
        properties?: {
          publicID?: string;
          time?: string;
          depth?: number;
          magnitude?: number;
          mmi?: number;
          locality?: string;
          quality?: string;
        };
      };

      const coords = feature.geometry?.coordinates;
      const props = feature.properties;
      if (!coords || coords.length < 2 || !props?.publicID) return [];

      const [lng, lat] = coords;
      // GeoNet is natively WGS84 — assert rather than transform.
      if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return [];

      const observedAt = new Date(props.time ?? collectedAt);
      if (observedAt.getTime() < cutoff) return [];

      const distanceKm = distanceFromWellingtonKm(lng, lat);
      if (distanceKm > radius) return [];

      // "deleted" means GeoNet retracted the solution — not a real event.
      if (props.quality === "deleted") return [];

      const magnitude = props.magnitude ?? 0;
      const depth = props.depth ?? 0;
      const locality = props.locality ?? "unknown location";

      /**
       * The text field is what a vector store embeds, and the API gives us
       * structured numbers rather than prose. So we compose a natural-language
       * description — otherwise the embedding would be meaningless.
       *
       * This is machine-composed text over REAL data, which is NOT the same as
       * a synthetic item: `synthetic` stays false, and the composition is
       * declared via a `text_generated` annotation at upload time instead.
       */
      const text =
        `Magnitude ${magnitude.toFixed(1)} earthquake ${locality}, ` +
        `${Math.round(depth)} km deep. Estimated shaking intensity MMI ${props.mmi ?? "unknown"}. ` +
        `Epicentre approximately ${Math.round(distanceKm)} km from Wellington.`;

      return [
        {
          id: `geonet-quake:${props.publicID}`,
          externalId: props.publicID,
          source: "geonet-quakes",
          // Instrument-measured and agency-published.
          sourceKind: SourceKind.Official,
          text,
          // Composed from magnitude/depth/MMI numbers — no human prose exists.
          textGenerated: true,
          observedAt,
          collectedAt,
          location: {
            lng,
            lat,
            // A computed epicentre. Precise, but it is the source of shaking,
            // not the place where impacts occur.
            confidence: 0.9,
            method: LocationMethod.Exact,
            matchedPlace: null,
            locationText: locality,
          },
          locationText: locality,
          hazardType: "earthquake" as const,
          mediaType: "link" as const,
          url: `https://www.geonet.org.nz/earthquake/${props.publicID}`,
          mediaUrl: null,
          quotedUrls: [],
          authorRef: null,
          limitations: [
            `Instrument-measured by GeoNet. Solution quality: ${props.quality ?? "unknown"}.`,
            "The plotted point is the epicentre — impacts occur elsewhere, and shaking is felt well beyond it.",
            "Magnitude and depth are automatic estimates and may be revised.",
            "Description text is composed from GeoNet's structured fields, not written by a person.",
          ],
        },
      ];
    });

    log?.info(
      { kept: signals.length, minMmi: mmi },
      "GeoNet quake signals collected",
    );
    return success(signals);
  },
);

/** Great-circle distance from Wellington CBD, in km. */
function distanceFromWellingtonKm(lng: number, lat: number): number {
  const [wLng, wLat] = [174.7762, -41.2865];
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat - wLat);
  const dLng = toRad(lng - wLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(wLat)) * Math.cos(toRad(lat));
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
