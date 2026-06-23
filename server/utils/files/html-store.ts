import path from "path";
import { workspacePath } from "../../workspace/workspace.js";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { writeFileAtomic } from "./atomic.js";
import { makePathValidator } from "./path-validator.js";

export async function overwriteHtml(relativePath: string, content: string): Promise<void> {
  const absPath = path.join(workspacePath, relativePath);
  await writeFileAtomic(absPath, content);
}

// Strict — overwriteHtml's path.join doesn't normalize traversal, so this gate is the primary defence.
export const isHtmlPath = makePathValidator({ prefix: WORKSPACE_DIRS.htmls, ext: ".html" });
