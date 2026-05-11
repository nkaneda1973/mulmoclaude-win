import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// The roles route imports workspacePath at module load. Override HOME
// so homedir() → temp root, then dynamic-import the modules.
let tmpRoot: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

type RolesRoute = typeof import("../../server/api/routes/roles.js");
type RolesIo = typeof import("../../server/utils/files/roles-io.js");
type RolesExtrasIo = typeof import("../../server/utils/files/roles-extras-io.js");
type RolesWorkspace = typeof import("../../server/workspace/roles.js");
let rolesRoute: RolesRoute;
let rolesIo: RolesIo;
let rolesExtrasIo: RolesExtrasIo;
let rolesWorkspace: RolesWorkspace;
let rolesDir: string;
let extrasDir: string;

before(async () => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "roles-manage-test-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  mkdirSync(path.join(tmpRoot, "mulmoclaude"), { recursive: true });
  rolesRoute = await import("../../server/api/routes/roles.js");
  rolesIo = await import("../../server/utils/files/roles-io.js");
  rolesExtrasIo = await import("../../server/utils/files/roles-extras-io.js");
  rolesWorkspace = await import("../../server/workspace/roles.js");
  rolesDir = path.join(tmpRoot, "mulmoclaude", "config", "roles");
  extrasDir = path.join(rolesDir, "extras");
});

after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  rmSync(tmpRoot, { recursive: true, force: true });
});

function sampleRole(roleId: string) {
  return {
    id: roleId,
    name: `Role ${roleId}`,
    icon: "person",
    prompt: "You are a test role.",
    availablePlugins: ["wiki"],
    queries: [],
  };
}

describe("executeManageRoles — rename (oldRoleId)", () => {
  it("writes the new-id file and removes the old-id file", async () => {
    rolesIo.saveRole("original", sampleRole("original"));
    assert.equal(rolesIo.roleExists("original"), true);

    const result = await rolesRoute.executeManageRoles(
      {
        action: "update",
        role: sampleRole("renamed"),
        oldRoleId: "original",
      },
      "test-session",
    );

    assert.equal(result.success, true, `result: ${JSON.stringify(result)}`);
    assert.equal(rolesIo.roleExists("renamed"), true, "new role file should exist");
    assert.equal(rolesIo.roleExists("original"), false, "old role file should have been deleted");
  });

  it("rejects a rename into a built-in id", async () => {
    rolesIo.saveRole("tmp", sampleRole("tmp"));
    const result = await rolesRoute.executeManageRoles(
      {
        action: "update",
        role: sampleRole("general"), // "general" is a built-in id
        oldRoleId: "tmp",
      },
      "test-session",
    );
    assert.equal(result.success, false);
    assert.match(String(result.error), /reserved/i);
    // Clean up
    rolesIo.deleteRole("tmp");
    // Ensure we didn't accidentally create the built-in id file
    const generalPath = path.join(rolesDir, "general.json");
    assert.equal(existsSync(generalPath), false);
  });

  it("rejects a rename into an id already in use", async () => {
    rolesIo.saveRole("alpha", sampleRole("alpha"));
    rolesIo.saveRole("beta", sampleRole("beta"));
    const result = await rolesRoute.executeManageRoles(
      {
        action: "update",
        role: sampleRole("beta"),
        oldRoleId: "alpha",
      },
      "test-session",
    );
    assert.equal(result.success, false);
    assert.match(String(result.error), /already exists/i);
    assert.equal(rolesIo.roleExists("alpha"), true, "'alpha' should still exist");
    assert.equal(rolesIo.roleExists("beta"), true, "'beta' should still exist");
    rolesIo.deleteRole("alpha");
    rolesIo.deleteRole("beta");
  });

  it("removes a built-in-id override file when renaming away from it", async () => {
    // A file at config/roles/general.json is a user override of the
    // built-in "general" role. Renaming it to a non-builtin id must
    // remove the override file — otherwise it would continue to shadow
    // the built-in and couldn't be deleted through the manage API.
    rolesIo.saveRole("general", sampleRole("general"));
    assert.equal(rolesIo.roleExists("general"), true);

    const result = await rolesRoute.executeManageRoles(
      {
        action: "update",
        role: sampleRole("general_custom"),
        oldRoleId: "general",
      },
      "test-session",
    );

    assert.equal(result.success, true, `result: ${JSON.stringify(result)}`);
    assert.equal(rolesIo.roleExists("general_custom"), true, "new role file should exist");
    assert.equal(rolesIo.roleExists("general"), false, "built-in override file should have been deleted");
    rolesIo.deleteRole("general_custom");
  });

  it("ignores oldRoleId on a create payload (never runs rename cleanup)", async () => {
    // Defensive: a malformed create payload that includes oldRoleId
    // must not trigger the rename-delete path. Rename detection is
    // gated on action === "update".
    rolesIo.saveRole("victim", sampleRole("victim"));
    const result = await rolesRoute.executeManageRoles(
      {
        action: "create",
        role: sampleRole("fresh"),
        oldRoleId: "victim",
      },
      "test-session",
    );
    assert.equal(result.success, true, `result: ${JSON.stringify(result)}`);
    assert.equal(rolesIo.roleExists("fresh"), true, "'fresh' should have been created");
    assert.equal(rolesIo.roleExists("victim"), true, "'victim' must not be deleted by a create payload");
    rolesIo.deleteRole("fresh");
    rolesIo.deleteRole("victim");
  });

  it("rejects a create whose id collides with an existing custom role", async () => {
    // Defensive: a direct-API or stale-client `create` must not
    // silently overwrite an existing custom role. The client-side
    // validator catches this for the UI path, but the server is the
    // last line of defence.
    rolesIo.saveRole("target", { ...sampleRole("target"), name: "Original" });
    const result = await rolesRoute.executeManageRoles(
      {
        action: "create",
        role: { ...sampleRole("target"), name: "Overwriter" },
      },
      "test-session",
    );
    assert.equal(result.success, false);
    assert.match(String(result.error), /already exists/i);
    // Original content must be intact
    const onDisk = JSON.parse(readFileSync(path.join(rolesDir, "target.json"), "utf-8")) as { name: string };
    assert.equal(onDisk.name, "Original", "existing role must not be overwritten");
    rolesIo.deleteRole("target");
  });

  it("plain update (no oldRoleId) still works and does not delete anything", async () => {
    rolesIo.saveRole("plain", sampleRole("plain"));
    const result = await rolesRoute.executeManageRoles(
      {
        action: "update",
        role: { ...sampleRole("plain"), name: "Renamed Display" },
      },
      "test-session",
    );
    assert.equal(result.success, true);
    assert.equal(rolesIo.roleExists("plain"), true);
    rolesIo.deleteRole("plain");
  });
});

