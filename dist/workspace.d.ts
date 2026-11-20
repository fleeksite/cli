import type { LocalSnapshot } from './sync.js';
import { type Manifest, type Redirect } from './types.js';
/** Site copies of conflicting files. Not a template folder, and git-ignored. */
export declare const CONFLICTS_DIR = ".fleek/conflicts";
export declare function emptyManifest(site: string): Manifest;
export declare function readManifest(dir: string): Promise<Manifest | null>;
export declare function writeManifest(dir: string, m: Manifest): Promise<void>;
export declare function readLocal(dir: string): Promise<LocalSnapshot>;
export declare function writeRedirects(dir: string, list: readonly Redirect[]): Promise<void>;
export declare function writeTemplateFile(dir: string, path: string, body: string): Promise<void>;
/** Remove a file and any folders it leaves empty, up to the workspace root. */
export declare function removeTemplateFile(dir: string, path: string): Promise<void>;
export declare function ensureGitattributes(dir: string): Promise<void>;
export declare function writeConflictCopy(dir: string, path: string, body: string): Promise<void>;
export declare function clearConflictCopies(dir: string): Promise<void>;
/** Keep the `.fleek/` working folder out of git. */
export declare function ensureGitignore(dir: string): Promise<void>;
