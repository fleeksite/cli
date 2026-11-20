/**
 * End-to-end: pull -> edit -> status -> push against an in-memory fake of the
 * site API that mimics the real handlers' quirks (cleaned permalinks, title-
 * derived permalinks on create, `state: "error"` envelopes).
 */
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FleekApi, type Fetch } from './api.js'
import { pull, push, status } from './commands.js'
import { ChangeKind } from './types.js'

interface Row {
  uid: string
  type: number
  mime_type: string | null
  permalink: string | null
  title: string | null
  identifier: string | null
  layout_identifier: string | null
  label: string | null
  private: boolean
  meta: unknown
  body: string | null
  deleted: boolean
}

class FakeSite {
  rows: Row[] = []
  redirects: { id: number; source: string; destination: string; status: number }[] = []
  private n = 0
  private rid = 100
  calls: string[] = []

  add(r: Partial<Row>): Row {
    const row: Row = { uid: `uid-${++this.n}-xxxxxxxx`, type: 5, mime_type: 'text/html', permalink: null, title: null, identifier: null, layout_identifier: null, label: null, private: false, meta: null, body: '', deleted: false, ...r }
    this.rows.push(row)
    return row
  }

  private out(r: Row) {
    // Like formatPost: permalink cleaned to a leading slash, null -> "/".
    return { ...r, permalink: `/${(r.permalink ?? '').replace(/^\/+|\/+$/g, '')}` }
  }

  fetch: Fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const path = url.pathname.replace('/api/v1', '')
    this.calls.push(`${method} ${path}`)
    const ok = (data: unknown) => new Response(JSON.stringify({ state: 'ok', data }), { status: 200 })
    const live = this.rows.filter((r) => !r.deleted)
    const page = Number(url.searchParams.get('page') ?? 1)
    const per = Number(url.searchParams.get('per_page') ?? 20)

    if (path === '/templates' && method === 'GET') return ok({ items: live.slice((page - 1) * per, page * per).map((r) => this.out(r)) })
    if (path === '/templates' && method === 'POST') {
      const permalink = body.permalink || (body.title ? `/${String(body.title).toLowerCase()}` : null)
      const r = this.add({ ...body, permalink, mime_type: body.mime_type ?? null })
      return ok({ item: { uid: r.uid } })
    }
    const m = path.match(/^\/templates\/(.+)$/)
    if (m) {
      const r = live.find((x) => x.uid === decodeURIComponent(m[1]!))
      if (!r) return new Response(JSON.stringify({ state: 'error' }), { status: 404 })
      if (method === 'GET') return ok({ item: this.out(r) })
      if (method === 'PUT') {
        const { type: _t, uid: _u, ...rest } = body
        Object.assign(r, rest)
        return ok({ item: { uid: r.uid } })
      }
      if (method === 'DELETE') {
        r.deleted = true
        return ok({})
      }
    }
    if (path === '/redirects' && method === 'GET') return ok({ items: this.redirects.slice((page - 1) * per, page * per) })
    if (path === '/redirects' && method === 'POST') {
      const r = { id: ++this.rid, source: body.source, destination: body.destination, status: body.statusCode }
      this.redirects.push(r)
      return ok({ item: r })
    }
    const rm2 = path.match(/^\/redirects\/(\d+)$/)
    if (rm2) {
      const id = Number(rm2[1])
      const r = this.redirects.find((x) => x.id === id)
      if (!r) return new Response(JSON.stringify({ state: 'error' }), { status: 404 })
      if (method === 'PUT') {
        Object.assign(r, { source: body.source, destination: body.destination, status: body.statusCode })
        return ok({ item: r })
      }
      if (method === 'DELETE') {
        this.redirects = this.redirects.filter((x) => x !== r)
        return ok({})
      }
    }
    return new Response('nope', { status: 500 })
  }
}

