import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { SignalSchema, SourceKind, LocationMethod } from "./signal-schema";
import { classifyHazard, isInWellington } from "./signal-enrichment";
import { queryArcgisUseCase } from "./query-arcgis-use-case";

const LAYER_URL =
  "https://services7.arcgis.com/2ECs938g489DMWjt/arcgis/rest/services/Job_Status_Public_View/FeatureServer/5";

/**
 * BUSINESS-LOGIC use case — composes the ArcGIS integration use case and maps
 * Wellington Water's open fault jobs into signals.
 *
 * Why this source matters more than it looks: records flagged
 * `custservrequestcheck = "Customer Service Request"` are members of the public
 * ringing up to report a problem, captured as an official record with a real
 * timestamp and a real point. That is public reporting arriving through an
 * official channel — unverified in substance, authoritative in provenance —
 * which is exactly the middle of the reliability gradient Problem 03 asks us to
 * make visible. It's also the best corroboration target for social chatter,
 * because a post about a burst main can be matched against an actual job.
 *
 * PRIVACY: descriptions and address fields contain residential street addresses
 * ("Blockage 19 Pringle Street, TAITA"). Those are personal information and this
 * repo is public, so house numbers are stripped here — at collection, not at
 * display, so raw values never reach a log, a cache or a commit.
 */
export const fetchWaterFaultSignalsUseCase = createUseCase(
  {
    id: "fetch-water-fault-signals",
    inputSchema: z.object({
      /** Only jobs reported within this window are treated as current signals. */
      sinceHours: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(2000).optional(),
    }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success, error }, { sinceHours, limit, log }) => {
    const hours = sinceHours ?? 72;
    const result = await queryArcgisUseCase({
      layerUrl: LAYER_URL,
      // Open jobs only; ArcGIS date literals need this form.
      where: `actfinish IS NULL AND reportdate > CURRENT_TIMESTAMP - INTERVAL '${hours}' HOUR`,
      resultRecordCount: limit ?? 200,
      log,
    });

    if (result.error) return error(result.error);

    const collectedAt = new Date();

    const signals = result.data.features.flatMap((feature) => {
      const f = feature as {
        geometry?: { type?: string; coordinates?: [number, number] };
        properties?: Record<string, unknown>;
      };

      const props = f.properties ?? {};
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) return [];

      const [lng, lat] = coords;
      if (!isInWellington(lng, lat)) return [];

      const description = redactStreetNumbers(
        String(props.description ?? "Water network fault"),
      );
      const commodity = String(props.comm_description ?? "");
      const waterType = String(props.watertype ?? "");
      const objectId = String(props.OBJECTID ?? props.wonum ?? `${lng},${lat}`);

      const isPublicReport =
        props.custservrequestcheck === "Customer Service Request";
      const text = [description, waterType, commodity]
        .filter(Boolean)
        .join(" · ");

      const reportedAt =
        typeof props.reportdate === "number"
          ? new Date(props.reportdate)
          : collectedAt;

      return [
        {
          id: `water-fault:${objectId}`,
          externalId: String(props.wonum ?? objectId),
          source: "wellington-water-faults",
          // A public report captured officially — not an agency assertion.
          sourceKind: isPublicReport
            ? SourceKind.OfficialCrowd
            : SourceKind.Official,
          text,
          observedAt: reportedAt,
          collectedAt,
          location: {
            lng,
            lat,
            // Publisher-supplied point, reprojected server-side from NZTM2000.
            confidence: 0.95,
            method: LocationMethod.Reprojected,
            matchedPlace: null,
            locationText:
              redactStreetNumbers(String(props.wsadd_formattedaddress ?? "")) ||
              null,
          },
          locationText:
            redactStreetNumbers(String(props.wsadd_formattedaddress ?? "")) ||
            null,
          hazardType:
            classifyHazard(`${text} ${waterType}`) === "other"
              ? "water"
              : classifyHazard(`${text} ${waterType}`),
          mediaType: "none" as const,
          url: null,
          mediaUrl: null,
          quotedUrls: [],
          authorRef: null,
          limitations: [
            isPublicReport
              ? "Public report logged through Wellington Water's customer channel — recorded by an official system, but the underlying report is unverified."
              : "Operational maintenance record from Wellington Water.",
            "Street numbers removed to avoid publishing personal information.",
            `Status: ${String(props.StatusDescription ?? "unknown")}. An open job is not necessarily an active emergency.`,
          ],
        },
      ];
    });

    if (result.data.exceededTransferLimit) {
      log?.warn(
        { layer: "water-faults" },
        "ArcGIS truncated the response — results are incomplete",
      );
    }

    log?.info(
      { kept: signals.length, sinceHours },
      "Water fault signals collected",
    );
    return success(signals);
  },
);

/**
 * Remove leading house numbers from an address or description string.
 * "Blockage 19 Pringle Street, TAITA" → "Blockage Pringle Street, TAITA"
 * "Fault 40 THE TERRACE" → "Fault THE TERRACE"
 *
 * The street and suburb are enough to cluster a signal; the house number
 * identifies a household. Street names appear in both Title Case and ALL CAPS
 * in this feed, so the match is case-insensitive — an earlier version only
 * handled Title Case and leaked numbers like "40 THE TERRACE".
 *
 * Measurements ("50 mm main") are preserved, since those are not personal.
 */
const UNIT_WORDS =
  /^(mm|cm|m|km|kpa|psi|l|ml|hr|hrs|hour|hours|min|mins|deg|inch|in|ft)\b/i;

function redactStreetNumbers(value: string): string {
  return (
    value
      // Optional unit/flat prefix ranges: "19A-21", "2/14".
      .replace(
        /\b\d{1,5}[A-Za-z]?(?:\s*[-/]\s*\d{1,5}[A-Za-z]?)?\s+(?=[A-Za-z])/g,
        (match, offset, full) => {
          const rest = String(full).slice(Number(offset) + match.length);
          // Keep numbers that qualify a unit of measurement.
          return UNIT_WORDS.test(rest) ? match : "";
        },
      )
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}
