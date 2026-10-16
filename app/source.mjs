/**
 * Where the app's server comes from. By default the copy packed inside the bundle; with
 * `--source <dir>` (or `--source=<dir>`, or MAVERICK_SOURCE) a checkout on disk, so a person
 * working on Maverick sees their own code in the app's window. Pure, so it can be tested
 * without Electron.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The checkout named on the command line or in the environment, resolved; undefined for the packed copy. */
export const sourceDir = (argv, env = {}) => {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source" && argv[i + 1]) return resolve(argv[i + 1]);
    if (arg.startsWith("--source=") && arg.length > "--source=".length) return resolve(arg.slice("--source=".length));
  }
  return env.MAVERICK_SOURCE ? resolve(env.MAVERICK_SOURCE) : undefined;
};

/** The same arguments with any `--source` taken out, for a relaunch that names a new one or none. */
export const withoutSource = (argv) => argv.filter((a, i, all) => a !== "--source" && !a.startsWith("--source=") && all[i - 1] !== "--source");

/** The module the app imports as its server: the checkout's `server.ts`, or the packed one beside this file. */
export const serverUrl = (source, packed) => pathToFileURL(source ? resolve(source, "server.ts") : packed).href;
