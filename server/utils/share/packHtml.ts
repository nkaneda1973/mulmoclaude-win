import { readFile } from "fs/promises";
import { realpathSync } from "fs";
import path from "path";
import JSZip from "jszip";
import { resolveWorkspacePath, readWorkspaceText } from "../files/workspace-io.js";
import { resolveWithinRoot } from "../files/safe.js";
import { rewriteHtmlAssets } from "./rewriteAssets.js";
import { log } from "../../system/logger/index.js";

const LOG_PREFIX = "share";

export interface PackedFile {
  bundlePath: string;
  bytes: Buffer;
}

// A self-contained bundle: the rewritten entry document plus every
// referenced local asset, ready to zip. `name` is a suggested base
// filename (no extension) derived from the source page.
export interface PackedBundle {
  name: string;
  files: PackedFile[];
}

// `resolveWithinRoot` requires an already-realpath'd root. Resolved
// lazily (not at import) so loading this module never depends on the
// workspace dir existing yet; the location doesn't change during a run.
let workspaceRealCache: string | null = null;
function workspaceReal(): string {
  if (workspaceRealCache === null) workspaceRealCache = realpathSync(resolveWorkspacePath("."));
  return workspaceRealCache;
}

function stripQueryHash(ref: string): string {
  const cut = ref.search(/[?#]/);
  return cut === -1 ? ref : ref.slice(0, cut);
}

// Resolve a ref (relative to the HTML file's dir) to workspace bytes.
// Returns null when the ref escapes the workspace or the file is
// missing — the caller warns and leaves the (now dangling) link.
async function readAsset(htmlDir: string, originalRef: string): Promise<Buffer | null> {
  const relFromRoot = path.posix.normalize(path.posix.join(htmlDir, stripQueryHash(originalRef)));
  const abs = resolveWithinRoot(workspaceReal(), relFromRoot);
  if (!abs) return null;
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}

export async function packHtmlBundle(htmlRelPath: string): Promise<PackedBundle> {
  const html = await readWorkspaceText(htmlRelPath);
  if (html === null) throw new Error(`HTML not found: ${htmlRelPath}`);

  const { html: rewritten, assets } = rewriteHtmlAssets(html);
  const htmlDir = path.posix.dirname(htmlRelPath);

  const files: PackedFile[] = [{ bundlePath: "index.html", bytes: Buffer.from(rewritten, "utf-8") }];
  for (const asset of assets) {
    const bytes = await readAsset(htmlDir, asset.originalRef);
    if (bytes === null) {
      log.warn(LOG_PREFIX, "asset missing or outside workspace; skipped", { ref: asset.originalRef });
      continue;
    }
    files.push({ bundlePath: asset.bundlePath, bytes });
  }

  const name = path.posix.basename(htmlRelPath).replace(/\.html?$/i, "") || "share";
  return { name, files };
}

// Zip a bundle in memory. Bundles are small (one page + a few assets),
// so an in-memory buffer is simpler than streaming and stays testable.
export function zipBundle(files: PackedFile[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const file of files) zip.file(file.bundlePath, file.bytes);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}
