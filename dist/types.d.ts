/**
 * fleek CLI domain types. See docs/DESIGN.md.
 */
/** Template `type` codes as FleekSite stores them. */
export declare const TemplateKind: {
    readonly Layout: 4;
    readonly Page: 5;
    readonly Partial: 6;
    readonly Stylesheet: 8;
    readonly Script: 9;
    readonly Data: 10;
};
export type TemplateKind = (typeof TemplateKind)[keyof typeof TemplateKind];
/** Top-level folders of a pulled site. */
export declare const Folder: {
    readonly Layouts: "layouts";
    readonly Partials: "partials";
    readonly Pages: "pages";
};
export type Folder = (typeof Folder)[keyof typeof Folder];
export declare const MANIFEST_FILE = "fleeksite.json";
export declare const REDIRECTS_FILE = "redirects.json";
export declare const MANIFEST_VERSION = 1;
/** Template fields the CLI manages besides the body. Editable in the manifest. */
export interface TemplateFields {
    type: number;
    mimeType: string | null;
    permalink: string | null;
    title: string | null;
    identifier: string | null;
    layoutIdentifier: string | null;
    label: string | null;
    private: boolean;
    meta: unknown;
}
/** A template as read from the API. */
export interface RemoteTemplate extends TemplateFields {
    uid: string;
    body: string;
    /** `builder:<id>`, `fleek:asset:<build>`, `fleek:build:<build>` or null. Not synced by pull/push. */
    source?: string | null;
}
/** An uploaded file (media store) as read from the API. */
export interface RemoteFile {
    uid: string;
    permalink: string | null;
    source: string | null;
    url: string;
    size: number | null;
}
/** Base hashes as of the last pull or push. */
export interface Base {
    bodyHash: string;
    fieldsHash: string;
}
export interface TemplateEntry extends TemplateFields {
    uid: string;
    base: Base;
}
export interface Redirect {
    id?: number;
    source: string;
    destination: string;
    status: number;
}
export interface Manifest {
    version: number;
    site: string;
    /** File path (posix, relative to the workspace) -> entry. */
    templates: Record<string, TemplateEntry>;
    /** Redirect id -> base hash. */
    redirects: Record<string, string>;
}
/** Where an item stands relative to its base. */
export declare const ChangeKind: {
    readonly Unchanged: "unchanged";
    readonly LocalModified: "local-modified";
    readonly RemoteModified: "remote-modified";
    readonly BothSame: "both-same";
    readonly Conflict: "conflict";
    readonly LocalNew: "local-new";
    readonly LocalDeleted: "local-deleted";
    readonly LocalRenamed: "local-renamed";
    readonly RemoteNew: "remote-new";
    readonly RemoteDeleted: "remote-deleted";
};
export type ChangeKind = (typeof ChangeKind)[keyof typeof ChangeKind];
export interface TemplateChange {
    kind: ChangeKind;
    path: string;
    /** For a rename: the path the entry had. */
    fromPath?: string;
    uid?: string;
    remote?: RemoteTemplate;
    entry?: TemplateEntry;
    localBody?: string;
}
export interface RedirectChange {
    kind: ChangeKind;
    id?: number;
    local?: Redirect;
    remote?: Redirect;
}
