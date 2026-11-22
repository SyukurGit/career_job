import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as yaml from 'js-yaml';
import { resolveCodeRoot } from './code-root.mjs';
import { isMapping } from '../portals-config.mjs';
import { cachedFileValue } from '../stat-file-cache.mjs';

/** Synchronous shape-only mirror of the core's workplacePolicyFromConfig,
 * parity-tested so Discover cannot turn broken config into an absent policy.
 */
export function workplacePolicyConfig(config) {
  if (!isMapping(config)) throw new Error('portals.yml must contain a YAML mapping');
  if (config.location_filter === undefined) return undefined;
  if (!isMapping(config.location_filter)) throw new Error('location_filter must be an object');
  const policy = config.location_filter.workplace_policy;
  if (policy !== undefined && !isMapping(policy)) throw new Error('location_filter.workplace_policy must be an object');
  return policy;
}

/** Read current user policy and delegate to the same core gate as the scanner.
 * ENOENT keeps legacy/no-policy behavior; invalid files surface as an error.
 */
export async function loadWorkplacePolicy(root, codeRoot = resolveCodeRoot(process.cwd(), process.env)) {
  const override = process.env.CAREER_OPS_PORTALS?.trim();
  const file = override ? path.resolve(root, override) : path.join(root, 'portals.yml');
  const config = cachedFileValue(file, 'workplace-config', (text) => yaml.load(text));
  if (config === null) return () => ({ eligible: true, reason: 'policy_absent' });
  const policy = workplacePolicyConfig(config);
  if (policy === undefined) return () => ({ eligible: true, reason: 'policy_absent' });
  const url = pathToFileURL(path.join(codeRoot, 'providers', '_country.mjs')).href;
  const { buildWorkplacePolicy } = await import(/* webpackIgnore: true */ url);
  return buildWorkplacePolicy(policy);
}

/** Catalogue DTO classification delegates to the scanner's pure policy, rather
 * than treating every remote-board posting as country-authorized. */
export async function loadWorkplaceClassifier(root, codeRoot = resolveCodeRoot(process.cwd(), process.env)) {
  const override = process.env.CAREER_OPS_PORTALS?.trim();
  const file = override ? path.resolve(root, override) : path.join(root, 'portals.yml');
  const config = cachedFileValue(file, 'workplace-config', (text) => yaml.load(text));
  const policy = config === null ? undefined : workplacePolicyConfig(config);
  const url = pathToFileURL(path.join(codeRoot, 'providers', '_country.mjs')).href;
  const { classifyJobWorkplace } = await import(/* webpackIgnore: true */ url);
  if (typeof classifyJobWorkplace !== 'function') throw new Error('Core workplace classifier is unavailable');
  return (offer) => classifyJobWorkplace(offer, policy);
}
