<template>
  <div class="p-3 text-sm flex flex-col gap-3 font-sans">
    <!-- Header with badge if there are pending candidates -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-200">
        <span aria-hidden="true" class="text-base text-indigo-500">⏱️</span>
        <span>{{ t.title }}</span>
      </div>
      <span
        v-if="candidates.length > 0"
        class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 animate-pulse"
      >
        {{ candidates.length }} {{ t.reviewBoard }}
      </span>
    </div>

    <!-- Comparative stats bar chart -->
    <div class="flex flex-col gap-2 bg-gray-50 dark:bg-gray-800/40 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800">
      <div class="text-[11px] text-gray-400 font-medium uppercase tracking-wider">
        {{ t.weekVsLastWeek }}
      </div>

      <!-- This Week -->
      <div class="flex flex-col gap-1 mt-1">
        <div class="flex justify-between text-xs font-medium text-gray-600 dark:text-gray-300">
          <span>{{ t.currWeek }}</span>
          <span class="font-bold text-indigo-600 dark:text-indigo-400">{{ thisWeekHours.toFixed(1) }}h</span>
        </div>
        <div class="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 dark:from-indigo-400 dark:to-indigo-500 rounded-full transition-all duration-500"
            :style="{ width: `${thisWeekPercent}%` }"
          ></div>
        </div>
      </div>

      <!-- Last Week -->
      <div class="flex flex-col gap-1 mt-2">
        <div class="flex justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
          <span>{{ t.prevWeek }}</span>
          <span class="font-bold text-gray-700 dark:text-gray-300">{{ lastWeekHours.toFixed(1) }}h</span>
        </div>
        <div class="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            class="h-full bg-gray-400 dark:bg-gray-500 rounded-full transition-all duration-500"
            :style="{ width: `${lastWeekPercent}%` }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { WorklogEntry, CandidateEntry } from "./types";
import { useT } from "./lang";

const props = defineProps<{ result: ToolResultComplete<any> }>();
const t = useT();

const committed = ref<WorklogEntry[]>(props.result.data?.committed ?? []);
const candidates = ref<CandidateEntry[]>(props.result.data?.candidates ?? []);

const { dispatch, pubsub } = useRuntime();

interface RefreshResponse {
  data?: {
    committed?: WorklogEntry[];
    candidates?: CandidateEntry[];
  };
}

async function refresh(): Promise<void> {
  try {
    const result = await dispatch<RefreshResponse>({ kind: "listAll" });
    if (Array.isArray(result.data?.committed)) {
      committed.value = result.data.committed;
    }
    if (Array.isArray(result.data?.candidates)) {
      candidates.value = result.data.candidates;
    }
  } catch {
    // Keep initialized fallback on failure
  }
}

let unsub: (() => void) | undefined;
onMounted(() => {
  void refresh();
  unsub = pubsub.subscribe("changed", () => {
    void refresh();
  });
});
onUnmounted(() => unsub?.());

watch(
  () => props.result.uuid,
  () => {
    committed.value = props.result.data?.committed ?? [];
    candidates.value = props.result.data?.candidates ?? [];
    void refresh();
  },
);

// Date Helpers
function getStartOfWeek(offsetWeeks = 0): Date {
  const d = new Date();
  const day = d.getDay();
  // Adjust Monday as day 1, Sunday as day 7
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + (offsetWeeks * 7);
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
}

const thisWeekHours = computed(() => {
  const start = getStartOfWeek(0).toISOString();
  const end = getStartOfWeek(1).toISOString();
  return committed.value
    .filter((e) => e.startTime >= start && e.startTime < end)
    .reduce((sum, e) => sum + e.duration, 0) / 3600;
});

const lastWeekHours = computed(() => {
  const start = getStartOfWeek(-1).toISOString();
  const end = getStartOfWeek(0).toISOString();
  return committed.value
    .filter((e) => e.startTime >= start && e.startTime < end)
    .reduce((sum, e) => sum + e.duration, 0) / 3600;
});

// Relative percentage for bar visualization (max out at 40 hours standard)
const thisWeekPercent = computed(() => {
  const target = 40;
  return Math.min(100, Math.max(5, (thisWeekHours.value / target) * 100));
});

const lastWeekPercent = computed(() => {
  const target = 40;
  return Math.min(100, Math.max(5, (lastWeekHours.value / target) * 100));
});
</script>
