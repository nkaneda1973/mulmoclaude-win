// Shared image-placeholder fill (task #6 Phase 4). The LLM is told (see
// definition.ts) to emit embedded images as one of:
//   - plain:  ![prompt](__too_be_replaced_image_path__)
//   - Marp:   ![bg right:45%](__too_be_replaced_image_path__ "prompt")
// i.e. the GENERATION PROMPT is the alt text, UNLESS the alt is taken by a
// Marp directive — then the prompt lives in the quoted markdown title. This
// owns the regex + substitution so every host stays in lockstep, while image
// GENERATION + STORAGE is injected (each host wires Gemini + URL/data-URI).

// Groups: 1 = alt text (prompt OR Marp directive), 2 = optional quoted title
// (the prompt when the alt is a directive). Both bounded ({1,1000}) rather
// than `+` so the regex stays linear on uncontrolled markdown (CodeQL
// polynomial-ReDoS).
export const IMAGE_PLACEHOLDER = /!\[([^\]]{1,1000})\]\(\/?__too_be_replaced_image_path__(?:\s+"([^"]{1,1000})")?\)/g;

/** Build the markdown that replaces one placeholder. `altText` is kept as the
 *  rendered alt (the prompt for plain images, or the Marp directive for
 *  directive images). `ref` is the host-resolved image reference (URL / data
 *  URI) or null when generation was unavailable/failed — in which case an
 *  italic marker shows `fallbackLabel` (defaults to `altText`; callers pass
 *  the generation prompt so a Marp directive isn't shown as the label). */
export function buildImagePlaceholderReplacement(altText: string, ref: string | null, fallbackLabel: string = altText): string {
  if (ref) return `![${altText}](${ref})`;
  return `*🖼️ Image: ${fallbackLabel}*`;
}

export interface ImagePlaceholderResult {
  full: string;
  /** The rendered alt text (prompt for plain images, directive for Marp). */
  alt: string;
  /** The text used to GENERATE the image (the title when present, else alt). */
  prompt: string;
  ref: string | null;
}

export interface FillImagePlaceholdersDeps {
  /** Resolve a displayable image reference for `prompt` (the host
   *  generates + stores it, returning a URL or data URI), or null to
   *  fall back to a text marker. `index`/`total` are for progress logs. */
  resolveImage: (prompt: string, index: number, total: number) => Promise<string | null>;
  /** Max image generations in flight at once. Bounded so a document with
   *  many placeholders doesn't fan out into a burst of provider calls
   *  (rate limits / resource spikes). Default 4. */
  concurrency?: number;
}

/** Run `worker` over `items` with at most `limit` in flight, preserving
 *  input order in the results. */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Replace every `__too_be_replaced_image_path__` placeholder. Returns
 *  the filled markdown plus the per-placeholder results so the host can
 *  emit its own batch observability. Generation runs with bounded
 *  concurrency (`deps.concurrency`, default 4). */
export async function fillImagePlaceholders(
  markdown: string,
  deps: FillImagePlaceholdersDeps,
): Promise<{ markdown: string; results: ImagePlaceholderResult[] }> {
  const matches = [...markdown.matchAll(IMAGE_PLACEHOLDER)];
  if (matches.length === 0) return { markdown, results: [] };

  const total = matches.length;
  const results = await mapWithConcurrency(matches, deps.concurrency ?? 4, async (match, index) => {
    const alt = match[1];
    // Marp directive form puts the prompt in the title (group 2); plain form
    // uses the alt itself as the prompt.
    const prompt = match[2] ?? alt;
    return { full: match[0], alt, prompt, ref: await deps.resolveImage(prompt, index, total) };
  });

  // One ordered pass over the same matches: `String.replace` with the
  // global regex invokes the replacer per match in document order, and
  // `results` is in matchAll order — so each placeholder (including
  // duplicate identical ones) gets its own result. Avoids the
  // quadratic re-scan + first-occurrence collision of a per-item
  // `filled.replace(full, …)` loop (Sourcery).
  let cursor = 0;
  const filled = markdown.replace(IMAGE_PLACEHOLDER, () => {
    const result = results[cursor++];
    // Keep the alt (prompt for plain, directive for Marp) in the output; the
    // null-fallback marker shows the generation prompt, not the directive.
    return buildImagePlaceholderReplacement(result.alt, result.ref, result.prompt);
  });
  return { markdown: filled, results };
}
