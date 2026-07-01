import path from "path";
import { parse, type HTMLElement } from "node-html-parser";

// A local resource referenced by the HTML that must be copied into the
// bundle. `originalRef` is the reference verbatim as it appears in the
// source (relative to the HTML file); `bundlePath` is where it lands in
// the self-contained bundle (always under `assets/`).
export interface AssetRef {
  originalRef: string;
  bundlePath: string;
}

export interface RewriteResult {
  html: string;
  assets: AssetRef[];
}

const ASSETS_DIR = "assets";

// Refs we never bundle: absolute URLs, protocol-relative, data/blob,
// in-page anchors, and non-navigational schemes. Everything else is a
// workspace-relative path the bundle must localize. Root-absolute
// (`/foo`) is left alone too — without a known base it can't be mapped.
function isLocalRef(ref: string): boolean {
  const value = ref.trim();
  if (value === "") return false;
  if (value.startsWith("#") || value.startsWith("//") || value.startsWith("/")) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

function stripQueryHash(ref: string): string {
  const cut = ref.search(/[?#]/);
  return cut === -1 ? ref : ref.slice(0, cut);
}

// Assigns each unique originalRef a stable `assets/<name>`. Same ref →
// same slot (dedup). A basename collision across different refs is
// disambiguated by prefixing a short hash of the full ref, so two
// `logo.png` from different dirs don't clobber each other.
function createAssetMapper() {
  const byRef = new Map<string, string>();
  const usedNames = new Set<string>();
  const assets: AssetRef[] = [];

  const hash = (value: string): string => {
    let acc = 0;
    for (const char of value) acc = (acc * 31 + char.charCodeAt(0)) | 0;
    return (acc >>> 0).toString(36);
  };

  const map = (originalRef: string): string => {
    const existing = byRef.get(originalRef);
    if (existing) return existing;
    const base = path.posix.basename(stripQueryHash(originalRef)) || "asset";
    const name = usedNames.has(base) ? `${hash(originalRef)}-${base}` : base;
    usedNames.add(name);
    const bundlePath = `${ASSETS_DIR}/${name}`;
    byRef.set(originalRef, bundlePath);
    assets.push({ originalRef, bundlePath });
    return bundlePath;
  };

  return { map, assets };
}

function rewriteCssUrls(css: string, map: (ref: string) => string): string {
  return css.replace(/url\(([^)]*)\)/gi, (whole, inner: string) => {
    const raw = inner.trim();
    const quote = raw.startsWith('"') || raw.startsWith("'") ? raw[0] : "";
    const ref = quote ? raw.slice(1, -1) : raw;
    if (!isLocalRef(ref)) return whole;
    return `url(${quote}${map(ref)}${quote})`;
  });
}

function rewriteSrcset(value: string, map: (ref: string) => string): string {
  return value
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (trimmed === "") return trimmed;
      const [url, ...descriptor] = trimmed.split(/\s+/);
      if (!isLocalRef(url)) return trimmed;
      return [map(url), ...descriptor].join(" ");
    })
    .join(", ");
}

// Embedded resources only. `a[href]` is intentionally excluded — it is
// navigation, not an inlined asset, and rewriting it would point at a
// file the single-page bundle doesn't carry.
const URL_ATTRS: readonly { selector: string; attr: string }[] = [
  { selector: "img[src]", attr: "src" },
  { selector: "script[src]", attr: "src" },
  { selector: "source[src]", attr: "src" },
  { selector: "link[href]", attr: "href" },
  { selector: "audio[src]", attr: "src" },
  { selector: "video[src]", attr: "src" },
  { selector: "video[poster]", attr: "poster" },
];

function rewriteAttrs(root: HTMLElement, map: (ref: string) => string): void {
  for (const { selector, attr } of URL_ATTRS) {
    for (const element of root.querySelectorAll(selector)) {
      const ref = element.getAttribute(attr);
      if (ref && isLocalRef(ref)) element.setAttribute(attr, map(ref));
    }
  }
  for (const element of root.querySelectorAll("[srcset]")) {
    const value = element.getAttribute("srcset");
    if (value) element.setAttribute("srcset", rewriteSrcset(value, map));
  }
  for (const element of root.querySelectorAll("style")) {
    element.set_content(rewriteCssUrls(element.textContent, map));
  }
  for (const element of root.querySelectorAll("[style]")) {
    const value = element.getAttribute("style");
    if (value) element.setAttribute("style", rewriteCssUrls(value, map));
  }
}

// Rewrites every local resource reference in `html` to point at a
// co-located `assets/<name>`, returning the rewritten document plus the
// list of refs to copy. Pure: no filesystem or network.
export function rewriteHtmlAssets(html: string): RewriteResult {
  const root = parse(html, { comment: true });
  const mapper = createAssetMapper();
  rewriteAttrs(root, mapper.map);
  return { html: root.toString(), assets: mapper.assets };
}
