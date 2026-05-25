// Single dispatch endpoint for the host UI's bell popup. Body shape:
// `{ action: "clear" | "cancel" | "list" | "listHistory", ... }`.
//
// Trust boundary — `publish` is INTENTIONALLY not a production HTTP
// action. The only legitimate publishers are in-process: plugins go
// through `runtime.notifier.publish` (auto-binds `pluginPkg` to the
// calling plugin's pkg name in
// `server/plugins/runtime.ts:makeScopedNotifier`) and host-internal
// modules call `engine.publish` directly. Exposing `publish` over HTTP
// in production would let any holder of the bearer token publish under
// any plugin's namespace, since the route layer cannot authenticate
// which plugin (if any) made the request — bearer auth only proves
// "the caller is on this machine and knows the token," not "the caller
// is plugin X." If a future feature genuinely needs remote publish, it
// must arrive with caller-identity headers and a per-pkg auth check.
//
// `MULMOCLAUDE_E2E_NOTIFIER_INJECT=1` opens a narrow test seam that
// re-enables the `publish` action for e2e-live (`L-17`, the B-50
// regression canary). The env var is read once at module load and the
// action is only honoured when the seam is on, so production boots
// never expose the surface. Tests must set the env on the dev server
// they spawn against; the bearer-token auth still applies, so the
// seam is local-only even when enabled.
//
// `clear` / `cancel` are deliberately host-scoped (no `pluginPkg`):
// the bell popup belongs to the host, sees every plugin's entries,
// and must be able to dismiss any of them. Plugin-scoped clears (the
// per-plugin isolation property) live on the in-process runtime API
// only — `engine.clearForPlugin` is not reachable from this route.

import { Router, type Request, type Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { cancel, clear, listAll, listHistory, publish } from "../../notifier/engine.js";
import {
  NOTIFIER_LIFECYCLES,
  NOTIFIER_SEVERITIES,
  type NotifierEntry,
  type NotifierHistoryEntry,
  type NotifierLifecycle,
  type NotifierSeverity,
  type PublishInput,
} from "../../notifier/types.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { badRequest } from "../../utils/httpError.js";
import { log } from "../../system/logger/index.js";

interface DispatchBody {
  action?: unknown;
  // clear / cancel
  id?: unknown;
  // publish (test-only seam — see top-of-file env-gate note)
  pluginPkg?: unknown;
  severity?: unknown;
  lifecycle?: unknown;
  title?: unknown;
  body?: unknown;
  navigateTarget?: unknown;
  pluginData?: unknown;
}

type DispatchResponse = { ok: true } | { id: string } | { entries: NotifierEntry[] } | { history: NotifierHistoryEntry[] } | { error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSeverity(value: unknown): value is NotifierSeverity {
  return typeof value === "string" && (NOTIFIER_SEVERITIES as readonly string[]).includes(value);
}

function isLifecycle(value: unknown): value is NotifierLifecycle {
  return typeof value === "string" && (NOTIFIER_LIFECYCLES as readonly string[]).includes(value);
}

// Decided once at module load — flipping the env after boot has no
// effect, matching the `MULMOCLAUDE_FAKE_AGENT` seam in
// `server/index.ts`. The warn log makes the seam visible in dev-server
// output so a stray env in a developer's shell can't go unnoticed.
const TEST_INJECT_ENABLED = process.env.MULMOCLAUDE_E2E_NOTIFIER_INJECT === "1";
if (TEST_INJECT_ENABLED) {
  log.warn("notifier", "MULMOCLAUDE_E2E_NOTIFIER_INJECT=1 — publish action enabled on /api/notifier (test seam)");
}

function buildPublishInput(reqBody: DispatchBody): PublishInput | string {
  if (!isNonEmptyString(reqBody.pluginPkg)) return "pluginPkg required (non-empty string)";
  if (!isSeverity(reqBody.severity)) return `severity must be one of ${NOTIFIER_SEVERITIES.join(", ")}`;
  if (!isNonEmptyString(reqBody.title)) return "title required (non-empty string)";
  if (reqBody.body !== undefined && typeof reqBody.body !== "string") return "body must be a string when present";
  if (reqBody.lifecycle !== undefined && !isLifecycle(reqBody.lifecycle)) {
    return `lifecycle must be one of ${NOTIFIER_LIFECYCLES.join(", ")} when present`;
  }
  if (reqBody.navigateTarget !== undefined && typeof reqBody.navigateTarget !== "string") {
    return "navigateTarget must be a string when present";
  }
  return {
    pluginPkg: reqBody.pluginPkg,
    severity: reqBody.severity,
    title: reqBody.title,
    body: reqBody.body,
    lifecycle: reqBody.lifecycle,
    navigateTarget: reqBody.navigateTarget,
    pluginData: reqBody.pluginData,
  };
}

const notifierRouter: Router = Router();

// Detailed error stays in the server log for triage (via asyncHandler's
// `log.error`); the HTTP response gets the opaque "internal error"
// message so a parser-thrown filesystem path / internal stack frame
// can't leak to the client. Echoing `String(err)` would have given
// e.g. `Error: ENOENT, open '/Users/<...>/active.json'` to anyone
// holding the bearer token (CodeRabbit review on PR #1196).
notifierRouter.post(
  API_ROUTES.notifier.dispatch,
  asyncHandler<Request<object, DispatchResponse, DispatchBody>, Response<DispatchResponse>>("notifier-route", "internal error", async (req, res) => {
    const reqBody = req.body ?? {};
    const { action } = reqBody;
    switch (action) {
      case "clear": {
        if (!isNonEmptyString(reqBody.id)) {
          badRequest(res, "id required");
          return;
        }
        await clear(reqBody.id);
        res.json({ ok: true });
        return;
      }
      case "cancel": {
        if (!isNonEmptyString(reqBody.id)) {
          badRequest(res, "id required");
          return;
        }
        await cancel(reqBody.id);
        res.json({ ok: true });
        return;
      }
      case "list": {
        const entries = await listAll();
        res.json({ entries });
        return;
      }
      case "listHistory": {
        const history = await listHistory();
        res.json({ history });
        return;
      }
      case "publish": {
        // Test-only seam (see top-of-file note). When the env-gate is
        // off this falls through to the default `unknown action`
        // path — production callers see the same opaque error shape
        // as any other unsupported action, so the surface is
        // indistinguishable from "never existed".
        if (!TEST_INJECT_ENABLED) break;
        const parsed = buildPublishInput(reqBody);
        if (typeof parsed === "string") {
          badRequest(res, parsed);
          return;
        }
        const { id } = await publish(parsed);
        res.json({ id });
        return;
      }
      default:
        break;
    }
    badRequest(res, `unknown action: ${typeof action === "string" ? action : "<missing>"}`);
  }),
);

export default notifierRouter;
