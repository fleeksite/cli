# Design

## What is synced
Pages, layouts, partials, stylesheets, scripts and other templates, and redirects. Posts, products, customers, uploaded media and site settings stay on FleekSite.

## File layout
- Each file holds a template's content byte for byte (no front matter), so CSS, JS and JSON are untouched.
- `layouts/<name>.html` for layouts; `partials/<title>.html` for templates with no address (looked up by title); `pages/<address>` for everything else. `.html` is added when the address has no extension, and a `:param` part of an address is written `[param]`.
- `fleeksite.json` maps each file to its template id and holds its title, address, identifier, layout, label, privacy and SEO settings. Edit them there.
- Files are matched to templates by id, so two templates whose addresses look the same never share a file; the second gets a short id suffix.
- `.gitattributes` turns off line-ending conversion, so git never rewrites a template.

## Change detection
- `fleeksite.json` records a hash of each template as of the last pull or push. A local change is a difference from that hash, a site change is the site differing from it, and a conflict is both, to different results.
- `pull` brings in site-only changes, new templates and site deletions, and leaves your edits and conflicts alone.
- `push` stops on conflicts unless `--force`, creates new files, updates changed ones and deletes only with `--delete`. After each change it reads the template back so the recorded hash matches the site.
- Moving a file keeps its template: a removed file whose last-known content equals a new file's content is a move, and the address (pages, layouts) or title (partials) follows the new path.

## Deploy
- Text files become templates served exactly as written (no Liquid, no added scripts); images, fonts, video, wasm and pdf go to the site's media storage and are served at their path.
- Uploads are tagged with a build id: `fleek:asset:<build>` for files with a content hash in their name (cached for a year), `fleek:build:<build>` for the rest.
- Order: assets, then pages, then the catch-all page (`/*` or `<base>/*`) that answers deep links, then removal of the previous build's leftovers under the same base. Nothing is written until every address has been checked.
