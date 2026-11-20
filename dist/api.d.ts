/**
 * Thin client for the FleekSite site API. The site is chosen by host, so every
 * call goes to `<site>/api/v1/...`. The untyped JSON edge is validated here.
 */
import type { Redirect, RemoteFile, RemoteTemplate, TemplateFields } from './types.js';
export type Fetch = typeof fetch;
export interface ApiOptions {
    site: string;
    token: string;
    fetch?: Fetch;
}
type Json = Record<string, unknown>;
/** Parse a template as the list/get endpoints serialise it (snake_case, post-shaped). */
export declare function parseTemplate(v: unknown): RemoteTemplate;
export declare function parseFile(v: unknown): RemoteFile;
/** Extra template fields only `fleek deploy` writes. */
export interface DeployFields {
    source?: string;
    render?: boolean;
}
export declare function parseRedirect(v: unknown): Redirect;
/** Body fields for a template write, in the names the API accepts. */
export declare function templateWriteBody(f: Partial<TemplateFields> & DeployFields & {
    body?: string;
}): Json;
export declare class FleekApi {
    readonly site: string;
    private readonly token;
    private readonly fetch;
    constructor(opts: ApiOptions);
    private call;
    private listAll;
    listTemplates(): Promise<RemoteTemplate[]>;
    getTemplate(uid: string): Promise<RemoteTemplate>;
    /** Create; returns the new uid. */
    createTemplate(f: Partial<TemplateFields> & DeployFields & {
        body: string;
    }): Promise<string>;
    updateTemplate(uid: string, f: Partial<TemplateFields> & DeployFields & {
        body?: string;
    }): Promise<void>;
    /** Soft delete (sets `deleted`). */
    deleteTemplate(uid: string): Promise<void>;
    /** Files uploaded by `fleek deploy` (source `fleek:...`). */
    listBuildFiles(): Promise<RemoteFile[]>;
    /** Upload bytes to the site's media store and register them at `permalink`. */
    uploadFile(f: {
        name: string;
        permalink: string;
        mimeType: string;
        bytes: Uint8Array;
        source: string;
    }): Promise<RemoteFile>;
    deleteFile(uid: string): Promise<void>;
    listRedirects(): Promise<Redirect[]>;
    createRedirect(r: Redirect): Promise<Redirect>;
    updateRedirect(r: Redirect & {
        id: number;
    }): Promise<Redirect>;
    deleteRedirect(id: number): Promise<void>;
}
/** Get a bearer token: FS_TOKEN, or log in with FS_EMAIL + FS_PASSWORD. */
export declare function resolveToken(env: NodeJS.ProcessEnv, site: string, f?: Fetch): Promise<string>;
export {};
