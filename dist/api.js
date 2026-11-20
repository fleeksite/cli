const PER_PAGE = 100;
function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v) {
    return typeof v === 'string' ? v : v === null || v === undefined ? null : String(v);
}
/** Parse a template as the list/get endpoints serialise it (snake_case, post-shaped). */
export function parseTemplate(v) {
    if (!isObject(v) || typeof v.uid !== 'string')
        throw new Error('template without uid in API response');
    const meta = typeof v.meta === 'string' ? safeJson(v.meta) : v.meta ?? null;
    return {
        uid: v.uid,
        body: typeof v.body === 'string' ? v.body : '',
        type: Number(v.type ?? 5),
        mimeType: str(v.mime_type ?? v.mimeType),
        permalink: str(v.permalink),
        title: str(v.title),
        identifier: str(v.identifier),
        layoutIdentifier: str(v.layout_identifier ?? v.layoutIdentifier),
        label: str(v.label),
        private: v.private === true,
        meta,
        source: str(v.source),
    };
}
export function parseFile(v) {
    if (!isObject(v) || typeof v.uid !== 'string')
        throw new Error('file without uid in API response');
    return {
        uid: v.uid,
        permalink: str(v.permalink),
        source: str(v.source),
        url: String(v.url ?? ''),
        size: v.size === null || v.size === undefined ? null : Number(v.size),
    };
}
function safeJson(s) {
    try {
        return JSON.parse(s);
    }
    catch {
        return s;
    }
}
export function parseRedirect(v) {
    if (!isObject(v))
        throw new Error('bad redirect in API response');
    return {
        id: Number(v.id),
        source: String(v.source ?? v.from_path ?? ''),
        destination: String(v.destination ?? v.to_path ?? ''),
        status: Number(v.status ?? v.status_code ?? 302),
    };
}
/** Body fields for a template write, in the names the API accepts. */
export function templateWriteBody(f) {
    const out = {};
    if (f.source !== undefined)
        out.source = f.source;
    if (f.render !== undefined)
        out.render = f.render;
    if (f.body !== undefined)
        out.body = f.body;
    if (f.type !== undefined)
        out.type = f.type;
    if (f.mimeType !== undefined)
        out.mime_type = f.mimeType;
    if (f.permalink !== undefined)
        out.permalink = f.permalink;
    if (f.title !== undefined)
        out.title = f.title;
    if (f.identifier !== undefined)
        out.identifier = f.identifier;
    if (f.layoutIdentifier !== undefined)
        out.layout_identifier = f.layoutIdentifier;
    if (f.label !== undefined)
        out.label = f.label;
    if (f.private !== undefined)
        out.private = f.private;
    if (f.meta !== undefined)
        out.meta = f.meta;
    return out;
}
export class FleekApi {
    site;
    token;
    fetch;
    constructor(opts) {
        this.site = opts.site.replace(/\/+$/, '');
        this.token = opts.token;
        this.fetch = opts.fetch ?? fetch;
    }
    async call(method, path, body) {
        const res = await this.fetch(`${this.site}/api/v1${path}`, {
            method,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${this.token}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let json = null;
        try {
            json = JSON.parse(text);
        }
        catch {
            /* not JSON */
        }
        // The API sometimes answers 200 with `state: "error"`.
        if (!res.ok || !isObject(json) || json.state === 'error') {
            throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
        }
        return json;
    }
    async listAll(path, parse) {
        const out = [];
        for (let page = 1;; page++) {
            const sep = path.includes('?') ? '&' : '?';
            const json = await this.call('GET', `${path}${sep}per_page=${PER_PAGE}&page=${page}`);
            const data = isObject(json.data) ? json.data : {};
            // Most lists answer `items`; the files list answers `entries`.
            const items = Array.isArray(data.items) ? data.items : Array.isArray(data.entries) ? data.entries : [];
            out.push(...items.map(parse));
            if (items.length < PER_PAGE)
                return out;
        }
    }
    listTemplates() {
        return this.listAll('/templates?order=permalink', parseTemplate);
    }
    async getTemplate(uid) {
        const json = await this.call('GET', `/templates/${encodeURIComponent(uid)}`);
        return parseTemplate(isObject(json.data) ? json.data.item : undefined);
    }
    /** Create; returns the new uid. */
    async createTemplate(f) {
        const json = await this.call('POST', '/templates', templateWriteBody(f));
        const item = isObject(json.data) ? json.data.item : undefined;
        if (!isObject(item) || typeof item.uid !== 'string')
            throw new Error('create template: no uid in response');
        return item.uid;
    }
    async updateTemplate(uid, f) {
        await this.call('PUT', `/templates/${encodeURIComponent(uid)}`, templateWriteBody(f));
    }
    /** Soft delete (sets `deleted`). */
    async deleteTemplate(uid) {
        await this.call('DELETE', `/templates/${encodeURIComponent(uid)}`);
    }
    /** Files uploaded by `fleek deploy` (source `fleek:...`). */
    listBuildFiles() {
        return this.listAll('/files?source=fleek%3A', parseFile);
    }
    /** Upload bytes to the site's media store and register them at `permalink`. */
    async uploadFile(f) {
        const presign = await this.call('POST', '/storage/presign', { filename: f.name, contentType: f.mimeType, size: f.bytes.byteLength });
        const data = isObject(presign.data) ? presign.data : {};
        if (typeof data.uploadUrl !== 'string' || typeof data.cdnUrl !== 'string')
            throw new Error('presign: no upload URL');
        const put = await this.fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': f.mimeType }, body: new Blob([f.bytes]) });
        if (!put.ok)
            throw new Error(`upload ${f.permalink} -> ${put.status}`);
        const json = await this.call('POST', '/files', {
            name: f.name,
            url: data.cdnUrl,
            mime_type: f.mimeType,
            size: f.bytes.byteLength,
            permalink: f.permalink,
            source: f.source,
        });
        return parseFile(isObject(json.data) ? json.data.item : undefined);
    }
    async deleteFile(uid) {
        await this.call('DELETE', `/files/${encodeURIComponent(uid)}`);
    }
    listRedirects() {
        return this.listAll('/redirects', parseRedirect);
    }
    async createRedirect(r) {
        const json = await this.call('POST', '/redirects', { source: r.source, destination: r.destination, statusCode: r.status });
        return parseRedirect(isObject(json.data) ? json.data.item : undefined);
    }
    async updateRedirect(r) {
        const json = await this.call('PUT', `/redirects/${r.id}`, { source: r.source, destination: r.destination, statusCode: r.status });
        return parseRedirect(isObject(json.data) ? json.data.item : undefined);
    }
    async deleteRedirect(id) {
        await this.call('DELETE', `/redirects/${id}`);
    }
}
/** Get a bearer token: FS_TOKEN, or log in with FS_EMAIL + FS_PASSWORD. */
export async function resolveToken(env, site, f = fetch) {
    if (env.FS_TOKEN?.trim())
        return env.FS_TOKEN.trim();
    const email = env.FS_EMAIL;
    const password = env.FS_PASSWORD;
    if (!email || !password)
        throw new Error('Set FS_TOKEN, or FS_EMAIL and FS_PASSWORD.');
    const loginSite = (env.FS_LOGIN_SITE || site).replace(/\/+$/, '');
    const res = await f(`${loginSite}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ session: { email, password } }),
    });
    const json = await res.json().catch(() => null);
    const token = isObject(json) ? (isObject(json.data) ? json.data.token : json.token) : undefined;
    if (!res.ok || typeof token !== 'string')
        throw new Error(`Login failed at ${loginSite}: ${res.status}`);
    return token;
}
