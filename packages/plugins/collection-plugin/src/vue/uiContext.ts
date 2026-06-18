// Host-provided UI capabilities the collection view layer needs but a package
// can't own: data fetching over the host's collection REST API, and the host's
// asset-URL scheme. Each host (MulmoClaude, MulmoTerminal) configures this once
// at app startup via `configureCollectionUi`; the view layer reads it through
// `collectionUi()`. Mirrors the server-side `configureCollectionHost` binding.
//
// This grows as more of the View moves into the package (navigation, chat,
// confirm, …) as components migrate.

import type { CollectionDetailResponse } from "../core/uiTypes";

/** Result of a host data fetch — structurally a subset of the host's own
 *  `ApiResult` (so the host can pass `apiGet` straight through). The view layer
 *  treats `ok: false` as a skip, never throwing on one failed target. */
export type CollectionFetchResult<T> = { ok: true; data: T } | { ok: false };

/** Result of a host write (delete / create / update / action) — the normalised
 *  `ApiResult` shape, so the host passes `apiDelete`/`apiPost`/… straight through.
 *  Carries the host's error string on failure for inline display. */
export type CollectionMutationResult = { ok: true } | { ok: false; error: string };

/** Options for the host's confirm dialog — structurally matches the host's own
 *  `ConfirmOptions`, so `confirm` can forward to `useConfirm().openConfirm`. */
export interface CollectionConfirmOptions {
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "success" | "danger";
}

export interface CollectionUi {
  /** Fetch a collection's detail (schema + records) by slug — backs ref/embed
   *  resolution. Replaces the host's `apiGet(API_ROUTES.collections.detail)`. */
  fetchCollectionDetail: (slug: string) => Promise<CollectionFetchResult<CollectionDetailResponse>>;
  /** Browser-loadable URL for a file/image asset value (an html/svg artifact),
   *  or null when the value isn't a renderable asset path. Replaces
   *  `isValidFilePath` + `htmlPreviewUrlFor`/`svgPreviewUrlFor`. */
  fileAssetUrl: (value: unknown) => string | null;
  /** In-app File-Explorer route for a workspace file path (the fallback for
   *  `file` values that aren't a directly-served artifact), or null when the
   *  value isn't a valid in-workspace path. */
  fileRoutePath: (value: unknown) => string | null;
  /** Browser `<img src>` for a stored image value (a workspace file path), via
   *  the host's raw-file endpoint. Replaces the host's `resolveImageSrc`. */
  imageSrc: (imageData: string) => string;
  /** Open the host's confirm dialog; resolves true if confirmed. Replaces
   *  `useConfirm().openConfirm`. */
  confirm: (options: CollectionConfirmOptions) => Promise<boolean>;
  /** Delete a collection's custom view by id. Replaces the host's
   *  `apiDelete(API_ROUTES.collections.viewDelete)`. */
  deleteView: (slug: string, viewId: string) => Promise<CollectionMutationResult>;
}

let current: CollectionUi | null = null;

/** Wire the collection view layer to a host. Call once at app startup. */
export function configureCollectionUi(capabilities: CollectionUi): void {
  current = capabilities;
}

export function collectionUi(): CollectionUi {
  if (current === null) {
    throw new Error("@mulmoclaude/collection-plugin/vue: configureCollectionUi() was not called by the host");
  }
  return current;
}