const SITE = 'https://demo.fleeksite.com'
let dir: string
let site: FakeSite
let api: FleekApi
const lines: string[] = []
const log = (l: string): void => {
  lines.push(l)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fleek-'))
  site = new FakeSite()
  api = new FleekApi({ site: SITE, token: 't', fetch: site.fetch })
  lines.length = 0
  site.add({ permalink: '/index', title: 'Home', body: '<h1>{{ site.name }}</h1>\r\n', meta: { title: 'Home' } })
  site.add({ permalink: 'plans', title: 'Plans old', body: 'old plans' })
  site.add({ permalink: '/plans', title: 'Plans', body: 'new plans' })
  site.add({ type: 4, permalink: '/layout', title: 'Layout', identifier: 'layout', body: '<html>{{ content }}</html>' })
  site.add({ type: 6, permalink: null, title: 'blog_block', body: '<article></article>' })
  site.add({ type: 8, mime_type: 'text/css', permalink: '/assets/site.css', title: 'css', body: 'body{}' })
  site.add({ permalink: '/:blog', title: 'Article', body: 'article' })
  site.redirects.push({ id: 1, source: '/old', destination: '/new', status: 301 })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const read = (p: string): Promise<string> => readFile(join(dir, p), 'utf8')

describe('fleek pull/status/push', () => {
  it('pulls every template byte for byte, with collisions kept apart', async () => {
    await pull(dir, api, log)
    expect(await read('pages/index.html')).toBe('<h1>{{ site.name }}</h1>\r\n')
    expect(await read('layouts/layout.html')).toContain('{{ content }}')
    expect(await read('partials/blog_block.html')).toBe('<article></article>')
    expect(await read('pages/assets/site.css')).toBe('body{}')
    expect(await read('pages/[blog].html')).toBe('article')
    const manifest = JSON.parse(await read('fleeksite.json'))
    const plans = Object.keys(manifest.templates).filter((p) => p.startsWith('pages/plans'))
    expect(plans).toHaveLength(2)
    expect(JSON.parse(await read('redirects.json'))).toEqual([{ id: 1, source: '/old', destination: '/new', status: 301 }])
    expect(await read('.gitattributes')).toContain('* -text')

    const r = await status(dir, api, log)
    expect(r.templates.every((c) => c.kind === ChangeKind.Unchanged)).toBe(true)
    expect(lines.at(-1)).toBe('Up to date.')
  })

  it('pushes an edited body, a manifest field, a new page, a new partial and a redirect', async () => {
    await pull(dir, api, log)
    await writeFile(join(dir, 'pages/index.html'), '<h1>Hello</h1>')
    const manifest = JSON.parse(await read('fleeksite.json'))
    manifest.templates['pages/assets/site.css'].title = 'Site styles'
    await writeFile(join(dir, 'fleeksite.json'), JSON.stringify(manifest))
    await writeFile(join(dir, 'pages/contact.html'), 'contact')
    await writeFile(join(dir, 'partials/footer.html'), '<footer></footer>')
    await writeFile(join(dir, 'redirects.json'), JSON.stringify([{ id: 1, source: '/old', destination: '/new', status: 301 }, { source: '/a', destination: '/b', status: 302 }]))

    await push(dir, api, log)

    const byPermalink = (p: string | null, title?: string) => site.rows.find((r) => !r.deleted && r.permalink === p && (title === undefined || r.title === title))
    expect(byPermalink('/index')?.body).toBe('<h1>Hello</h1>')
    expect(byPermalink('/assets/site.css')?.title).toBe('Site styles')
    expect(byPermalink('/contact')?.body).toBe('contact')
    expect(byPermalink('/contact')?.type).toBe(5)
    const footer = site.rows.find((r) => r.title === 'footer')
    expect(footer?.permalink).toBeNull() // a partial must not become a public page
    expect(footer?.type).toBe(6)
    expect(site.redirects.find((r) => r.source === '/a')?.destination).toBe('/b')

    const after = await status(dir, api, log)
    expect(after.templates.every((c) => c.kind === ChangeKind.Unchanged)).toBe(true)
    expect(after.redirects.every((c) => c.kind === ChangeKind.Unchanged)).toBe(true)
  })

  it('moving a file moves the page URL without creating a duplicate', async () => {
    await pull(dir, api, log)
    await mkdir(join(dir, 'pages/articles'))
    await rename(join(dir, 'pages/[blog].html'), join(dir, 'pages/articles/[slug].html'))
    const s = await status(dir, api, log)
    expect(s.templates.find((c) => c.kind === ChangeKind.LocalRenamed)?.path).toBe('pages/articles/[slug].html')
    await push(dir, api, log)
    const live = site.rows.filter((r) => !r.deleted && r.body === 'article')
    expect(live).toHaveLength(1)
    expect(live[0]?.permalink).toBe('/articles/:slug')
  })

  it('refuses to push over a remote change, and pull brings remote-only changes in', async () => {
    await pull(dir, api, log)
    site.rows[0]!.body = 'changed on the dashboard'
    await writeFile(join(dir, 'pages/index.html'), 'changed locally')
    await expect(push(dir, api, log)).rejects.toThrow(/conflict/)
    expect(site.rows[0]!.body).toBe('changed on the dashboard')

    // Pull leaves the conflict alone but brings in other remote changes.
    site.rows[5]!.body = 'body{color:red}'
    await pull(dir, api, log)
    expect(await read('pages/index.html')).toBe('changed locally')
    expect(await read('pages/assets/site.css')).toBe('body{color:red}')

    await push(dir, api, log, { force: true })
    expect(site.rows[0]!.body).toBe('changed locally')
  })

  it('keeps the site copy of a conflict aside, and --theirs takes it', async () => {
    await pull(dir, api, log)
    site.rows[0]!.body = 'dashboard'
    await writeFile(join(dir, 'pages/index.html'), 'mine')
    await pull(dir, api, log)
    expect(await read('pages/index.html')).toBe('mine')
    expect(await read('.fleek/conflicts/pages/index.html')).toBe('dashboard')
    expect(await read('.gitignore')).toContain('.fleek/')
    // The conflicts folder is not a template folder.
    expect((await status(dir, api, log)).templates.filter((c) => c.kind === ChangeKind.LocalNew)).toHaveLength(0)
    await pull(dir, api, log, { theirs: true })
    expect(await read('pages/index.html')).toBe('dashboard')
    expect((await status(dir, api, log)).templates.every((c) => c.kind === ChangeKind.Unchanged)).toBe(true)
  })

  it('deletes on the site only with --delete', async () => {
    await pull(dir, api, log)
    await rm(join(dir, 'pages/assets/site.css'))
    await push(dir, api, log)
    expect(site.rows[5]!.deleted).toBe(false)
    await push(dir, api, log, { deleteRemoved: true })
    expect(site.rows[5]!.deleted).toBe(true)
  })

  it('dry run sends no writes', async () => {
    await pull(dir, api, log)
    await writeFile(join(dir, 'pages/index.html'), 'x')
    site.calls.length = 0
    await push(dir, api, log, { dryRun: true })
    expect(site.calls.every((c) => c.startsWith('GET'))).toBe(true)
  })
})