describe("executeManageRoles — extendBuiltin", () => {
  function extrasFile(roleId: string): string {
    return path.join(extrasDir, `${roleId}.json`);
  }

  it("writes extras for a built-in id and includes them in the list response", async () => {
    const result = await rolesRoute.executeManageRoles(
      {
        action: "extendBuiltin",
        roleId: "general",
        extraPlugins: ["customA", "customB"],
      },
      "test-session",
    );
    assert.equal(result.success, true, `result: ${JSON.stringify(result)}`);

    const onDisk = JSON.parse(readFileSync(extrasFile("general"), "utf-8")) as { extraPlugins: string[] };
    assert.deepEqual(onDisk.extraPlugins, ["customA", "customB"]);

    const listResult = (await rolesRoute.executeManageRoles({ action: "list" }, "test-session")) as { data?: { builtInExtras?: Record<string, string[]> } };
    assert.deepEqual(listResult.data?.builtInExtras?.general, ["customA", "customB"]);

    rolesExtrasIo.deleteExtras("general");
  });

  it("empty extraPlugins deletes the overlay file", async () => {
    rolesExtrasIo.writeExtras("general", ["x"]);
    assert.equal(existsSync(extrasFile("general")), true);

    const result = await rolesRoute.executeManageRoles({ action: "extendBuiltin", roleId: "general", extraPlugins: [] }, "test-session");
    assert.equal(result.success, true, `result: ${JSON.stringify(result)}`);
    assert.equal(existsSync(extrasFile("general")), false, "overlay file should be deleted when extraPlugins is empty");
  });

  it("rejects a non-built-in roleId", async () => {
    const result = await rolesRoute.executeManageRoles({ action: "extendBuiltin", roleId: "totally-made-up", extraPlugins: ["x"] }, "test-session");
    assert.equal(result.success, false);
    assert.match(String(result.error), /not a built-in/i);
    assert.equal(existsSync(extrasFile("totally-made-up")), false);
  });

  it("silently drops baseline plugins from the extras payload (additive-only)", async () => {
    // The "general" built-in includes `presentForm` in its baseline.
    // Passing it as an extra must not persist — extras represent ONLY
    // additions on top of the baseline.
    const result = await rolesRoute.executeManageRoles(
      { action: "extendBuiltin", roleId: "general", extraPlugins: ["presentForm", "novelExtra"] },
      "test-session",
    );
    assert.equal(result.success, true, `result: ${JSON.stringify(result)}`);
    const onDisk = JSON.parse(readFileSync(extrasFile("general"), "utf-8")) as { extraPlugins: string[] };
    assert.deepEqual(onDisk.extraPlugins, ["novelExtra"], "baseline plugin must be dropped, only novel extras persisted");
    rolesExtrasIo.deleteExtras("general");
  });

  it("dedupes duplicate names in the extras payload", async () => {
    const result = await rolesRoute.executeManageRoles({ action: "extendBuiltin", roleId: "general", extraPlugins: ["a", "b", "a", "b"] }, "test-session");
    assert.equal(result.success, true, `result: ${JSON.stringify(result)}`);
    const onDisk = JSON.parse(readFileSync(extrasFile("general"), "utf-8")) as { extraPlugins: string[] };
    assert.deepEqual(onDisk.extraPlugins, ["a", "b"]);
    rolesExtrasIo.deleteExtras("general");
  });

  it("rejects a missing extraPlugins array", async () => {
    const result = await rolesRoute.executeManageRoles({ action: "extendBuiltin", roleId: "general" }, "test-session");
    assert.equal(result.success, false);
    assert.match(String(result.error), /extraPlugins/i);
  });
});

