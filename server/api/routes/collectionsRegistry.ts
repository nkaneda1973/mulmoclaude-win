// Read endpoints for the curated collection registry (Discover tab). Backs
// `GET /api/collections-registry` by server-fetching the published index.json
// (receptron/mulmoclaude-collections) and returning its entries. The host never
// exposes the upstream URL to the client; it proxies + caches it.

import { Router, Request, Response } from "express";

import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { fetchRegistryIndex } from "../../workspace/collectionsRegistry/client.js";
import type { RegistryCollectionEntry } from "../../workspace/collectionsRegistry/registryIndex.js";

const router = Router();

interface RegistryListResponse {
  registry: string;
  generatedAt: string;
  /** True when the upstream was unreachable and a previously-cached index is served. */
  stale: boolean;
  collections: RegistryCollectionEntry[];
}

interface ErrorResponse {
  error: string;
}

router.get(API_ROUTES.collectionsRegistry.list, async (_req: Request, res: Response<RegistryListResponse | ErrorResponse>) => {
  const result = await fetchRegistryIndex();
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const { registry, generatedAt, collections } = result.index;
  res.json({ registry, generatedAt, stale: result.stale, collections });
});

export default router;
