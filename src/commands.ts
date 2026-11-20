/**
 * pull / status / push. I/O goes through the injected API and workspace dir.
 */
import type { FleekApi } from './api.js'
import {
  assignPaths,
  diffRedirects,
  diffTemplates,
  entryFromRemote,
  pickFields,
  redirectHash,
  renamedFields,
  sha256,
  stableJson,
} from './sync.js'
import { fieldsForPath } from './layout.js'
import {
  ChangeKind,
  type Manifest,
  type Redirect,
  type RedirectChange,
  type RemoteTemplate,
  type TemplateChange,
  type TemplateEntry,
  type TemplateFields,
} from './types.js'
import {
  CONFLICTS_DIR,
  clearConflictCopies,
  emptyManifest,
  ensureGitattributes,
  ensureGitignore,
  writeConflictCopy,
  readLocal,
  readManifest,
  removeTemplateFile,
  writeManifest,
  writeRedirects,
  writeTemplateFile,
} from './workspace.js'

export type Log = (line: string) => void

export interface Report {
  templates: TemplateChange[]
  redirects: RedirectChange[]
}

async function snapshot(dir: string, api: FleekApi, manifest: Manifest): Promise<Report & { local: Awaited<ReturnType<typeof readLocal>> }> {
  const [remoteTemplates, remoteRedirects, local] = await Promise.all([api.listTemplates(), api.listRedirects(), readLocal(dir)])
  const templates = diffTemplates(manifest, local, remoteTemplates)
  assignPaths(templates, new Set([...Object.keys(manifest.templates), ...local.files.keys()]))
  const redirects = diffRedirects(manifest, local.redirects, remoteRedirects)
  return { templates, redirects, local }
}

function describe(c: TemplateChange): string {
  return c.kind === ChangeKind.LocalRenamed ? `${c.fromPath} -> ${c.path}` : c.path
}

export function formatReport(r: Report): string[] {
  const lines: string[] = []
  for (const c of r.templates) if (c.kind !== ChangeKind.Unchanged) lines.push(`${c.kind.padEnd(16)} ${describe(c)}`)
  for (const c of r.redirects) {
    if (c.kind === ChangeKind.Unchanged) continue
    const x = c.local ?? c.remote
    lines.push(`${c.kind.padEnd(16)} redirect ${c.id ?? 'new'} ${x?.source} -> ${x?.destination}`)
  }
  return lines
}

export async function status(dir: string, api: FleekApi, log: Log): Promise<Report> {
  const manifest = await requireManifest(dir)
  const report = await snapshot(dir, api, manifest)
  const lines = formatReport(report)
  for (const l of lines) log(l)
  if (lines.length === 0) log('Up to date.')
  return report
}

async function requireManifest(dir: string): Promise<Manifest> {
  const m = await readManifest(dir)
  if (!m) throw new Error('No fleeksite.json here. Run `fleek pull --site <url>` first.')
  return m
}

export interface PullOptions {
  /** Resolve conflicts by taking the site's version. */
  theirs?: boolean
}

