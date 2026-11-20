/**
 * `fleek deploy <dist>` puts a static build (Vite, CRA, Astro or Next
 * static export, ...) on a site.
 *
 * - Text files become templates served as written (render off); binaries go
 *   to the media store and are served at their path.
 * - `index.html` is the page at the base path and, unless `--no-spa`, also a
 *   catch-all (`/*`, `/app/*`) so deep links answer 200.
 * - Content-hashed files are tagged `fleek:asset:<build>` (served with a year
 *   of immutable caching); everything else `fleek:build:<build>`.
 * - Nothing is written until every path is checked: a path held by something
 *   the site made itself (not a fleek deploy) stops the deploy unless
 *   `--replace`.
 * - New assets go up first, pages next, so the live index never points at a
 *   missing file; files of the previous build under the base path are removed
 *   last.
 */
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { FleekApi } from './api.js'
import type { Log } from './commands.js'
import { textKindForExtension } from './layout.js'
import { BuildSource, isBuildFile } from './build-tags.js'
import type { RemoteFile, RemoteTemplate } from './types.js'

/** `source` columns are varchar(30); `fleek:asset:` takes 12. */
const MAX_BUILD_ID = 16

const BINARY_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
}

export const DeployKind = { Template: 'template', File: 'file' } as const
export type DeployKind = (typeof DeployKind)[keyof typeof DeployKind]

export interface DistFile {
  /** Posix path relative to the build folder. */
  rel: string
  bytes: Uint8Array
}

export interface DeployItem {
  rel: string
  permalink: string
  kind: DeployKind
  hashed: boolean
  /** Template type and mime, or the file's mime. */
  type: number | null
  mimeType: string
  bytes: Uint8Array
  /** True for the SPA catch-all copy of index.html. */
  catchAll?: boolean
}

function extOf(rel: string): string {
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i).toLowerCase() : ''
}

/**
 * Is this file content-hashed (`index-CTRkhzia.js`, `app.79b7557f.js`)? The
 * token before the extension must look like a hash: 8+ url-safe characters
 * with a digit, or exactly 8 with two capitals. `bootstrap-datepicker.js` is not.
 */
export function isHashedName(rel: string): boolean {
  const m = rel.match(/[-.]([A-Za-z0-9_-]{8,})\.[A-Za-z0-9]+$/)
  if (!m) return false
  const token = m[1]!
  return /[0-9]/.test(token) || (token.length === 8 && (token.match(/[A-Z]/g) ?? []).length >= 2)
}

export function normaliseBase(base: string): string {
  const b = `/${base.trim().replace(/^\/+|\/+$/g, '')}`
  return b === '/' ? '/' : b
}

function join2(base: string, path: string): string {
  return base === '/' ? `/${path}` : `${base}/${path}`
}

/** The site path a build file is served at. HTML drops `.html` and `index`. */
export function permalinkFor(rel: string, base: string): string {
  if (extOf(rel) !== '.html') return join2(base, rel)
  const route = rel.replace(/\.html$/i, '').replace(/(^|\/)index$/i, '')
  if (route === '') return base === '/' ? '/index' : base
  return join2(base, route)
}

export function planDeploy(files: readonly DistFile[], baseIn: string, opts: { spa: boolean }): DeployItem[] {
  const base = normaliseBase(baseIn)
  const items: DeployItem[] = []
  for (const f of files) {
    const ext = extOf(f.rel)
    const text = textKindForExtension(ext)
    const permalink = permalinkFor(f.rel, base)
    if (text) {
      items.push({ rel: f.rel, permalink, kind: DeployKind.Template, hashed: isHashedName(f.rel), type: text.type, mimeType: text.mimeType, bytes: f.bytes })
    } else {
      items.push({ rel: f.rel, permalink, kind: DeployKind.File, hashed: isHashedName(f.rel), type: null, mimeType: BINARY_MIME[ext] ?? 'application/octet-stream', bytes: f.bytes })
    }
  }
  const index = files.find((f) => f.rel === 'index.html')
  if (opts.spa && index) {
    items.push({ rel: 'index.html', permalink: base === '/' ? '/*' : `${base}/*`, kind: DeployKind.Template, hashed: false, type: 5, mimeType: 'text/html', bytes: index.bytes, catchAll: true })
  }
  // Assets before pages, pages before the catch-all.
  const rank = (i: DeployItem): number => (i.catchAll ? 2 : i.mimeType === 'text/html' ? 1 : 0)
  return items.sort((a, b) => rank(a) - rank(b) || a.permalink.localeCompare(b.permalink))
}

