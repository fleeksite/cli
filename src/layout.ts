/**
 * Maps template rows to file paths and back. Pure functions.
 */
import { Folder, TemplateKind, type TemplateFields } from './types.js'

const MIME_EXT: Readonly<Record<string, string>> = {
  'text/html': '.html',
  'text/css': '.css',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'application/json': '.json',
  'text/markdown': '.md',
  'text/xml': '.xml',
  'text/plain': '.txt',
  'image/svg+xml': '.svg',
}

const EXT_KIND: Readonly<Record<string, { type: TemplateKind; mimeType: string }>> = {
  '.html': { type: TemplateKind.Page, mimeType: 'text/html' },
  '.liquid': { type: TemplateKind.Page, mimeType: 'text/html' },
  '.css': { type: TemplateKind.Stylesheet, mimeType: 'text/css' },
  '.js': { type: TemplateKind.Script, mimeType: 'application/javascript' },
  '.json': { type: TemplateKind.Data, mimeType: 'application/json' },
  '.xml': { type: TemplateKind.Data, mimeType: 'text/xml' },
  '.txt': { type: TemplateKind.Data, mimeType: 'text/plain' },
  '.md': { type: TemplateKind.Data, mimeType: 'text/markdown' },
  '.svg': { type: TemplateKind.Data, mimeType: 'image/svg+xml' },
  '.mjs': { type: TemplateKind.Script, mimeType: 'application/javascript' },
  '.map': { type: TemplateKind.Data, mimeType: 'application/json' },
  '.webmanifest': { type: TemplateKind.Data, mimeType: 'application/manifest+json' },
}

/** Template kind for a text file extension (`.js`), or null for anything stored as a file (images, fonts, ...). */
export function textKindForExtension(ext: string): { type: TemplateKind; mimeType: string } | null {
  return EXT_KIND[ext.toLowerCase()] ?? null
}

/** Characters that break on some filesystems. `:` is handled as a route param first. */
function safeSegment(s: string): string {
  const cleaned = [...s].map((ch) => (ch.charCodeAt(0) < 0x20 || '<>"|?*\\'.includes(ch) ? '_' : ch)).join('')
  return cleaned.replace(/^\.+$/, '_')
}

function extOf(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i).toLowerCase() : ''
}

function hasPermalink(permalink: string | null): permalink is string {
  return permalink !== null && permalink.replace(/^\/+|\/+$/g, '') !== ''
}

function permalinkToSegments(permalink: string): string {
  return permalink
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((seg) => (seg.startsWith(':') ? `[${seg.slice(1)}]` : seg))
    .map(safeSegment)
    .join('/')
}

/** The preferred path for a template, before collision handling. */
export function preferredPath(t: Pick<TemplateFields, 'type' | 'mimeType' | 'permalink' | 'title' | 'identifier'>, uid: string): string {
  if (!hasPermalink(t.permalink)) {
    const name = safeSegment((t.title || t.identifier || uid).replace(/\//g, '_'))
    return `${Folder.Partials}/${name}.html`
  }
  const rel = permalinkToSegments(t.permalink)
  if (t.type === TemplateKind.Layout) return `${Folder.Layouts}/${rel}.html`
  const ext = extOf(rel) ? '' : MIME_EXT[(t.mimeType || 'text/html').toLowerCase()] ?? '.html'
  return `${Folder.Pages}/${rel}${ext}`
}

/** Insert `~<uid8>` before the extension so two rows never share a file. */
export function disambiguate(path: string, uid: string): string {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  const tag = `~${uid.slice(0, 8)}`
  return dot > slash ? `${path.slice(0, dot)}${tag}${path.slice(dot)}` : `${path}${tag}`
}

/** Strip a `~<uid8>` collision tag from a file name. */
function stripTag(name: string): string {
  return name.replace(/~[A-Za-z0-9_-]{1,8}(?=\.[^.]+$|$)/, '')
}

/** Is this path one the CLI manages as a template? */
export function isTemplatePath(path: string): boolean {
  const top = path.split('/')[0]
  return top === Folder.Layouts || top === Folder.Partials || top === Folder.Pages
}

/**
 * What a file at `path` means when it has no manifest entry (a new file) or was
 * moved there (a rename): its kind, mime type, and permalink or title.
 */
export function fieldsForPath(path: string): Pick<TemplateFields, 'type' | 'mimeType' | 'permalink' | 'title' | 'identifier'> {
  const [top, ...rest] = path.split('/')
  const rel = stripTag(rest.join('/'))
  const ext = extOf(rel)
  const routeOf = (r: string): string =>
    `/${r
      .split('/')
      .map((seg) => (/^\[.+\]$/.test(seg) ? `:${seg.slice(1, -1)}` : seg))
      .join('/')}`

  if (top === Folder.Partials) {
    const title = rel.slice(0, ext ? -ext.length : undefined)
    return { type: TemplateKind.Partial, mimeType: 'text/html', permalink: null, title, identifier: null }
  }
  if (top === Folder.Layouts) {
    const name = rel.slice(0, ext ? -ext.length : undefined)
    return { type: TemplateKind.Layout, mimeType: 'text/html', permalink: routeOf(name), title: name, identifier: name }
  }
  const kind = EXT_KIND[ext] ?? EXT_KIND['.html']!
  // `.html` is added by the layout, other extensions are part of the URL.
  const route = ext === '.html' || ext === '.liquid' ? rel.slice(0, -ext.length) : rel
  const permalink = routeOf(route)
  return { type: kind.type, mimeType: kind.mimeType, permalink, title: permalink, identifier: null }
}
