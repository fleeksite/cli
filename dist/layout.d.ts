/**
 * Maps template rows to file paths and back. Pure functions.
 */
import { TemplateKind, type TemplateFields } from './types.js';
/** Template kind for a text file extension (`.js`), or null for anything stored as a file (images, fonts, ...). */
export declare function textKindForExtension(ext: string): {
    type: TemplateKind;
    mimeType: string;
} | null;
/** The preferred path for a template, before collision handling. */
export declare function preferredPath(t: Pick<TemplateFields, 'type' | 'mimeType' | 'permalink' | 'title' | 'identifier'>, uid: string): string;
/** Insert `~<uid8>` before the extension so two rows never share a file. */
export declare function disambiguate(path: string, uid: string): string;
/** Is this path one the CLI manages as a template? */
export declare function isTemplatePath(path: string): boolean;
/**
 * What a file at `path` means when it has no manifest entry (a new file) or was
 * moved there (a rename): its kind, mime type, and permalink or title.
 */
export declare function fieldsForPath(path: string): Pick<TemplateFields, 'type' | 'mimeType' | 'permalink' | 'title' | 'identifier'>;
