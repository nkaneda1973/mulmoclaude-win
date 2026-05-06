// Reading-list plugin — server side (#1188 / #1169 PR-A My Library).
//
// Mirrors recipe-book-plugin (#1175 / #1183) — markdown-per-record
// storage on the v0.3 runtime API:
//   - definePlugin factory with destructured runtime (files, pubsub, log)
//   - files.data hosts one `.md` per book with YAML frontmatter
//   - readDir + per-file read for the list endpoint
//   - pubsub.publish("changed", ...) on every mutation so multi-tab
//     views auto-refresh
//   - Zod-discriminated args + exhaustive switch with `default: never`
//
// `node:fs` / `node:path` / `console` / direct `fetch` are unused —
// the gui-chat-protocol eslint preset bans them at lint time.

import { definePlugin } from "gui-chat-protocol";
import { z } from "zod";
import { TOOL_DEFINITION } from "./definition";

export { TOOL_DEFINITION };

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isValidSlug = (raw: string): boolean => raw.length > 0 && raw.length <= 64 && SLUG_RE.test(raw);

const BOOKS_DIR = "books";
const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_CLOSE = /(?:^|\r?\n)---\s*(?:\r?\n|$)/;

const READING_STATUSES = ["want", "reading", "read", "abandoned"] as const;
type ReadingStatus = (typeof READING_STATUSES)[number];

const Args = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list") }),
  z.object({ kind: z.literal("read"), slug: z.string() }),
  z.object({
    kind: z.literal("save"),
    slug: z.string(),
    title: z.string(),
    author: z.string(),
    isbn: z.string().optional(),
    status: z.enum(READING_STATUSES).optional(),
    rating: z.number().int().min(1).max(5).optional(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    tags: z.array(z.string()).optional(),
    body: z.string().optional(),
  }),
  z.object({
    kind: z.literal("update"),
    slug: z.string(),
    title: z.string(),
    author: z.string(),
    isbn: z.string().optional(),
    status: z.enum(READING_STATUSES).optional(),
    rating: z.number().int().min(1).max(5).optional(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    tags: z.array(z.string()).optional(),
    body: z.string().optional(),
  }),
  z.object({ kind: z.literal("delete"), slug: z.string() }),
]);

interface Book {
  slug: string;
  title: string;
  author: string;
  isbn: string | null;
  status: ReadingStatus;
  rating: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  tags: string[];
  created: string;
  updated: string;
  body: string;
}

type BookSummary = Pick<Book, "slug" | "title" | "author" | "status" | "rating" | "tags" | "updated">;

