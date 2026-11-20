/**
 * pull / status / push. I/O goes through the injected API and workspace dir.
 */
import type { FleekApi } from './api.js';
import { type RedirectChange, type TemplateChange } from './types.js';
export type Log = (line: string) => void;
export interface Report {
    templates: TemplateChange[];
    redirects: RedirectChange[];
}
export declare function formatReport(r: Report): string[];
export declare function status(dir: string, api: FleekApi, log: Log): Promise<Report>;
export interface PullOptions {
    /** Resolve conflicts by taking the site's version. */
    theirs?: boolean;
}
export declare function pull(dir: string, api: FleekApi, log: Log, opts?: PullOptions): Promise<Report>;
export interface PushOptions {
    dryRun?: boolean;
    /** Soft-delete templates (and delete redirects) whose local file/entry was removed. */
    deleteRemoved?: boolean;
    /** Let local win over remote changes. */
    force?: boolean;
}
export declare function push(dir: string, api: FleekApi, log: Log, opts?: PushOptions): Promise<Report>;
