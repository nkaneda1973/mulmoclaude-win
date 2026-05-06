<script setup lang="ts">
// Reading-list plugin View — renders inside the host's canvas via the
// runtime plugin loader. Two-pane layout: list on the left, detail
// (rendered markdown notes) on the right. Subscribes to the plugin's
// "changed" channel so multi-tab views stay in sync.

import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { useT, format } from "./lang";

type ReadingStatus = "want" | "reading" | "read" | "abandoned";

interface BookSummary {
  slug: string;
  title: string;
  author: string;
  status: ReadingStatus;
  rating: number | null;
  tags: string[];
  updated: string;
}

interface BookDetail extends BookSummary {
  isbn: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  created: string;
  body: string;
}

// Tool-result shape the host hands us. After list / save / update we
// get a `books[]`; after delete we get just `{ ok, slug }`. The View
// always re-fetches via dispatch on mount so the pane stays current
// regardless of which action triggered it.
export interface Props {
  selectedResult: { books?: BookSummary[]; book?: BookSummary };
}
const props = defineProps<Props>();

const { pubsub, dispatch, log } = useRuntime();
const t = useT();

const books = ref<BookSummary[]>(props.selectedResult.books ?? []);
const selectedSlug = ref<string | null>(books.value[0]?.slug ?? null);
const detail = ref<BookDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const deleting = ref(false);

const selected = computed(() => books.value.find((book) => book.slug === selectedSlug.value) ?? null);

const renderedBody = computed(() => {
  const body = detail.value?.body;
  if (!body) return "";
  return renderMarkdownLite(body);
});

function statusLabel(status: ReadingStatus): string {
  return t.value.status[status];
}

// Mirror new tool results (e.g. after the LLM saves a new book).
watch(
  () => props.selectedResult.books,
  (next) => {
    if (next) {
      books.value = next;
      if (!selectedSlug.value || !next.find((book) => book.slug === selectedSlug.value)) {
        selectedSlug.value = next[0]?.slug ?? null;
      }
    }
  },
);

