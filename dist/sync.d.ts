import { type Base, ChangeKind, type Manifest, type Redirect, type RedirectChange, type RemoteTemplate, type TemplateChange, type TemplateEntry, type TemplateFields } from './types.js';
export declare function sha256(s: string): string;
/** JSON with sorted object keys, so field hashes do not depend on key order. */
export declare function stableJson(v: unknown): string;
export declare function pickFields(t: TemplateFields): TemplateFields;
export declare function fieldsHash(t: TemplateFields): string;
export declare function baseOf(t: RemoteTemplate): Base;
export declare function entryFromRemote(t: RemoteTemplate): TemplateEntry;
export declare function redirectHash(r: Redirect): string;
/** Local state of the workspace: template files by path, and redirects.json. */
export interface LocalSnapshot {
    files: ReadonlyMap<string, string>;
    redirects: readonly Redirect[];
}
/**
 * Classify every template. `remote` is null for a status taken without
 * contacting the site (local changes only).
 */
export declare function diffTemplates(manifest: Manifest, local: LocalSnapshot, remote: readonly RemoteTemplate[] | null): TemplateChange[];
/** Give each remote-new template a path that no tracked or local file holds. */
export declare function assignPaths(changes: TemplateChange[], taken: Set<string>): void;
/** Fields of a renamed entry: the permalink (pages, layouts) or title (partials) follows the new path. */
export declare function renamedFields(entry: TemplateEntry, newPath: string): TemplateEntry;
export declare function diffRedirects(manifest: Manifest, local: readonly Redirect[], remote: readonly Redirect[] | null): RedirectChange[];
export declare const CONFLICTING: ReadonlySet<ChangeKind>;
export declare const PUSHABLE: ReadonlySet<ChangeKind>;
export declare const PULLABLE: ReadonlySet<ChangeKind>;
