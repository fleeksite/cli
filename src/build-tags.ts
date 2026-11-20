/**
 * `source` tags `fleek deploy` writes on what it uploads. FleekSite reads the
 * same strings: `fleek:asset:` files are served with a year of immutable
 * caching, and both tags let the next deploy find what the last one left.
 */
export const BuildSource = {
  Asset: 'fleek:asset:',
  Build: 'fleek:build:',
} as const
export type BuildSource = (typeof BuildSource)[keyof typeof BuildSource]

export function isBuildFile(source: unknown): boolean {
  return typeof source === 'string' && (source.startsWith(BuildSource.Asset) || source.startsWith(BuildSource.Build))
}