function escapeYamlScalar(value: string): string {
  const oneLine = value.replace(/\r?\n/g, " ").trim();
  const needsQuoting = /[:#'"\\[\]{}>|`*&!%@?]/.test(oneLine) || /^\s|\s$/.test(oneLine) || /^(true|false|null|~|yes|no|on|off)$/i.test(oneLine);
  return needsQuoting ? JSON.stringify(oneLine) : oneLine;
}

function serialise(book: Book): string {
  const lines = ["---", `title: ${escapeYamlScalar(book.title)}`, `author: ${escapeYamlScalar(book.author)}`];
  if (book.isbn !== null) lines.push(`isbn: ${escapeYamlScalar(book.isbn)}`);
  lines.push(`status: ${book.status}`);
  if (book.rating !== null) lines.push(`rating: ${book.rating}`);
  if (book.startedAt !== null) lines.push(`startedAt: ${escapeYamlScalar(book.startedAt)}`);
  if (book.finishedAt !== null) lines.push(`finishedAt: ${escapeYamlScalar(book.finishedAt)}`);
  if (book.tags.length > 0) {
    lines.push("tags:");
    for (const tag of book.tags) lines.push(`  - ${escapeYamlScalar(tag)}`);
  }
  lines.push(`created: ${escapeYamlScalar(book.created)}`);
  lines.push(`updated: ${escapeYamlScalar(book.updated)}`);
  lines.push("---", "", book.body.trimEnd(), "");
  return lines.join("\n");
}

// Tiny line-by-line frontmatter reader. We only use a handful of
// keys, all scalar except `tags`, so a YAML library would be
// overkill (and adds a dep the plugin doesn't otherwise need).
function parseFrontmatter(raw: string): { meta: Record<string, string | string[]>; body: string } | null {
  if (!FRONTMATTER_OPEN.test(raw)) return null;
  const afterOpen = raw.replace(FRONTMATTER_OPEN, "");
  const closeMatch = FRONTMATTER_CLOSE.exec(afterOpen);
  if (!closeMatch || closeMatch.index === undefined) return null;
  const yamlText = afterOpen.slice(0, closeMatch.index);
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  const meta: Record<string, string | string[]> = {};
  let currentArrayKey: string | null = null;
  for (const line of yamlText.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const arrayItem = line.match(/^\s+-\s+(.*)$/);
    if (arrayItem && currentArrayKey) {
      const arr = meta[currentArrayKey];
      if (Array.isArray(arr)) arr.push(unquote(arrayItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, valueRaw] = kv;
    if (valueRaw === "") {
      meta[key] = [];
      currentArrayKey = key;
    } else {
      meta[key] = unquote(valueRaw);
      currentArrayKey = null;
    }
  }
  return { meta, body };
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value.trim();
}

function metaInt(meta: Record<string, unknown>, key: string): number | null {
  const raw = meta[key];
  if (typeof raw !== "string") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function metaTags(meta: Record<string, unknown>): string[] {
  const raw = meta.tags;
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string");
  return [];
}

function metaStatus(meta: Record<string, unknown>): ReadingStatus {
  const raw = meta.status;
  if (typeof raw === "string" && (READING_STATUSES as readonly string[]).includes(raw)) {
    return raw as ReadingStatus;
  }
  return "want";
}

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const raw = meta[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function deserialise(slug: string, raw: string): Book | null {
  const parsed = parseFrontmatter(raw);
  if (!parsed) return null;
  const title = typeof parsed.meta.title === "string" ? parsed.meta.title : "";
  if (title.length === 0) return null;
  const author = typeof parsed.meta.author === "string" ? parsed.meta.author : "";
  const created = typeof parsed.meta.created === "string" ? parsed.meta.created : "";
  const updated = typeof parsed.meta.updated === "string" ? parsed.meta.updated : created;
  return {
    slug,
    title,
    author,
    isbn: metaString(parsed.meta, "isbn"),
    status: metaStatus(parsed.meta),
    rating: metaInt(parsed.meta, "rating"),
    startedAt: metaString(parsed.meta, "startedAt"),
    finishedAt: metaString(parsed.meta, "finishedAt"),
    tags: metaTags(parsed.meta),
    created,
    updated,
    body: parsed.body,
  };
}

function bookPath(slug: string): string {
  return `${BOOKS_DIR}/${slug}.md`;
}

function summarise(book: Book): BookSummary {
  return {
    slug: book.slug,
    title: book.title,
    author: book.author,
    status: book.status,
    rating: book.rating,
    tags: book.tags,
    updated: book.updated,
  };
}

export default definePlugin(({ pubsub, files, log }) => {
  // Serialise read-modify-write through a per-plugin promise chain so
  // two parallel save / update / delete calls can't race the on-disk
  // state. Same pattern as bookmarks-plugin / recipe-book-plugin.
  let writeLock: Promise<unknown> = Promise.resolve();
  function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = writeLock.catch(() => undefined).then(fn);
    writeLock = next.catch(() => undefined);
    return next;
  }

  async function readBook(slug: string): Promise<Book | null> {
    if (!isValidSlug(slug)) return null;
    if (!(await files.data.exists(bookPath(slug)))) return null;
    const raw = await files.data.read(bookPath(slug));
    return deserialise(slug, raw);
  }

  async function listBooks(): Promise<Book[]> {
    if (!(await files.data.exists(BOOKS_DIR))) return [];
    const entries = await files.data.readDir(BOOKS_DIR);
    const out: Book[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const slug = entry.slice(0, -".md".length);
      if (!isValidSlug(slug)) continue;
      const raw = await files.data.read(`${BOOKS_DIR}/${entry}`);
      const book = deserialise(slug, raw);
      if (book) out.push(book);
    }
    // Sort by `updated` desc — most-recently-touched at the top, the
    // shape the View wants for a "what am I reading right now" feel.
    out.sort((left, right) => right.updated.localeCompare(left.updated));
    return out;
  }

  async function publishChanged(): Promise<void> {
    pubsub.publish("changed", { at: new Date().toISOString() });
  }

  return {
    TOOL_DEFINITION,

    async manageReadingList(rawArgs: unknown) {
      const args = Args.parse(rawArgs);

      switch (args.kind) {
        case "list": {
          const books = await listBooks();
          return { ok: true, books: books.map(summarise) };
        }

        case "read": {
          if (!isValidSlug(args.slug)) {
            return { ok: false, error: "invalid_slug", slug: args.slug };
          }
          const book = await readBook(args.slug);
          if (!book) return { ok: false, error: "not_found", slug: args.slug };
          return { ok: true, book };
        }

        case "save": {
          if (!isValidSlug(args.slug)) {
            return { ok: false, error: "invalid_slug", slug: args.slug };
          }
          if (args.title.trim().length === 0) {
            return { ok: false, error: "missing_title" };
          }
          if (args.author.trim().length === 0) {
            return { ok: false, error: "missing_author" };
          }
          return withWriteLock(async () => {
            if (await files.data.exists(bookPath(args.slug))) {
              return { ok: false, error: "exists", slug: args.slug };
            }
            const now = new Date().toISOString();
            const book: Book = {
              slug: args.slug,
              title: args.title.trim(),
              author: args.author.trim(),
              isbn: args.isbn ?? null,
              status: args.status ?? "want",
              rating: args.rating ?? null,
              startedAt: args.startedAt ?? null,
              finishedAt: args.finishedAt ?? null,
              tags: args.tags ?? [],
              created: now,
              updated: now,
              body: args.body ?? "",
            };
            await files.data.write(bookPath(args.slug), serialise(book));
            log.info("saved", { slug: args.slug });
            await publishChanged();
            return { ok: true, book: summarise(book) };
          });
        }

        case "update": {
          if (!isValidSlug(args.slug)) {
            return { ok: false, error: "invalid_slug", slug: args.slug };
          }
          if (args.title.trim().length === 0) {
            return { ok: false, error: "missing_title" };
          }
          if (args.author.trim().length === 0) {
            return { ok: false, error: "missing_author" };
          }
          return withWriteLock(async () => {
            const existing = await readBook(args.slug);
            if (!existing) return { ok: false, error: "not_found", slug: args.slug };
            // Optional metadata preserves the on-disk value when the
            // caller omits the key. Same metadata-preservation
            // invariant as recipe-book — a "just add a paragraph to
            // my notes" update shouldn't wipe the rating or tags.
            const now = new Date().toISOString();
            const book: Book = {
              slug: args.slug,
              title: args.title.trim(),
              author: args.author.trim(),
              isbn: args.isbn ?? existing.isbn,
              status: args.status ?? existing.status,
              rating: args.rating ?? existing.rating,
              startedAt: args.startedAt ?? existing.startedAt,
              finishedAt: args.finishedAt ?? existing.finishedAt,
              tags: args.tags ?? existing.tags,
              created: existing.created || now,
              updated: now,
              body: args.body ?? existing.body,
            };
            await files.data.write(bookPath(args.slug), serialise(book));
            log.info("updated", { slug: args.slug });
            await publishChanged();
            return { ok: true, book: summarise(book) };
          });
        }

        case "delete": {
          if (!isValidSlug(args.slug)) {
            return { ok: false, error: "invalid_slug", slug: args.slug };
          }
          return withWriteLock(async () => {
            if (!(await files.data.exists(bookPath(args.slug)))) {
              return { ok: false, error: "not_found", slug: args.slug };
            }
            await files.data.unlink(bookPath(args.slug));
            log.info("deleted", { slug: args.slug });
            await publishChanged();
            return { ok: true, slug: args.slug };
          });
        }

        default: {
          const exhaustive: never = args;
          throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };
});
