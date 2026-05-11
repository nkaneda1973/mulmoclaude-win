import path from "node:path";
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { WORKSPACE_DIRS, workspacePath } from "../../workspace/paths.js";
import { writeFileAtomicSync } from "./atomic.js";
import { isEnoent } from "./safe.js";
import { log } from "../../system/logger/index.js";

const root = (workspaceRoot?: string) => workspaceRoot ?? workspacePath;

function extrasFilePath(roleId: string, workspaceRoot?: string): string {
  return path.join(root(workspaceRoot), WORKSPACE_DIRS.rolesExtras, `${roleId}.json`);
}

export function readExtras(roleId: string, workspaceRoot?: string): string[] {
  const filePath = extrasFilePath(roleId, workspaceRoot);
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { extraPlugins?: unknown };
    if (!parsed || !Array.isArray(parsed.extraPlugins)) {
      log.warn("roles-extras", "malformed overlay", { roleId, filePath });
      return [];
    }
    return parsed.extraPlugins.filter((plugin): plugin is string => typeof plugin === "string" && plugin.length > 0);
  } catch (err) {
    if (isEnoent(err)) return [];
    // Parse error or unexpected I/O: surface in logs so a corrupted
    // overlay doesn't silently turn into "no extras". Still returns
    // [] so the loader keeps a usable built-in baseline.
    log.warn("roles-extras", "read failed", { roleId, filePath, error: String(err) });
    return [];
  }
}

export function writeExtras(roleId: string, extraPlugins: string[], workspaceRoot?: string): void {
  const dir = path.join(root(workspaceRoot), WORKSPACE_DIRS.rolesExtras);
  mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(extrasFilePath(roleId, workspaceRoot), JSON.stringify({ extraPlugins }, null, 2));
}

// Returns false if not found.
export function deleteExtras(roleId: string, workspaceRoot?: string): boolean {
  try {
    unlinkSync(extrasFilePath(roleId, workspaceRoot));
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    throw err;
  }
}

export function extrasExists(roleId: string, workspaceRoot?: string): boolean {
  try {
    statSync(extrasFilePath(roleId, workspaceRoot));
    return true;
  } catch {
    return false;
  }
}

export function listAllExtras(workspaceRoot?: string): Record<string, string[]> {
  const dir = path.join(root(workspaceRoot), WORKSPACE_DIRS.rolesExtras);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if (isEnoent(err)) return {};
    throw err;
  }
  const out: Record<string, string[]> = {};
  for (const fileName of entries) {
    if (!fileName.endsWith(".json")) continue;
    const roleId = fileName.slice(0, -".json".length);
    const plugins = readExtras(roleId, workspaceRoot);
    if (plugins.length > 0) out[roleId] = plugins;
  }
  return out;
}
