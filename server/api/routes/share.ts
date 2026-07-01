import { Router, Request, Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { packHtmlBundle, zipBundle } from "../../utils/share/packHtml.js";
import { hasTraversalSegment } from "../../utils/files/safe.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

const router = Router();
const HTML_DIR_PREFIX = `${WORKSPACE_DIRS.htmls}/`;

interface PackBody {
  path?: string;
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_") || "share";
}

// POST /api/share/pack — bundle an HTML artifact and its referenced
// local assets into a single self-contained zip (index.html + assets/),
// returned as a download. Paths are rewritten to be relative so the
// unzipped folder opens directly over file://.
router.post(API_ROUTES.share.pack, async (req: Request<object, unknown, PackBody>, res: Response) => {
  const htmlPath = req.body?.path;
  if (typeof htmlPath !== "string" || !htmlPath.startsWith(HTML_DIR_PREFIX) || hasTraversalSegment(htmlPath)) {
    badRequest(res, `path must be an ${WORKSPACE_DIRS.htmls} file`);
    return;
  }
  try {
    const bundle = await packHtmlBundle(htmlPath);
    const zip = await zipBundle(bundle.files);
    log.info("share", "pack: ok", { path: htmlPath, files: bundle.files.length, bytes: zip.length });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(bundle.name)}.zip"`);
    res.send(zip);
  } catch (err) {
    // Log the detail server-side; return a generic message so an internal
    // path / stack never reaches the client.
    log.error("share", "pack: threw", { path: htmlPath, error: errorMessage(err) });
    serverError(res, "failed to pack HTML bundle");
  }
});

export default router;
