/**
 * MapLibre v6 spawns its web worker with `new Worker(url, { type: "module" })`
 * where the URL is derived from `import.meta.url` inside the pre-bundled
 * `dist/*.mjs`. Turbopack does not rewrite that, so the browser requests a path
 * Next doesn't serve, gets the HTML 404 page back, and refuses it for MIME
 * mismatch. The worker dies silently: raster tiles still draw on the main
 * thread, but GeoJSON sources never finish loading and nothing vector renders.
 *
 * Fix: serve the worker ourselves from /public and point MapLibre at it with
 * setWorkerUrl() (see features/hazard-map/components/map-canvas.tsx).
 *
 * The worker imports "./maplibre-gl-shared.mjs" relatively, so both files must
 * land in the same directory. They are copied rather than committed so they
 * cannot drift from the installed version; public/maplibre/ is gitignored.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "maplibre-gl", "dist");
const to = join(root, "public", "maplibre");

mkdirSync(to, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(from, file), join(to, file));
}
console.log(`maplibre worker assets copied to public/maplibre/`);
