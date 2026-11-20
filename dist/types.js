/**
 * fleek CLI domain types. See docs/DESIGN.md.
 */
/** Template `type` codes as FleekSite stores them. */
export const TemplateKind = {
    Layout: 4,
    Page: 5,
    Partial: 6,
    Stylesheet: 8,
    Script: 9,
    Data: 10,
};
/** Top-level folders of a pulled site. */
export const Folder = {
    Layouts: 'layouts',
    Partials: 'partials',
    Pages: 'pages',
};
export const MANIFEST_FILE = 'fleeksite.json';
export const REDIRECTS_FILE = 'redirects.json';
export const MANIFEST_VERSION = 1;
/** Where an item stands relative to its base. */
export const ChangeKind = {
    Unchanged: 'unchanged',
    LocalModified: 'local-modified',
    RemoteModified: 'remote-modified',
    BothSame: 'both-same',
    Conflict: 'conflict',
    LocalNew: 'local-new',
    LocalDeleted: 'local-deleted',
    LocalRenamed: 'local-renamed',
    RemoteNew: 'remote-new',
    RemoteDeleted: 'remote-deleted',
};
