// Parse + validate the curated collection registry's published index.json.
// Pure — no I/O. The caller fetches the JSON and hands the parsed value here.
// Mirrors the registry repo's schema/index.schema.json contract (schemaVersion 1):
//   receptron/mulmoclaude-collections.
//
// The index is host-fetched convenience data for the Discover catalog, not a
// trust boundary: a collection's actual files are re-validated on import.

import { isRecord } from "../../utils/types.js";

export interface RegistryCollectionEntry {
  /** `<author>/<slug>` — global identity. */
  id: string;
  author: string;
  slug: string;
  title: string;
  icon: string;
  description: string;
  version: string;
  tags: string[];
  license: string;
  fieldCount: number;
  /** Custom view labels. */
  views: string[];
  hasSeed: boolean;
  seedCount: number;
  /** repo-relative path, omitted when absent. */
  screenshot?: string;
  /** repo-relative collection dir. */
  path: string;
  /** Stable bundle hash for update detection. */
  contentSha: string;
}

export interface RegistryIndex {
  schemaVersion: number;
  generatedAt: string;
  registry: string;
  collections: RegistryCollectionEntry[];
}

export type ParseResult = { ok: true; index: RegistryIndex } | { ok: false; error: string };

const SUPPORTED_SCHEMA_VERSION = 1;

const pickString = (rec: Record<string, unknown>, key: string): string | undefined => {
  const value = rec[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const pickNumber = (rec: Record<string, unknown>, key: string): number | undefined => {
  const value = rec[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const pickBoolean = (rec: Record<string, unknown>, key: string): boolean | undefined => {
  const value = rec[key];
  return typeof value === "boolean" ? value : undefined;
};

const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

function parseEntry(value: unknown, index: number): RegistryCollectionEntry | string {
  if (!isRecord(value)) return `collections[${index}] is not an object`;
  const entryId = pickString(value, "id");
  const author = pickString(value, "author");
  const slug = pickString(value, "slug");
  const title = pickString(value, "title");
  const version = pickString(value, "version");
  const path = pickString(value, "path");
  const contentSha = pickString(value, "contentSha");
  if (!entryId || !author || !slug || !title || !version || !path || !contentSha) {
    return `collections[${index}] is missing a required string field (id/author/slug/title/version/path/contentSha)`;
  }
  return {
    id: entryId,
    author,
    slug,
    title,
    version,
    path,
    contentSha,
    icon: pickString(value, "icon") ?? "",
    description: pickString(value, "description") ?? "",
    license: pickString(value, "license") ?? "",
    tags: asStringArray(value.tags),
    views: asStringArray(value.views),
    fieldCount: pickNumber(value, "fieldCount") ?? 0,
    seedCount: pickNumber(value, "seedCount") ?? 0,
    hasSeed: pickBoolean(value, "hasSeed") ?? false,
    screenshot: pickString(value, "screenshot"),
  };
}

export function parseRegistryIndex(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, error: "index is not an object" };
  if (value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return { ok: false, error: `unsupported schemaVersion (expected ${SUPPORTED_SCHEMA_VERSION})` };
  }
  const registry = pickString(value, "registry");
  const generatedAt = pickString(value, "generatedAt");
  if (!registry || !generatedAt) return { ok: false, error: "index missing registry/generatedAt" };
  if (!Array.isArray(value.collections)) return { ok: false, error: "index.collections must be an array" };

  const parsed = value.collections.map(parseEntry);
  const firstError = parsed.find((entry): entry is string => typeof entry === "string");
  if (firstError !== undefined) return { ok: false, error: firstError };
  const collections = parsed.filter((entry): entry is RegistryCollectionEntry => typeof entry !== "string");
  return { ok: true, index: { schemaVersion: SUPPORTED_SCHEMA_VERSION, registry, generatedAt, collections } };
}
