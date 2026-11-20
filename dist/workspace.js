/**
 * Reads and writes a pulled site on disk.
 */
import { mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';
import { parseRedirect } from './api.js';
import { Folder, MANIFEST_FILE, MANIFEST_VERSION, REDIRECTS_FILE } from './types.js';
/** Site copies of conflicting files. Not a template folder, and git-ignored. */
export const CONFLICTS_DIR = '.fleek/conflicts';
const GITATTRIBUTES = '# fleek: template files are stored byte for byte; never let git rewrite them.\n* -text\n';
export function emptyManifest(site) {
    return { version: MANIFEST_VERSION, site, templates: {}, redirects: {} };
}
export async function readManifest(dir) {
    let text;
    try {
        text = await readFile(join(dir, MANIFEST_FILE), 'utf8');
    }
    catch {
        return null;
    }
    const m = JSON.parse(text);
    if (m.version !== MANIFEST_VERSION)
        throw new Error(`${MANIFEST_FILE}: unsupported version ${m.version}`);
    return m;
}
export async function writeManifest(dir, m) {
    const sorted = {
        ...m,
        templates: Object.fromEntries(Object.entries(m.templates).sort(([a], [b]) => a.localeCompare(b))),
        redirects: Object.fromEntries(Object.entries(m.redirects).sort(([a], [b]) => Number(a) - Number(b))),
    };
    await writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
}
async function walk(root, sub, out) {
    let entries;
    try {
        entries = await readdir(join(root, sub), { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const e of entries) {
        if (e.name.startsWith('.'))
            continue;
        const rel = posix.join(sub, e.name);
        if (e.isDirectory())
            await walk(root, rel, out);
        else if (e.isFile())
            out.set(rel, await readFile(join(root, rel), 'utf8'));
    }
}
export async function readLocal(dir) {
    const files = new Map();
    for (const f of Object.values(Folder))
        await walk(dir, f, files);
    let redirects = [];
    try {
        const raw = JSON.parse(await readFile(join(dir, REDIRECTS_FILE), 'utf8'));
        if (!Array.isArray(raw))
            throw new Error(`${REDIRECTS_FILE} must be an array`);
        redirects = raw.map((r) => {
            const p = parseRedirect(r);
            return r.id === undefined ? { ...p, id: undefined } : p;
        });
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            throw err;
    }
    return { files, redirects };
}
export async function writeRedirects(dir, list) {
    const sorted = [...list].sort((a, b) => (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER));
    const plain = sorted.map((r) => (r.id === undefined ? { source: r.source, destination: r.destination, status: r.status } : r));
    await writeFile(join(dir, REDIRECTS_FILE), `${JSON.stringify(plain, null, 2)}\n`);
}
export async function writeTemplateFile(dir, path, body) {
    const abs = join(dir, ...path.split('/'));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body, 'utf8');
}
/** Remove a file and any folders it leaves empty, up to the workspace root. */
export async function removeTemplateFile(dir, path) {
    const abs = join(dir, ...path.split('/'));
    await rm(abs, { force: true });
    let d = dirname(abs);
    while (relative(dir, d) && !relative(dir, d).startsWith('..') && !relative(dir, d).includes(`..${sep}`)) {
        try {
            await rmdir(d);
        }
        catch {
            return;
        }
        d = dirname(d);
    }
}
export async function ensureGitattributes(dir) {
    try {
        await writeFile(join(dir, '.gitattributes'), GITATTRIBUTES, { flag: 'wx' });
    }
    catch (err) {
        if (err.code !== 'EEXIST')
            throw err;
    }
}
export async function writeConflictCopy(dir, path, body) {
    await writeTemplateFile(dir, `${CONFLICTS_DIR}/${path}`, body);
}
export async function clearConflictCopies(dir) {
    await rm(join(dir, ...CONFLICTS_DIR.split('/')), { recursive: true, force: true });
}
/** Keep the `.fleek/` working folder out of git. */
export async function ensureGitignore(dir) {
    const file = join(dir, '.gitignore');
    let text = '';
    try {
        text = await readFile(file, 'utf8');
    }
    catch (err) {
        if (err.code !== 'ENOENT')
            throw err;
    }
    if (text.split(/\r?\n/).some((l) => l.trim() === '.fleek/'))
        return;
    await writeFile(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}.fleek/\n`);
}
