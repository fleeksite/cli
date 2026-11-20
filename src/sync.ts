/**
 * Change detection between the manifest base, local files and the remote site.
 * Pure: no I/O. The CLI feeds it snapshots and applies the result.
 */
import { createHash } from 'node:crypto'
import { disambiguate, fieldsForPath, preferredPath } from './layout.js'
import {
  type Base,
  ChangeKind,
  type Manifest,
  type Redirect,
  type RedirectChange,
  type RemoteTemplate,
  type TemplateChange,
  type TemplateEntry,
  type TemplateFields,
} from './types.js'

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

/** JSON with sorted object keys, so field hashes do not depend on key order. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export function pickFields(t: TemplateFields): TemplateFields {
  return {
    type: t.type,
    mimeType: t.mimeType,
    permalink: t.permalink,
    title: t.title,
    identifier: t.identifier,
    layoutIdentifier: t.layoutIdentifier,
    label: t.label,
    private: t.private,
    meta: t.meta,
  }
}

export function fieldsHash(t: TemplateFields): string {
  return sha256(stableJson(pickFields(t)))
}

export function baseOf(t: RemoteTemplate): Base {
  return { bodyHash: sha256(t.body), fieldsHash: fieldsHash(t) }
}

export function entryFromRemote(t: RemoteTemplate): TemplateEntry {
  return { uid: t.uid, ...pickFields(t), base: baseOf(t) }
}

export function redirectHash(r: Redirect): string {
  return sha256(stableJson({ source: r.source, destination: r.destination, status: r.status }))
}

/** Local state of the workspace: template files by path, and redirects.json. */
export interface LocalSnapshot {
  files: ReadonlyMap<string, string>
  redirects: readonly Redirect[]
}

/**
 * Classify every template. `remote` is null for a status taken without
 * contacting the site (local changes only).
 */
export function diffTemplates(manifest: Manifest, local: LocalSnapshot, remote: readonly RemoteTemplate[] | null): TemplateChange[] {
  const remoteByUid = new Map((remote ?? []).map((t) => [t.uid, t]))
  const changes: TemplateChange[] = []
  const knownUids = new Set<string>()
  const deleted: TemplateChange[] = []

  for (const [path, entry] of Object.entries(manifest.templates)) {
    knownUids.add(entry.uid)
    const body = local.files.get(path)
    const r = remote ? remoteByUid.get(entry.uid) : undefined
    const localChanged = body === undefined || sha256(body) !== entry.base.bodyHash || fieldsHash(entry) !== entry.base.fieldsHash
    const remoteChanged = remote !== null && (!r || sha256(r.body) !== entry.base.bodyHash || fieldsHash(r) !== entry.base.fieldsHash)

    if (body === undefined) {
      const c: TemplateChange = { kind: remoteChanged ? ChangeKind.Conflict : ChangeKind.LocalDeleted, path, uid: entry.uid, entry, remote: r }
      if (!remoteChanged) deleted.push(c)
      else changes.push(c)
      continue
    }
    if (remote !== null && !r) {
      changes.push({ kind: localChanged ? ChangeKind.Conflict : ChangeKind.RemoteDeleted, path, uid: entry.uid, entry, localBody: body })
      continue
    }
    let kind: ChangeKind = ChangeKind.Unchanged
    if (localChanged && remoteChanged) {
      const same = r !== undefined && sha256(r.body) === sha256(body) && fieldsHash(r) === fieldsHash(entry)
      kind = same ? ChangeKind.BothSame : ChangeKind.Conflict
    } else if (localChanged) kind = ChangeKind.LocalModified
    else if (remoteChanged) kind = ChangeKind.RemoteModified
    changes.push({ kind, path, uid: entry.uid, entry, remote: r, localBody: body })
  }

  // New local files; a new file whose body matches a deleted entry's base is a rename.
  const tracked = new Set(Object.keys(manifest.templates))
  for (const [path, body] of local.files) {
    if (tracked.has(path)) continue
    const h = sha256(body)
    const i = deleted.findIndex((d) => d.entry?.base.bodyHash === h)
    if (i >= 0) {
      const [d] = deleted.splice(i, 1)
      changes.push({ kind: ChangeKind.LocalRenamed, path, fromPath: d!.path, uid: d!.uid, entry: d!.entry, remote: d!.remote, localBody: body })
    } else {
      changes.push({ kind: ChangeKind.LocalNew, path, localBody: body })
    }
  }
  changes.push(...deleted)

  for (const r of remote ?? []) {
    if (!knownUids.has(r.uid)) changes.push({ kind: ChangeKind.RemoteNew, path: '', uid: r.uid, remote: r })
  }
  return changes
}