export async function pull(dir: string, api: FleekApi, log: Log, opts: PullOptions = {}): Promise<Report> {
  const manifest = (await readManifest(dir)) ?? emptyManifest(api.site)
  if (manifest.site !== api.site) throw new Error(`This folder is linked to ${manifest.site}, not ${api.site}.`)
  const report = await snapshot(dir, api, manifest)
  await clearConflictCopies(dir)
  let pulled = 0
  const takeTheirs = (c: { kind: ChangeKind }): boolean => c.kind === ChangeKind.Conflict && opts.theirs === true

  for (const c of report.templates) {
    if (takeTheirs(c) && !c.remote) {
      await removeTemplateFile(dir, c.path)
      delete manifest.templates[c.path]
      pulled++
    } else if (c.kind === ChangeKind.RemoteModified || c.kind === ChangeKind.RemoteNew || c.kind === ChangeKind.BothSame || takeTheirs(c)) {
      const r = c.remote!
      if (c.kind !== ChangeKind.BothSame) await writeTemplateFile(dir, c.path, r.body)
      manifest.templates[c.path] = entryFromRemote(r)
      pulled++
    } else if (c.kind === ChangeKind.RemoteDeleted) {
      await removeTemplateFile(dir, c.path)
      delete manifest.templates[c.path]
      pulled++
    } else if (c.kind === ChangeKind.Conflict && c.remote) {
      // Keep the site's copy beside the work so the conflict can be resolved by hand.
      await writeConflictCopy(dir, c.path, c.remote.body)
    }
  }

  const list: Redirect[] = []
  for (const c of report.redirects) {
    if (takeTheirs(c) && !c.remote) {
      delete manifest.redirects[String(c.id)]
      pulled++
    } else if (c.kind === ChangeKind.RemoteModified || c.kind === ChangeKind.RemoteNew || c.kind === ChangeKind.BothSame || takeTheirs(c)) {
      list.push(c.remote!)
      manifest.redirects[String(c.remote!.id)] = redirectHash(c.remote!)
      pulled++
    } else if (c.kind === ChangeKind.RemoteDeleted) {
      delete manifest.redirects[String(c.id)]
      pulled++
    } else if (c.local) {
      list.push(c.local)
    }
  }

  await writeRedirects(dir, list)
  await writeManifest(dir, manifest)
  await ensureGitattributes(dir)
  await ensureGitignore(dir)

  log(`Pulled ${pulled} change(s) from ${api.site}.`)
  if (opts.theirs) return report
  const conflicts = [...report.templates, ...report.redirects].filter((c) => c.kind === ChangeKind.Conflict)
  for (const l of formatReport({ templates: report.templates.filter((c) => c.kind === ChangeKind.Conflict), redirects: report.redirects.filter((c) => c.kind === ChangeKind.Conflict) })) log(l)
  if (conflicts.length) {
    log(`${conflicts.length} conflict(s) left as they are. The site's copies are in ${CONFLICTS_DIR}/.`)
    log('Resolve, then `fleek push --force` (keep yours) or `fleek pull --theirs` (take the site\'s).')
  }
  return report
}

export interface PushOptions {
  dryRun?: boolean
  /** Soft-delete templates (and delete redirects) whose local file/entry was removed. */
  deleteRemoved?: boolean
  /** Let local win over remote changes. */
  force?: boolean
}

/** Fields that differ between the manifest entry and the server copy. `type` cannot change through the API. */
function changedFields(entry: TemplateFields, remote: TemplateFields): Partial<TemplateFields> {
  const a = pickFields(entry)
  const b = pickFields(remote)
  const out: Partial<TemplateFields> = {}
  for (const k of Object.keys(a) as (keyof TemplateFields)[]) {
    if (k === 'type') continue
    if (stableJson(a[k]) !== stableJson(b[k])) (out as Record<string, unknown>)[k] = a[k]
  }
  return out
}