async function refetchList(): Promise<void> {
  try {
    const json = await dispatch<{ ok: boolean; books?: BookSummary[] }>({ kind: "list" });
    if (json.ok && json.books) {
      books.value = json.books;
      if (!selectedSlug.value || !json.books.find((book) => book.slug === selectedSlug.value)) {
        selectedSlug.value = json.books[0]?.slug ?? null;
      }
    }
  } catch (err) {
    log.warn("refetchList failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

watch(
  selectedSlug,
  async (slug) => {
    if (!slug) {
      detail.value = null;
      return;
    }
    detailLoading.value = true;
    detailError.value = null;
    try {
      const result = await dispatch<{ ok: boolean; book?: BookDetail; error?: string }>({ kind: "read", slug });
      if (selectedSlug.value !== slug) return;
      if (result.ok && result.book) {
        detail.value = result.book;
      } else {
        detailError.value = result.error ?? `book not found: ${slug}`;
        detail.value = null;
      }
    } catch (err) {
      if (selectedSlug.value !== slug) return;
      detailError.value = err instanceof Error ? err.message : String(err);
      detail.value = null;
    }
    if (selectedSlug.value === slug) detailLoading.value = false;
  },
  { immediate: true },
);

async function deleteBook(): Promise<void> {
  if (!detail.value) return;
  const { slug, title } = detail.value;
  if (!window.confirm(format(t.value.confirmDelete, { title }))) return;
  deleting.value = true;
  try {
    await dispatch({ kind: "delete", slug });
  } catch (err) {
    log.warn("delete failed", { slug, error: err instanceof Error ? err.message : String(err) });
  }
  deleting.value = false;
  // The "changed" pubsub event will trigger refetchList, which removes
  // the deleted slug from the list and advances the selection.
}

const unsubs: (() => void)[] = [];
onMounted(() => {
  unsubs.push(pubsub.subscribe("changed", () => void refetchList()));
  void refetchList();
});
onUnmounted(() => {
  for (const unsub of unsubs) unsub();
});

// Tiny markdown subset: headings, paragraphs, bullet / numbered
// lists, **bold**, *em*. Avoids pulling in a markdown library to
// keep the plugin bundle small. Anything else renders as plain text.
function renderMarkdownLite(input: string): string {
  const escaped = input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = escaped.split(/\r?\n/);
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let buffer: string[] = [];
  const flushPara = (): void => {
    if (buffer.length === 0) return;
    out.push(`<p>${buffer.join(" ")}</p>`);
    buffer = [];
  };
  const closeLists = (): void => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushPara();
      closeLists();
      const level = heading[1].length;
      out.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
      continue;
    }
    const ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) {
      flushPara();
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${formatInline(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flushPara();
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${formatInline(ol[1])}</li>`);
      continue;
    }
    if (line.trim().length === 0) {
      flushPara();
      closeLists();
      continue;
    }
    buffer.push(formatInline(line));
  }
  flushPara();
  closeLists();
  return out.join("\n");
}

function formatInline(input: string): string {
  return input.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
</script>

<template>
  <div class="books-view">
    <header class="books-header">
      <h2 class="books-title">
        {{ t.title }} <span class="books-count">({{ books.length }} {{ t.countSuffix }})</span>
      </h2>
    </header>

    <div class="books-body">
      <ul class="books-list" :aria-label="t.title">
        <li v-for="book in books" :key="book.slug">
          <button
            type="button"
            class="books-list-row"
            :class="{ 'is-active': selectedSlug === book.slug }"
            :aria-current="selectedSlug === book.slug ? 'true' : undefined"
            @click="selectedSlug = book.slug"
          >
            <span class="books-list-title">{{ book.title }}</span>
            <span class="books-list-author">{{ book.author }}</span>
            <span class="books-list-meta">
              <span class="books-list-status" :data-status="book.status">{{ statusLabel(book.status) }}</span>
              <span v-if="book.rating !== null" class="books-list-rating">★ {{ book.rating }}</span>
              <span v-if="book.tags.length > 0" class="books-list-tags">{{ book.tags.join(" · ") }}</span>
            </span>
          </button>
        </li>
        <li v-if="books.length === 0" class="books-empty">{{ t.empty }}</li>
      </ul>

      <section class="books-detail">
        <p v-if="!selected" class="books-detail-hint">{{ t.selectHint }}</p>
        <template v-else>
          <div class="books-detail-head">
            <div class="books-detail-meta">
              <h3 class="books-detail-title">{{ selected.title }}</h3>
              <div class="books-detail-author">{{ selected.author }}</div>
              <div class="books-detail-chips">
                <span class="books-detail-status" :data-status="selected.status">{{ format(t.statusLabel, { status: statusLabel(selected.status) }) }}</span>
                <span v-if="detail && detail.rating !== null">{{ format(t.ratingLabel, { rating: detail.rating }) }}</span>
                <span v-if="detail && detail.startedAt">{{ format(t.startedLabel, { date: detail.startedAt }) }}</span>
                <span v-if="detail && detail.finishedAt">{{ format(t.finishedLabel, { date: detail.finishedAt }) }}</span>
              </div>
              <div v-if="detail && detail.tags.length > 0" class="books-detail-tags">
                <span v-for="tag in detail.tags" :key="tag" class="books-detail-tag">{{ tag }}</span>
              </div>
            </div>
            <div class="books-detail-actions">
              <button type="button" class="books-delete" :disabled="detailLoading || deleting" @click="deleteBook">{{ t.delete }}</button>
            </div>
          </div>
          <p v-if="detailError" class="books-detail-error">{{ detailError }}</p>
          <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdownLite escapes raw input first, so the HTML never carries user-provided unescaped markup -->
          <div v-else-if="detail && renderedBody" class="books-detail-body" v-html="renderedBody"></div>
          <p v-else class="books-detail-empty">{{ t.emptyBody }}</p>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.books-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  background: white;
}
.books-header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e5e7eb;
}
.books-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0;
}
.books-count {
  color: #6b7280;
  font-weight: 400;
  font-size: 0.875rem;
  margin-left: 0.5rem;
}
.books-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.books-list {
  flex: 0 0 18rem;
  list-style: none;
  margin: 0;
  padding: 0;
  border-right: 1px solid #f3f4f6;
  overflow-y: auto;
  background: #fafafa;
}
.books-list-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.625rem 1rem;
  border: none;
  border-bottom: 1px solid #f3f4f6;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.books-list-row:hover {
  background: white;
}
.books-list-row:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: -2px;
}
.books-list-row.is-active {
  background: white;
  box-shadow: inset 2px 0 0 0 #3b82f6;
}
.books-list-title {
  font-weight: 500;
  color: #1f2937;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.books-list-author {
  font-size: 0.8125rem;
  color: #4b5563;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.books-list-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #6b7280;
}
.books-list-status {
  font-weight: 500;
}
.books-list-status[data-status="reading"] {
  color: #2563eb;
}
.books-list-status[data-status="read"] {
  color: #059669;
}
.books-list-status[data-status="abandoned"] {
  color: #9ca3af;
}
.books-list-rating {
  color: #d97706;
}
.books-list-tags {
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}
.books-empty {
  padding: 1rem;
  font-size: 0.875rem;
  color: #9ca3af;
  font-style: italic;
}
.books-detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 1.5rem;
}
.books-detail-hint {
  color: #9ca3af;
  font-style: italic;
  font-size: 0.875rem;
}
.books-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.books-detail-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 0.25rem 0;
  color: #1f2937;
}
.books-detail-author {
  font-size: 0.9375rem;
  color: #4b5563;
  margin-bottom: 0.5rem;
}
.books-detail-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: #6b7280;
}
.books-detail-status[data-status="reading"] {
  color: #2563eb;
}
.books-detail-status[data-status="read"] {
  color: #059669;
}
.books-detail-status[data-status="abandoned"] {
  color: #9ca3af;
}
.books-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.5rem;
}
.books-detail-tag {
  font-size: 0.6875rem;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  background: #f3f4f6;
  color: #4b5563;
}
.books-detail-actions {
  flex-shrink: 0;
}
.books-delete {
  font-size: 0.875rem;
  padding: 0.375rem 0.75rem;
  border: 1px solid #fca5a5;
  background: white;
  color: #dc2626;
  border-radius: 0.25rem;
  cursor: pointer;
}
.books-delete:hover:not(:disabled) {
  background: #fef2f2;
}
.books-delete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.books-detail-error {
  color: #dc2626;
  font-size: 0.875rem;
}
.books-detail-body {
  color: #374151;
  line-height: 1.6;
}
.books-detail-body :deep(h2) {
  font-size: 1.0625rem;
  font-weight: 600;
  margin: 1.25rem 0 0.5rem;
  color: #1f2937;
}
.books-detail-body :deep(h3) {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 1rem 0 0.5rem;
  color: #1f2937;
}
.books-detail-body :deep(ul),
.books-detail-body :deep(ol) {
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}
.books-detail-body :deep(li) {
  margin: 0.25rem 0;
}
.books-detail-body :deep(p) {
  margin: 0.5rem 0;
}
.books-detail-empty {
  color: #9ca3af;
  font-style: italic;
}
</style>
