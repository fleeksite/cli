import type { FleekApi } from './api.js';
import type { Log } from './commands.js';
export declare const DeployKind: {
    readonly Template: "template";
    readonly File: "file";
};
export type DeployKind = (typeof DeployKind)[keyof typeof DeployKind];
export interface DistFile {
    /** Posix path relative to the build folder. */
    rel: string;
    bytes: Uint8Array;
}
export interface DeployItem {
    rel: string;
    permalink: string;
    kind: DeployKind;
    hashed: boolean;
    /** Template type and mime, or the file's mime. */
    type: number | null;
    mimeType: string;
    bytes: Uint8Array;
    /** True for the SPA catch-all copy of index.html. */
    catchAll?: boolean;
}
/**
 * Is this file content-hashed (`index-CTRkhzia.js`, `app.79b7557f.js`)? The
 * token before the extension must look like a hash: 8+ url-safe characters
 * with a digit, or exactly 8 with two capitals. `bootstrap-datepicker.js` is not.
 */
export declare function isHashedName(rel: string): boolean;
export declare function normaliseBase(base: string): string;
/** The site path a build file is served at. HTML drops `.html` and `index`. */
export declare function permalinkFor(rel: string, base: string): string;
export declare function planDeploy(files: readonly DistFile[], baseIn: string, opts: {
    spa: boolean;
}): DeployItem[];
export declare function readDist(dir: string): Promise<DistFile[]>;
export declare function buildIdFor(files: readonly DistFile[], now?: Date): string;
export interface DeployOptions {
    base: string;
    spa: boolean;
    dryRun?: boolean;
    /** Overwrite pages and files at the build's paths that a fleek deploy did not make. */
    replace?: boolean;
    /** Fixed build id (tests). */
    buildId?: string;
}
export interface DeployReport {
    buildId: string;
    created: number;
    updated: number;
    unchanged: number;
    removed: number;
}
export declare function deploy(distDir: string, api: FleekApi, log: Log, opts: DeployOptions): Promise<DeployReport>;