export async function readDist(dir: string): Promise<DistFile[]> {
  const out: DistFile[] = []
  const walk = async (sub: string): Promise<void> => {
    for (const e of await readdir(join(dir, sub), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const rel = sub ? posix.join(sub, e.name) : e.name
      if (e.isDirectory()) await walk(rel)
      else if (e.isFile()) out.push({ rel, bytes: new Uint8Array(await readFile(join(dir, ...rel.split('/')))) })
    }
  }
  await walk('')
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

export function buildIdFor(files: readonly DistFile[], now: Date = new Date()): string {
  const h = createHash('sha256')
  for (const f of files) h.update(f.rel).update(f.bytes)
  const id = `${now.getTime().toString(36)}-${h.digest('hex').slice(0, 6)}`
  return id.slice(0, MAX_BUILD_ID)
}

const norm = (p: string | null | undefined): string => `/${(p ?? '').replace(/^\/+/, '')}`
const underBase = (permalink: string, base: string): boolean =>
  base === '/' || permalink === base || permalink.startsWith(`${base}/`)

export interface DeployOptions {
  base: string
  spa: boolean
  dryRun?: boolean
  /** Overwrite pages and files at the build's paths that a fleek deploy did not make. */
  replace?: boolean
  /** Fixed build id (tests). */
  buildId?: string
}

export interface DeployReport {
  buildId: string
  created: number
  updated: number
  unchanged: number
  removed: number
}

export async function deploy(distDir: string, api: FleekApi, log: Log, opts: DeployOptions): Promise<DeployReport> {
  const files = await readDist(distDir)
  if (!files.length) throw new Error(`${distDir} is empty`)
  const base = normaliseBase(opts.base)
  const buildId = opts.buildId ?? buildIdFor(files)
  const plan = planDeploy(files, base, { spa: opts.spa })
  const [templates, uploaded] = await Promise.all([api.listTemplates(), api.listBuildFiles()])
  const tplAt = new Map<string, RemoteTemplate>(templates.map((t) => [norm(t.permalink), t]))
  const fileAt = new Map<string, RemoteFile>(uploaded.map((f) => [norm(f.permalink), f]))
  const say = (s: string): void => log(opts.dryRun ? `[dry run] ${s}` : s)
  const decoder = new TextDecoder()

  // 1. Check every path before writing anything.
  const blocked = plan.filter((i) => {
    const t = tplAt.get(i.permalink)
    return t && !isBuildFile(t.source) && !opts.replace
  })
  if (blocked.length) {
    for (const i of blocked) log(`in use by the site: ${i.permalink}`)
    throw new Error(`${blocked.length} path(s) hold pages this deploy did not make. Deploy under another --base, or pass --replace to overwrite them.`)
  }

  const report: DeployReport = { buildId, created: 0, updated: 0, unchanged: 0, removed: 0 }
  const tag = (i: DeployItem): string => `${i.hashed ? BuildSource.Asset : BuildSource.Build}${buildId}`

  // 2. Assets, then pages, then the catch-all (plan order).
  for (const i of plan) {
    if (i.kind === DeployKind.Template) {
      const body = decoder.decode(i.bytes)
      const existing = tplAt.get(i.permalink)
      if (existing && existing.body === body && existing.mimeType === i.mimeType) {
        report.unchanged++
        continue
      }
      if (existing) {
        say(`update ${i.permalink}`)
        if (!opts.dryRun) await api.updateTemplate(existing.uid, { body, mimeType: i.mimeType, render: false, source: tag(i) })
        report.updated++
      } else {
        say(`create ${i.permalink}${i.catchAll ? ' (deep links)' : ''}`)
        if (!opts.dryRun) {
          await api.createTemplate({ type: i.type ?? 5, mimeType: i.mimeType, permalink: i.permalink, title: i.catchAll ? `${base} app (all paths)` : i.permalink, body, render: false, source: tag(i) })
        }
        report.created++
      }
    } else {
      const existing = fileAt.get(i.permalink)
      // A hashed name is its content: if it is there, it is this file.
      if (existing && i.hashed) {
        report.unchanged++
        continue
      }
      say(`upload ${i.permalink} (${i.bytes.byteLength} bytes)`)
      if (!opts.dryRun) {
        await api.uploadFile({ name: i.rel.slice(i.rel.lastIndexOf('/') + 1), permalink: i.permalink, mimeType: i.mimeType, bytes: i.bytes, source: tag(i) })
        if (existing) await api.deleteFile(existing.uid)
      }
      if (existing) report.updated++
      else report.created++
    }
  }

  // 3. Remove what the previous build left under this base.
  const live = new Set(plan.map((i) => i.permalink))
  for (const t of templates) {
    const p = norm(t.permalink)
    if (isBuildFile(t.source) && underBase(p, base) && !live.has(p)) {
      say(`remove ${p}`)
      if (!opts.dryRun) await api.deleteTemplate(t.uid)
      report.removed++
    }
  }
  for (const f of uploaded) {
    const p = norm(f.permalink)
    if (underBase(p, base) && !live.has(p)) {
      say(`remove file ${p}`)
      if (!opts.dryRun) await api.deleteFile(f.uid)
      report.removed++
    }
  }

  log(
    `${opts.dryRun ? 'Dry run: would deploy' : 'Deployed'} build ${buildId} to ${api.site}${base === '/' ? '' : base}: ` +
      `${report.created} new, ${report.updated} updated, ${report.unchanged} unchanged, ${report.removed} removed.`,
  )
  return report
}
