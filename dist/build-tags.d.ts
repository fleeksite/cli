/**
 * `source` tags `fleek deploy` writes on what it uploads. FleekSite reads the
 * same strings: `fleek:asset:` files are served with a year of immutable
 * caching, and both tags let the next deploy find what the last one left.
 */
export declare const BuildSource: {
    readonly Asset: "fleek:asset:";
    readonly Build: "fleek:build:";
};
export type BuildSource = (typeof BuildSource)[keyof typeof BuildSource];
export declare function isBuildFile(source: unknown): boolean;
