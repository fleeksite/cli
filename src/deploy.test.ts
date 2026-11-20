import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FleekApi, type Fetch } from './api.js'
import { DeployKind, deploy, isHashedName, permalinkFor, planDeploy } from './deploy.js'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('planDeploy', () => {
  const dist = [
    { rel: 'index.html', bytes: enc('<div id=root></div>') },
    { rel: 'about/index.html', bytes: enc('about') },
    { rel: 'faq.html', bytes: enc('faq') },
    { rel: 'assets/index-CTRkhzia.js', bytes: enc('js') },
    { rel: 'assets/logo-a1b2c3d4.png', bytes: new Uint8Array([137, 80]) },
    { rel: 'robots.txt', bytes: enc('ok') },
  ]
  it('maps a build at the site root', () => {
    const plan = planDeploy(dist, '/', { spa: true })
    const by = Object.fromEntries(plan.map((i) => [i.permalink, i]))
    expect(Object.keys(by).sort()).toEqual(['/*', '/about', '/assets/index-CTRkhzia.js', '/assets/logo-a1b2c3d4.png', '/faq', '/index', '/robots.txt'])
    expect(by['/assets/index-CTRkhzia.js']).toMatchObject({ kind: DeployKind.Template, hashed: true, type: 9, mimeType: 'application/javascript' })
    expect(by['/assets/logo-a1b2c3d4.png']).toMatchObject({ kind: DeployKind.File, hashed: true, mimeType: 'image/png' })
    expect(by['/robots.txt']).toMatchObject({ hashed: false, mimeType: 'text/plain' })
    expect(by['/*']?.catchAll).toBe(true)
    // assets first, catch-all last
    expect(plan.at(-1)?.permalink).toBe('/*')
    expect(plan[0]?.mimeType).not.toBe('text/html')
  })
  it('maps a build under a base path, and skips the catch-all with spa off', () => {
    const plan = planDeploy(dist, 'app/', { spa: false })
    const paths = plan.map((i) => i.permalink)
    expect(paths).toContain('/app')
    expect(paths).toContain('/app/about')
    expect(paths).toContain('/app/assets/index-CTRkhzia.js')
    expect(paths).not.toContain('/app/*')
  })
  it('permalinks for html', () => {
    expect(permalinkFor('index.html', '/')).toBe('/index')
    expect(permalinkFor('docs/index.html', '/app')).toBe('/app/docs')
    expect(permalinkFor('404.html', '/')).toBe('/404')
  })
})

describe('isHashedName', () => {
  it('spots build hashes, not ordinary names', () => {
    for (const n of ['index-CTRkhzia.js', 'index-Bvpj0P8b.css', 'app.79b7557f.js', 'chunk-B-x_9aQ1.js', 'main.3f2a1b9c4d5e6f70.js']) expect(isHashedName(n)).toBe(true)
    for (const n of ['bootstrap-datepicker.js', 'react-dom.production.min.js', 'jquery-3.6.0.min.js', 'Header-Component.js', 'robots.txt', 'index.html']) expect(isHashedName(n)).toBe(false)
  })
})

interface Tpl { uid: string; permalink: string; body: string; mime_type: string; type: number; source: string | null; render: boolean; deleted: boolean; title: string | null }
interface File { uid: string; permalink: string; source: string | null; url: string; size: number }

class FakeSite {
  tpls: Tpl[] = []
  files: File[] = []
  uploads = new Map<string, Uint8Array>()
  calls: string[] = []
  private n = 0

  fetch: Fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    this.calls.push(`${method} ${url.pathname}`)
    if (url.host === 's3.test') {
      this.uploads.set(url.pathname, new Uint8Array(await (init!.body as Blob).arrayBuffer()))
      return new Response('', { status: 200 })
    }
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    const path = url.pathname.replace('/api/v1', '')
    const ok = (data: unknown) => new Response(JSON.stringify({ state: 'ok', data }))
    const page = Number(url.searchParams.get('page') ?? 1)
    const per = Number(url.searchParams.get('per_page') ?? 20)
    const live = this.tpls.filter((t) => !t.deleted)
    if (path === '/templates' && method === 'GET') return ok({ items: live.slice((page - 1) * per, page * per) })
    if (path === '/templates' && method === 'POST') {
      const t: Tpl = { uid: `t${++this.n}`, deleted: false, title: null, ...body }
      this.tpls.push(t)
      return ok({ item: { uid: t.uid } })
    }
    let m = path.match(/^\/templates\/(.+)$/)
    if (m) {
      const t = live.find((x) => x.uid === m![1])!
      if (method === 'PUT') Object.assign(t, body)
      if (method === 'DELETE') t.deleted = true
      return ok({ item: { uid: t.uid } })
    }
    if (path === '/files' && method === 'GET') {
      const src = url.searchParams.get('source') ?? ''
      return ok({ entries: this.files.filter((f) => (f.source ?? '').startsWith(src)).slice((page - 1) * per, page * per) })
    }
    if (path === '/storage/presign') {
      const key = `/k${++this.n}-${body.filename}`
      return ok({ uploadUrl: `https://s3.test${key}`, cdnUrl: `https://cdn.test${key}` })
    }
    if (path === '/files' && method === 'POST') {
      const f: File = { uid: `f${++this.n}`, permalink: body.permalink, source: body.source, url: body.url, size: body.size }
      this.files.push(f)
      return ok({ item: f })
    }
    m = path.match(/^\/files\/(.+)$/)
    if (m && method === 'DELETE') {
      this.files = this.files.filter((f) => f.uid !== m![1])
      return ok({})
    }
    return new Response('nope', { status: 500 })
  }
}

