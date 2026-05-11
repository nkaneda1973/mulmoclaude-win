import { Router, Request, Response } from "express";
import { getSessionQuery } from "../../utils/request.js";
import { loadCustomRoles } from "../../workspace/roles.js";
import { BUILTIN_ROLES, type Role } from "../../../src/config/roles.js";
import { pushSessionEvent } from "../../events/session-store/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { EVENT_TYPES } from "../../../src/types/events.js";
import { roleExists, deleteRole, saveRole } from "../../utils/files/roles-io.js";
import { deleteExtras, listAllExtras, writeExtras } from "../../utils/files/roles-extras-io.js";
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";

const BUILTIN_IDS = new Set(BUILTIN_ROLES.map((role) => role.id));
const BUILTIN_BASELINE = new Map(BUILTIN_ROLES.map((role) => [role.id, new Set(role.availablePlugins)] as const));

const router = Router();

export interface RolesListResponse {
  customRoles: Role[];
  builtInExtras: Record<string, string[]>;
}

function buildListResponse(): RolesListResponse {
  return {
    customRoles: loadCustomRoles(),
    builtInExtras: listAllExtras(),
  };
}

router.get(API_ROUTES.roles.list, (_req: Request, res: Response<RolesListResponse>) => {
  res.json(buildListResponse());
});

router.post(API_ROUTES.roles.manage, async (req: Request, res: Response<Record<string, unknown>>) => {
  const session = getSessionQuery(req);
  const action = typeof req.body?.action === "string" ? req.body.action : undefined;
  const roleId = typeof req.body?.roleId === "string" ? req.body.roleId : typeof req.body?.role?.id === "string" ? req.body.role.id : undefined;
  log.info("roles", "manage: start", { action: action ? previewSnippet(action) : undefined, roleId: roleId ? previewSnippet(roleId) : undefined });
  const result = await executeManageRoles(req.body, session);
  if (result.success === false) {
    log.warn("roles", "manage: error", { action, roleId, error: result.error });
  } else {
    log.info("roles", "manage: ok", { action, roleId });
  }
  res.json(result);
});

export default router;

function notifyRolesUpdated(chatSessionId: string): void {
  pushSessionEvent(chatSessionId, { type: EVENT_TYPES.rolesUpdated });
}

interface ManageRolesInput {
  action: string;
  role?: {
    id: string;
    name: string;
    icon: string;
    prompt: string;
    availablePlugins: string[];
    queries?: string[];
  };
  roleId?: string;
  oldRoleId?: string;
  extraPlugins?: string[];
}

function listRolesResult(): Record<string, unknown> {
  const data = buildListResponse();
  const count = data.customRoles.length;
  return {
    success: true,
    message: `${count} custom role${count !== 1 ? "s" : ""}.`,
    data,
  };
}

function deleteRoleResult(roleId: string | undefined, sessionId: string): Record<string, unknown> {
  if (!roleId) return { success: false, error: "roleId is required for delete action" };
  if (BUILTIN_IDS.has(roleId)) {
    return { success: false, error: "Cannot delete built-in roles." };
  }
  if (!roleExists(roleId)) {
    return { success: false, error: `Role '${roleId}' not found.` };
  }
  deleteRole(roleId);
  notifyRolesUpdated(sessionId);
  return {
    success: true,
    message: `Role '${roleId}' deleted.`,
    ...buildListResponse(),
  };
}

function validateSaveInput(input: ManageRolesInput): { role: NonNullable<ManageRolesInput["role"]>; isRename: boolean } | string {
  const { action, role, oldRoleId } = input;
  if (!role) return "role definition required for create/update";
  if (!role.id) return "role.id is required";

  // Rename is strictly an update-with-different-id. Gating on
  // action === "update" means a malformed create payload that
  // happens to include `oldRoleId` cannot silently delete an
  // unrelated file via the rename cleanup below.
  const isRename = Boolean(action === "update" && oldRoleId && oldRoleId !== role.id);
  if (BUILTIN_IDS.has(role.id) && (action === "create" || isRename)) {
    return `ID '${role.id}' is reserved for a built-in role.`;
  }
  if ((action === "create" || isRename) && roleExists(role.id)) {
    return `A role with ID '${role.id}' already exists.`;
  }
  return { role, isRename };
}

function saveRoleResult(input: ManageRolesInput, sessionId: string): Record<string, unknown> {
  const validated = validateSaveInput(input);
  if (typeof validated === "string") {
    return { success: false, error: validated };
  }
  const { role, isRename } = validated;
  const { action, oldRoleId } = input;

  saveRole(role.id, role);
  // On rename, remove the old file even if its id matches a built-in —
  // a file at `config/roles/<builtin>.json` is a user-created override,
  // not the built-in itself (which lives in BUILTIN_ROLES). Leaving it
  // behind would shadow the built-in and couldn't be cleaned up via
  // `delete`, which also rejects built-in ids.
  if (isRename && oldRoleId && roleExists(oldRoleId)) {
    deleteRole(oldRoleId);
  }
  notifyRolesUpdated(sessionId);
  return {
    success: true,
    message: `Role '${role.name}' ${action}d successfully.`,
    ...buildListResponse(),
  };
}

// Filter the user-supplied extras list down to what actually gets
// persisted: non-empty strings, none from the built-in baseline
// (the baseline is always applied by the loader, so persisting it
// would be a duplicate), dedup preserving first-seen order.
function cleanExtraPlugins(extraPlugins: readonly unknown[], baseline: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const name of extraPlugins) {
    if (typeof name !== "string" || name.length === 0) continue;
    if (baseline.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    cleaned.push(name);
  }
  return cleaned;
}

function extendBuiltinResult(input: ManageRolesInput, sessionId: string): Record<string, unknown> {
  const { roleId, extraPlugins } = input;
  if (!roleId) return { success: false, error: "roleId is required for extendBuiltin action" };
  if (!BUILTIN_IDS.has(roleId)) {
    return { success: false, error: `Role '${roleId}' is not a built-in role.` };
  }
  if (!Array.isArray(extraPlugins)) {
    return { success: false, error: "extraPlugins (string[]) is required for extendBuiltin action" };
  }
  const cleaned = cleanExtraPlugins(extraPlugins, BUILTIN_BASELINE.get(roleId) ?? new Set<string>());
  if (cleaned.length === 0) {
    deleteExtras(roleId);
  } else {
    writeExtras(roleId, cleaned);
  }
  notifyRolesUpdated(sessionId);
  return {
    success: true,
    message:
      cleaned.length === 0
        ? `Cleared extra plugins for '${roleId}'.`
        : `Saved ${cleaned.length} extra plugin${cleaned.length !== 1 ? "s" : ""} for '${roleId}'.`,
    ...buildListResponse(),
  };
}

export async function executeManageRoles(input: ManageRolesInput, sessionId: string): Promise<Record<string, unknown>> {
  if (input.action === "list") return listRolesResult();
  if (input.action === "delete") return deleteRoleResult(input.roleId, sessionId);
  if (input.action === "extendBuiltin") return extendBuiltinResult(input, sessionId);
  return saveRoleResult(input, sessionId);
}
