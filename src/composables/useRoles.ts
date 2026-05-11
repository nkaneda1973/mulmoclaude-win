// Composable that owns the active role list and its server-merge
// fetch. The selected role is owned by SessionHeaderControls via
// useCurrentRole — selection is a UI-local concern and lives next
// to the dropdown that drives it.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { ROLES, type Role } from "../config/roles";
import { mergeRoles } from "../utils/role/merge";
import { apiGet } from "../utils/api";

interface RolesListResponse {
  customRoles: Role[];
  builtInExtras?: Record<string, string[]>;
}

// Apply each built-in's `extraPlugins` overlay so the client-side
// role record carries the same `availablePlugins` the server would
// see via `loadAllRoles()`. Required because `useMcpTools` reads
// `currentRole.value.availablePlugins` directly when computing the
// visible tool set on the client.
function applyExtras(builtIn: readonly Role[], extras: Record<string, string[]>): Role[] {
  return builtIn.map((role) => {
    const extra = extras[role.id];
    if (!extra || extra.length === 0) return role;
    const seen = new Set(role.availablePlugins);
    const appended: string[] = [];
    for (const name of extra) {
      if (seen.has(name)) continue;
      seen.add(name);
      appended.push(name);
    }
    if (appended.length === 0) return role;
    return { ...role, availablePlugins: [...role.availablePlugins, ...appended] };
  });
}

export function useRoles(): {
  roles: Ref<Role[]>;
  refreshRoles: () => Promise<void>;
} {
  const roles = ref<Role[]>(ROLES);

  async function refreshRoles(): Promise<void> {
    const result = await apiGet<RolesListResponse>(API_ROUTES.roles.list);
    if (!result.ok) {
      // Keep the current role list on failure — losing custom roles
      // is preferable to crashing the UI on a transient API hiccup.
      console.warn(`[useRoles] refreshRoles failed: ${result.status} ${result.error}`);
      return;
    }
    const customRoles = Array.isArray(result.data?.customRoles) ? result.data.customRoles : [];
    const extras = result.data?.builtInExtras ?? {};
    roles.value = mergeRoles(applyExtras(ROLES, extras), customRoles);
  }

  return { roles, refreshRoles };
}
