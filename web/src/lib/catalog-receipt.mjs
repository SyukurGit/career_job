import path from 'node:path';
import { cachedFileValue } from './stat-file-cache.mjs';

/** A run ID selects only its durable receipt; never fall back to the catalogue. */
export function readCatalogRun(root, runId) {
  if (typeof runId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) return null;
  const receipt = cachedFileValue(path.join(root, 'data', 'scanner-web', 'runs', `${runId}.json`), 'catalog-run', (text) => JSON.parse(text));
  if (!receipt || receipt.runId !== runId || !Array.isArray(receipt.discoveries)) return null;
  return { ...receipt, discoveries: receipt.discoveries.filter((job) => job && typeof job.url === 'string').map((job) => ({ ...job })) };
}
