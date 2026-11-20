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
} as const
export type TemplateKind = (typeof TemplateKind)[keyof typeof TemplateKind]

/** Top-level folders of a pulled site. */
export const Folder = {
  Layouts: 'layouts',
  Partials: 'partials',
  Pages: 'pages',
} as const
export type Folder = (typeof Folder)[keyof typeof Folder]

export const MANIFEST_FILE = 'fleeksite.json'
export const REDIRECTS_FILE = 'redirects.json'
export const MANIFEST_VERSION = 1

/** Template fields the CLI manages besides the body. Editable in the manifest. */
export interface TemplateFields {
  type: number
  mimeType: string | null
  permalink: string | null
  title: string | null
  identifier: string | null
  layoutIdentifier: string | null
  label: string | null
  private: boolean
  meta: unknown
}

/** A template as read from the API. */
export interface RemoteTemplate extends TemplateFields {
  uid: string
  body: string
  /** `builder:<id>`, `fleek:asset:<build>`, `fleek:build:<build>` or null. Not synced by pull/push. */
  source?: string | null
}

/** An uploaded file (media store) as read from the API. */
export interface RemoteFile {
  uid: string
  permalink: string | null
  source: string | null
  url: string
  size: number | null
}

/** Base hashes as of the last pull or push. */
export interface Base {
  bodyHash: string
  fieldsHash: string
}

export interface TemplateEntry extends TemplateFields {
  uid: string
  base: Base
}

export interface Redirect {
  id?: number
  source: string
  destination: string
  status: number
}

export interface Manifest {
  version: number
  site: string
  /** File path (posix, relative to the workspace) -> entry. */
  templates: Record<string, TemplateEntry>
  /** Redirect id -> base hash. */
  redirects: Record<string, string>
}

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
} as const
export type ChangeKind = (typeof ChangeKind)[keyof typeof ChangeKind]

export interface TemplateChange {
  kind: ChangeKind
  path: string
  /** For a rename: the path the entry had. */
  fromPath?: string
  uid?: string
  remote?: RemoteTemplate
  entry?: TemplateEntry
  localBody?: string
}

export interface RedirectChange {
  kind: ChangeKind
  id?: number
  local?: Redirect
  remote?: Redirect
}
