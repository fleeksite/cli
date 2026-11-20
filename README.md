# fleek

Keep your FleekSite site's code in git, and deploy app builds (React, Vite, Astro, Next.js static export) to FleekSite.

```bash
npm install -g https://github.com/fleeksite/cli/archive/refs/tags/v0.1.0.tar.gz
```

In a GitHub Action or script without a global install:

```bash
npx --yes https://github.com/fleeksite/cli/archive/refs/tags/v0.1.0.tar.gz deploy ./dist --site https://yoursite.fleeksite.com
```

Requires Node 20 or newer.

## Sign in

Set a FleekSite API token for the site:

```bash
export FS_TOKEN=...
```

or your FleekSite email and password (`FS_EMAIL`, `FS_PASSWORD`). Tokens are never written to disk.

## Keep a site in git

```bash
fleek pull --site https://yoursite.fleeksite.com --dir my-site
cd my-site && git init && git add -A && git commit -m "Pull my site"

# edit pages, layouts and partials; move a file to move its page
fleek status
fleek push --dry-run
fleek push
```

A pulled site looks like this:

```
fleeksite.json      which file is which page, plus each page's title, address and SEO settings
redirects.json      your redirects
layouts/            site layouts
partials/           pieces included in other pages
pages/              every page, stylesheet and script, at its address on the site
```

| Command | What it does |
|---|---|
| `fleek pull [--site <url>] [--theirs]` | Brings in changes made on the site. Your own edits are kept; when the same file changed on both sides, the site's copy is saved in `.fleek/conflicts/`, and `--theirs` takes it. |
| `fleek status` | Shows what changed here and on the site since your last pull or push. |
| `fleek push [--dry-run] [--delete] [--force]` | Sends your changes. Stops if the site changed the same file since your last pull, unless `--force`. Files you deleted are removed from the site only with `--delete`. |

## Deploy an app

```bash
npm run build
fleek deploy ./dist --site https://yoursite.fleeksite.com --dry-run
fleek deploy ./dist --site https://yoursite.fleeksite.com
```

- Your app's `index.html` also answers every other address on the site, so links like `/users/42` work when opened directly. Use `--no-spa` for multi-page builds (for example a Next.js static export), and `--base /app` to put the app under a path.
- Files with a content hash in their name are cached by browsers for a year.
- The previous deploy's leftover files are removed.
- `fleek deploy` won't overwrite pages you made on the site yourself unless you pass `--replace`.

Server-rendered apps (Next.js or Remix with a server) are not supported yet.

## Develop

```bash
npm install
npm test
npm run fleek -- --help
```

How the files map to your site and how changes are detected: [docs/DESIGN.md](docs/DESIGN.md).

## License

MIT
