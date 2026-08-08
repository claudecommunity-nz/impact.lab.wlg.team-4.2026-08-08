/**
 * The use-case layer imports `server-only`, a marker package that throws when it
 * is loaded outside a React Server Component. A CLI *is* a server — Node just
 * has no way to say so — and the alternative condition flag (`--conditions=
 * react-server`) swaps React for its server build and breaks React Query.
 *
 * So neutralise the marker directly. This is loaded via `--require` from the
 * `signals:collect` npm script and is never part of the app bundle.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS preload: this
   file is loaded via `node --require` before any ESM loader exists, so `require`
   is the only option available to it. */
const Module = require("node:module");

const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "server-only") return {};
  return load.call(this, request, ...rest);
};
