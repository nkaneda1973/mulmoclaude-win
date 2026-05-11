import path from "node:path";
import { BUILTIN_ROLES, RoleSchema, type Role } from "../../src/config/roles.js";
import { WORKSPACE_DIRS, workspacePath } from "./paths.js";
import { readdirUnderSync, readTextUnderSync } from "../utils/files/workspace-io.js";
import { listAllExtras } from "../utils/files/roles-extras-io.js";

export function loadCustomRoles(): Role[] {
  return readdirUnderSync(workspacePath, WORKSPACE_DIRS.roles)
    .filter((fileName) => fileName.endsWith(".json"))
    .flatMap((fileName) => {
      try {
        const raw = readTextUnderSync(workspacePath, path.posix.join(WORKSPACE_DIRS.roles, fileName));
        if (!raw) return [];
        return [RoleSchema.parse(JSON.parse(raw))];
      } catch {
        return [];
      }
    });
}

// Built-ins with their user-added overlay applied to `availablePlugins`.
// The baseline order is preserved; extras are appended; dedup keeps the
// first occurrence (so a name that's already in the baseline never
// surfaces twice even if persisted to the overlay file).
function applyExtrasToBuiltin(role: Role, extras: string[]): Role {
  if (extras.length === 0) return role;
  const seen = new Set(role.availablePlugins);
  const appended = extras.filter((name) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  if (appended.length === 0) return role;
  return { ...role, availablePlugins: [...role.availablePlugins, ...appended] };
}

export function loadAllRoles(): Role[] {
  const custom = loadCustomRoles();
  const customIds = new Set(custom.map((role) => role.id));
  const extrasByRole = listAllExtras();
  const builtIn = BUILTIN_ROLES.filter((role) => !customIds.has(role.id)).map((role) => applyExtrasToBuiltin(role, extrasByRole[role.id] ?? []));
  return [...builtIn, ...custom];
}

export function getRole(roleId: string): Role {
  return loadAllRoles().find((role) => role.id === roleId) ?? BUILTIN_ROLES[0];
}