export async function push(dir: string, api: FleekApi, log: Log, opts: PushOptions = {}): Promise<Report> {
  const manifest = await requireManifest(dir)
  if (manifest.site !== api.site) throw new Error(`This folder is linked to ${manifest.site}, not ${api.site}.`)
  const report = await snapshot(dir, api, manifest)

  const conflicts = [...report.templates, ...report.redirects].filter((c) => c.kind === ChangeKind.Conflict)
  if (conflicts.length && !opts.force) {
    for (const l of formatReport({ templates: report.templates.filter((c) => c.kind === ChangeKind.Conflict), redirects: report.redirects.filter((c) => c.kind === ChangeKind.Conflict) })) log(l)
    throw new Error(`${conflicts.length} conflict(s): the site changed since your last pull. Run \`fleek pull\`, or \`fleek push --force\` to overwrite.`)
  }

  const say = (s: string): void => log(opts.dryRun ? `[dry run] ${s}` : s)
  const save = async (): Promise<void> => {
    if (!opts.dryRun) await writeManifest(dir, manifest)
  }
  /** Re-read the server copy so the base, the entry and the file all match it. */
  const settle = async (path: string, uid: string): Promise<void> => {
    const r = await api.getTemplate(uid)
    manifest.templates[path] = entryFromRemote(r)
    await writeTemplateFile(dir, path, r.body)
    await save()
  }
  let pushed = 0

  for (const c of report.templates) {
    const forcing = c.kind === ChangeKind.Conflict && opts.force
    if (c.kind === ChangeKind.LocalModified || c.kind === ChangeKind.LocalRenamed || (forcing && c.localBody !== undefined && c.entry && c.remote)) {
      let entry: TemplateEntry = c.entry!
      if (c.kind === ChangeKind.LocalRenamed) entry = renamedFields(entry, c.path)
      const remote: RemoteTemplate = c.remote!
      const update: Partial<TemplateFields> & { body?: string } = changedFields(entry, remote)
      if (sha256(c.localBody!) !== sha256(remote.body)) update.body = c.localBody
      say(`update ${describe(c)}${Object.keys(update).length ? ` (${Object.keys(update).join(', ')})` : ''}`)
      if (opts.dryRun) continue
      if (Object.keys(update).length) await api.updateTemplate(entry.uid, update)
      if (c.fromPath) delete manifest.templates[c.fromPath]
      await settle(c.path, entry.uid)
      pushed++
    } else if (c.kind === ChangeKind.LocalNew) {
      const f = fieldsForPath(c.path)
      say(`create ${c.path} -> ${f.permalink ?? `partial "${f.title}"`}`)
      if (opts.dryRun) continue
      let uid: string
      if (f.permalink === null) {
        // The create endpoint derives a permalink from a title, which would make a partial a public page.
        uid = await api.createTemplate({ type: f.type, mimeType: f.mimeType, body: c.localBody! })
        await api.updateTemplate(uid, { title: f.title })
      } else {
        uid = await api.createTemplate({ ...f, body: c.localBody! })
      }
      await settle(c.path, uid)
      pushed++
    } else if (c.kind === ChangeKind.LocalDeleted) {
      if (!opts.deleteRemoved) {
        say(`kept on site ${c.path} (removed locally; push with --delete to delete it on the site)`)
        continue
      }
      say(`delete ${c.path}`)
      if (opts.dryRun) continue
      await api.deleteTemplate(c.uid!)
      delete manifest.templates[c.path]
      await save()
      pushed++
    }
  }

  const list: Redirect[] = []
  for (const c of report.redirects) {
    const forcing = c.kind === ChangeKind.Conflict && opts.force
    if (c.kind === ChangeKind.LocalNew) {
      say(`create redirect ${c.local!.source} -> ${c.local!.destination}`)
      if (opts.dryRun) {
        list.push(c.local!)
        continue
      }
      const r = await api.createRedirect(c.local!)
      manifest.redirects[String(r.id)] = redirectHash(r)
      list.push(r)
      pushed++
    } else if ((c.kind === ChangeKind.LocalModified || forcing) && c.local && c.remote) {
      say(`update redirect ${c.id} ${c.local.source} -> ${c.local.destination}`)
      if (opts.dryRun) {
        list.push(c.local)
        continue
      }
      const r = await api.updateRedirect({ ...c.local, id: c.id! })
      manifest.redirects[String(r.id)] = redirectHash(r)
      list.push(r)
      pushed++
    } else if (c.kind === ChangeKind.LocalDeleted) {
      if (!opts.deleteRemoved) {
        say(`kept on site redirect ${c.id} (removed locally; push with --delete to delete it)`)
        continue
      }
      say(`delete redirect ${c.id}`)
      if (opts.dryRun) continue
      await api.deleteRedirect(c.id!)
      delete manifest.redirects[String(c.id)]
      pushed++
    } else if (c.local) {
      list.push(c.local)
    } else if (c.kind !== ChangeKind.RemoteDeleted && c.remote && c.kind !== ChangeKind.RemoteNew) {
      list.push(c.remote)
    }
  }
  if (!opts.dryRun) {
    await writeRedirects(dir, list)
    await save()
  }
  log(opts.dryRun ? 'Dry run: nothing was sent.' : `Pushed ${pushed} change(s) to ${api.site}.`)
  return report
}
