/**
 * `source` tags `fleek deploy` writes on what it uploads. FleekSite reads the
 * same strings: `fleek:asset:` files are served with a year of immutable
 * caching, and both tags let the next deploy find what the last one left.
 */
export const BuildSource = {
    Asset: 'fleek:asset:',
    Build: 'fleek:build:',
};
export function isBuildFile(source) {
    return typeof source === 'string' && (source.startsWith(BuildSource.Asset) || source.startsWith(BuildSource.Build));
}