let dist: string
let site: FakeSite
let api: FleekApi
const log = (): void => {}

async function writeDist(files: Record<string, string | Uint8Array>): Promise<void> {
  await rm(dist, { recursive: true, force: true })
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dist, rel)
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, content)
  }
}

beforeEach(async () => {
  dist = await mkdtemp(join(tmpdir(), 'fleek-dist-'))
  site = new FakeSite()
  api = new FleekApi({ site: 'https://demo.fleeksite.com', token: 't', fetch: site.fetch })
})
afterEach(async () => {
  await rm(dist, { recursive: true, force: true })
})

describe('deploy', () => {
  it('deploys a build, then a new build replaces the old hashed assets', async () => {
    await writeDist({ 'index.html': '<script src="/assets/index-CTRkhzia.js"></script>', 'assets/index-CTRkhzia.js': "var esc={'&':'&amp;'}", 'assets/logo-a1b2c3d4.png': new Uint8Array([1, 2, 3]) })
    const first = await deploy(dist, api, log, { base: '/', spa: true, buildId: 'b1' })
    expect(first).toMatchObject({ created: 4, removed: 0 })
    const at = (p: string) => site.tpls.find((t) => !t.deleted && t.permalink === p)
    expect(at('/index')).toMatchObject({ render: false, source: 'fleek:build:b1', mime_type: 'text/html' })
    expect(at('/*')?.body).toBe(at('/index')?.body)
    expect(at('/assets/index-CTRkhzia.js')).toMatchObject({ source: 'fleek:asset:b1', body: "var esc={'&':'&amp;'}" })
    expect(site.files).toHaveLength(1)
    expect([...site.uploads.values()][0]).toEqual(new Uint8Array([1, 2, 3]))

    await writeDist({ 'index.html': '<script src="/assets/index-Zx91kQpa.js"></script>', 'assets/index-Zx91kQpa.js': 'v2', 'assets/logo-a1b2c3d4.png': new Uint8Array([1, 2, 3]) })
    const second = await deploy(dist, api, log, { base: '/', spa: true, buildId: 'b2' })
    expect(second).toMatchObject({ created: 1, updated: 2, unchanged: 1, removed: 1 })
    expect(at('/assets/index-CTRkhzia.js')).toBeUndefined()
    expect(at('/assets/index-Zx91kQpa.js')?.body).toBe('v2')
    expect(site.files).toHaveLength(1) // the unchanged hashed image was not uploaded again
  })

  it('refuses to overwrite a page the site made itself, unless --replace', async () => {
    site.tpls.push({ uid: 'own', permalink: '/index', body: 'my home', mime_type: 'text/html', type: 5, source: null, render: true, deleted: false, title: 'Home' })
    await writeDist({ 'index.html': 'app' })
    await expect(deploy(dist, api, log, { base: '/', spa: true, buildId: 'b1' })).rejects.toThrow(/did not make/)
    expect(site.calls.filter((c) => !c.startsWith('GET'))).toEqual([])
    await deploy(dist, api, log, { base: '/', spa: true, buildId: 'b1', replace: true })
    expect(site.tpls.find((t) => t.uid === 'own')).toMatchObject({ body: 'app', source: 'fleek:build:b1' })
  })

  it('only cleans up under its own base path', async () => {
    await writeDist({ 'index.html': 'root app', 'assets/a-1234abcd.js': 'x' })
    await deploy(dist, api, log, { base: '/', spa: false, buildId: 'r1' })
    await writeDist({ 'index.html': 'sub app' })
    const r = await deploy(dist, api, log, { base: '/app', spa: true, buildId: 's1' })
    expect(r.removed).toBe(0)
    expect(site.tpls.filter((t) => !t.deleted).map((t) => t.permalink).sort()).toEqual(['/app', '/app/*', '/assets/a-1234abcd.js', '/index'])
  })

  it('dry run writes nothing', async () => {
    await writeDist({ 'index.html': 'app', 'logo.png': new Uint8Array([9]) })
    await deploy(dist, api, log, { base: '/', spa: true, dryRun: true, buildId: 'b1' })
    expect(site.calls.every((c) => c.startsWith('GET'))).toBe(true)
  })
})
