/** What a server says about itself for the window showing it: where its code runs from, and whether that is inside an app bundle. */
export interface About {
  /** The directory `server.ts` runs from. */
  source: string;
  /** Inside an app bundle: macOS packs the server under `Contents/Resources`. */
  packed: boolean;
}

export const aboutOf = (source: string): About => ({ source, packed: /\/Contents\/Resources\//.test(source) });