/** Give each remote-new template a path that no tracked or local file holds. */
export function assignPaths(changes: TemplateChange[], taken: Set<string>): void {
  const fresh = changes.filter((c) => c.kind === ChangeKind.RemoteNew && c.remote)
  fresh.sort((a, b) => a.uid!.localeCompare(b.uid!))
  for (const c of fresh) {
    const preferred = preferredPath(c.remote!, c.uid!)
    const lower = (p: string): string => p.toLowerCase() // case-insensitive filesystems (macOS, Windows)
    const takenLower = new Set([...taken].map(lower))
    // A path must not equal another, nor be a parent folder of another.
    const clash = (p: string): boolean => takenLower.has(lower(p)) || [...takenLower].some((t) => t.startsWith(`${lower(p)}/`) || lower(p).startsWith(`${t}/`))
    const path = clash(preferred) ? disambiguate(preferred, c.uid!) : preferred
    c.path = path
    taken.add(path)
  }
}

/** Fields of a renamed entry: the permalink (pages, layouts) or title (partials) follows the new path. */
export function renamedFields(entry: TemplateEntry, newPath: string): TemplateEntry {
  const derived = fieldsForPath(newPath)
  return derived.permalink === null
    ? { ...entry, title: derived.title }
    : { ...entry, permalink: derived.permalink }
}

export function diffRedirects(manifest: Manifest, local: readonly Redirect[], remote: readonly Redirect[] | null): RedirectChange[] {
  const out: RedirectChange[] = []
  const remoteById = new Map((remote ?? []).map((r) => [String(r.id), r]))
  const localById = new Map(local.filter((r) => r.id !== undefined).map((r) => [String(r.id), r]))

  for (const [id, base] of Object.entries(manifest.redirects)) {
    const l = localById.get(id)
    const r = remoteById.get(id)
    const localChanged = !l || redirectHash(l) !== base
    const remoteChanged = remote !== null && (!r || redirectHash(r) !== base)
    let kind: ChangeKind = ChangeKind.Unchanged
    if (!l) kind = remoteChanged ? ChangeKind.Conflict : ChangeKind.LocalDeleted
    else if (remote !== null && !r) kind = localChanged ? ChangeKind.Conflict : ChangeKind.RemoteDeleted
    else if (localChanged && remoteChanged) kind = redirectHash(l) === redirectHash(r!) ? ChangeKind.BothSame : ChangeKind.Conflict
    else if (localChanged) kind = ChangeKind.LocalModified
    else if (remoteChanged) kind = ChangeKind.RemoteModified
    out.push({ kind, id: Number(id), local: l, remote: r })
  }
  for (const l of local) {
    if (l.id === undefined || !(String(l.id) in manifest.redirects)) out.push({ kind: ChangeKind.LocalNew, local: l })
  }
  for (const r of remote ?? []) {
    if (!(String(r.id) in manifest.redirects)) out.push({ kind: ChangeKind.RemoteNew, id: r.id, remote: r })
  }
  return out
}

export const CONFLICTING: ReadonlySet<ChangeKind> = new Set([ChangeKind.Conflict])
export const PUSHABLE: ReadonlySet<ChangeKind> = new Set([
  ChangeKind.LocalModified,
  ChangeKind.LocalNew,
  ChangeKind.LocalDeleted,
  ChangeKind.LocalRenamed,
])
export const PULLABLE: ReadonlySet<ChangeKind> = new Set([
  ChangeKind.RemoteModified,
  ChangeKind.RemoteNew,
  ChangeKind.RemoteDeleted,
  ChangeKind.BothSame,
])
