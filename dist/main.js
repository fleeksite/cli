#!/usr/bin/env node
/**
 * fleek — keep a FleekSite site's code in git, and deploy app builds.
 *
 *   fleek pull   --site https://name.fleeksite.com [--dir .] [--theirs]
 *   fleek status [--dir .]
 *   fleek push   [--dir .] [--dry-run] [--delete] [--force]
 *   fleek deploy <build folder> --site <url> [--base /] [--no-spa] [--dry-run] [--replace]
 *
 * Auth: FS_TOKEN, or FS_EMAIL + FS_PASSWORD (FS_LOGIN_SITE to log in elsewhere).
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FleekApi, resolveToken } from './api.js';
import { pull, push, status } from './commands.js';
import { deploy } from './deploy.js';
import { readManifest } from './workspace.js';
const Command = { Pull: 'pull', Status: 'status', Push: 'push', Deploy: 'deploy' };
const USAGE = `usage:
  fleek pull   [--site <url>] [--dir <folder>] [--theirs]
      fetch the site into files (--site the first time; --theirs takes the site's side of conflicts)
  fleek status [--dir <folder>]
      what changed here and on the site
  fleek push   [--dir <folder>] [--dry-run] [--delete] [--force]
      send local changes (--delete removes on the site what you deleted; --force keeps yours in conflicts)
  fleek deploy <build folder> --site <url> [--base /] [--no-spa] [--dry-run] [--replace]
      put a static build (e.g. Vite dist/) on the site; index.html also answers deep links unless --no-spa
auth: FS_TOKEN, or FS_EMAIL + FS_PASSWORD`;
function isCommand(s) {
    return s === Command.Pull || s === Command.Status || s === Command.Push || s === Command.Deploy;
}
async function main(argv) {
    const { positionals, values } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            site: { type: 'string' },
            dir: { type: 'string', default: '.' },
            'dry-run': { type: 'boolean', default: false },
            delete: { type: 'boolean', default: false },
            force: { type: 'boolean', default: false },
            theirs: { type: 'boolean', default: false },
            base: { type: 'string', default: '/' },
            'no-spa': { type: 'boolean', default: false },
            replace: { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
    const cmd = positionals[0];
    if (values.help || !isCommand(cmd)) {
        console.log(USAGE);
        return values.help ? 0 : 2;
    }
    const dir = resolve(values.dir);
    const linked = (await readManifest(dir))?.site;
    const site = (values.site ?? linked)?.replace(/\/+$/, '');
    if (!site) {
        console.error('No site: pass --site https://name.fleeksite.com');
        return 2;
    }
    if (!/^https?:\/\//.test(site)) {
        console.error('--site must be a full URL, e.g. https://name.fleeksite.com');
        return 2;
    }
    const api = new FleekApi({ site, token: await resolveToken(process.env, site) });
    const log = (l) => console.log(l);
    if (cmd === Command.Deploy) {
        const dist = positionals[1];
        if (!dist) {
            console.error('usage: fleek deploy <build folder> --site <url>');
            return 2;
        }
        await deploy(resolve(dist), api, log, { base: values.base, spa: !values['no-spa'], dryRun: values['dry-run'], replace: values.replace });
    }
    else if (cmd === Command.Pull)
        await pull(dir, api, log, { theirs: values.theirs });
    else if (cmd === Command.Status)
        await status(dir, api, log);
    else
        await push(dir, api, log, { dryRun: values['dry-run'], deleteRemoved: values.delete, force: values.force });
    return 0;
}
main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(`fleek: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
