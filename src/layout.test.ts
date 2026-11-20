import { describe, expect, it } from 'vitest'
import { disambiguate, fieldsForPath, preferredPath } from './layout.js'
import { TemplateKind } from './types.js'

const row = (over: Partial<Parameters<typeof preferredPath>[0]>) => ({
  type: TemplateKind.Page,
  mimeType: 'text/html',
  permalink: '/about',
  title: 'About',
  identifier: null,
  ...over,
})

describe('preferredPath', () => {
  it('puts pages under pages/ with .html', () => {
    expect(preferredPath(row({}), 'u1')).toBe('pages/about.html')
    expect(preferredPath(row({ permalink: '/index' }), 'u1')).toBe('pages/index.html')
  })
  it('keeps an extension that is part of the URL', () => {
    expect(preferredPath(row({ type: TemplateKind.Stylesheet, mimeType: 'text/css', permalink: '/assets/fleek.css' }), 'u')).toBe('pages/assets/fleek.css')
  })
  it('adds the mime extension when the URL has none', () => {
    expect(preferredPath(row({ type: TemplateKind.Data, mimeType: 'application/json', permalink: '/feed' }), 'u')).toBe('pages/feed.json')
  })
  it('turns route params into [param]', () => {
    expect(preferredPath(row({ permalink: '/:blog' }), 'u')).toBe('pages/[blog].html')
  })
  it('puts layouts under layouts/', () => {
    expect(preferredPath(row({ type: TemplateKind.Layout, permalink: '/layout-2019' }), 'u')).toBe('layouts/layout-2019.html')
  })
  it('treats rows without a permalink (the API cleans null to "/") as partials named by title', () => {
    expect(preferredPath(row({ type: TemplateKind.Partial, permalink: '/', title: 'blog_block' }), 'u')).toBe('partials/blog_block.html')
    expect(preferredPath(row({ permalink: null, title: null, identifier: null }), 'abc')).toBe('partials/abc.html')
  })
  it('makes unsafe characters safe', () => {
    expect(preferredPath(row({ permalink: '/a?b' }), 'u')).toBe('pages/a_b.html')
  })
})

describe('disambiguate', () => {
  it('tags before the extension', () => {
    expect(disambiguate('pages/plans.html', 'abcdef123456')).toBe('pages/plans~abcdef12.html')
    expect(disambiguate('pages/x', 'abcdef123456')).toBe('pages/x~abcdef12')
  })
})

describe('fieldsForPath (new files)', () => {
  it('reverses pages', () => {
    expect(fieldsForPath('pages/about.html')).toMatchObject({ type: TemplateKind.Page, permalink: '/about' })
    expect(fieldsForPath('pages/[blog].html')).toMatchObject({ permalink: '/:blog' })
    expect(fieldsForPath('pages/assets/x.css')).toMatchObject({ type: TemplateKind.Stylesheet, mimeType: 'text/css', permalink: '/assets/x.css' })
    expect(fieldsForPath('pages/plans~abcdef12.html')).toMatchObject({ permalink: '/plans' })
  })
  it('reverses layouts and partials', () => {
    expect(fieldsForPath('layouts/main.html')).toMatchObject({ type: TemplateKind.Layout, permalink: '/main', identifier: 'main' })
    expect(fieldsForPath('partials/header.html')).toMatchObject({ type: TemplateKind.Partial, permalink: null, title: 'header' })
  })
  it('round-trips preferredPath for pages', () => {
    for (const permalink of ['/about', '/:blog', '/developers/api', '/assets/fleek.css']) {
      const ext = permalink.endsWith('.css') ? { type: TemplateKind.Stylesheet, mimeType: 'text/css' } : {}
      expect(fieldsForPath(preferredPath(row({ permalink, ...ext }), 'u')).permalink).toBe(permalink)
    }
  })
})