describe("loadAllRoles — built-in extras merge", () => {
  it("appends extras to the built-in's availablePlugins (baseline first, dedup)", () => {
    rolesExtrasIo.writeExtras("general", ["zExtra", "presentForm", "yExtra"]);
    try {
      const all = rolesWorkspace.loadAllRoles();
      const general = all.find((role) => role.id === "general");
      assert.ok(general, "general role should be present");
      // Baseline contains presentForm — it must not appear twice.
      const occurrences = general.availablePlugins.filter((name) => name === "presentForm").length;
      assert.equal(occurrences, 1, "baseline plugin must not duplicate after merge");
      // Extras land at the tail, in their declared order, minus dupes.
      assert.ok(general.availablePlugins.includes("zExtra"), "extras should be merged in");
      assert.ok(general.availablePlugins.includes("yExtra"), "extras should be merged in");
      const zIdx = general.availablePlugins.indexOf("zExtra");
      const yIdx = general.availablePlugins.indexOf("yExtra");
      assert.ok(zIdx < yIdx, "extras preserve their declared order");
      // Baseline ordering preserved at the front.
      const baselineIdx = general.availablePlugins.indexOf("presentForm");
      assert.ok(baselineIdx < zIdx, "baseline entries precede appended extras");
    } finally {
      rolesExtrasIo.deleteExtras("general");
    }
  });

  it("ignores extras for a built-in shadowed by a same-id custom role", () => {
    rolesExtrasIo.writeExtras("general", ["shouldBeIgnored"]);
    rolesIo.saveRole("general", { ...sampleRole("general"), availablePlugins: ["onlyCustomPlugin"] });
    try {
      const all = rolesWorkspace.loadAllRoles();
      const general = all.find((role) => role.id === "general");
      assert.ok(general, "shadowing custom role should win");
      assert.deepEqual(general.availablePlugins, ["onlyCustomPlugin"], "custom role wins and extras for the built-in are ignored");
    } finally {
      rolesIo.deleteRole("general");
      rolesExtrasIo.deleteExtras("general");
    }
  });

  it("no extras file → built-in unchanged", () => {
    rolesExtrasIo.deleteExtras("general"); // ensure clean
    const all = rolesWorkspace.loadAllRoles();
    const general = all.find((role) => role.id === "general");
    assert.ok(general);
    // We can't assert exact contents (built-in evolves over releases),
    // but we can assert presentForm is there as baseline and there are
    // no stray "Extra" / "custom" sentinels left from prior tests.
    assert.ok(general.availablePlugins.includes("presentForm"));
    assert.equal(general.availablePlugins.includes("zExtra"), false);
    assert.equal(general.availablePlugins.includes("customA"), false);
  });
});
