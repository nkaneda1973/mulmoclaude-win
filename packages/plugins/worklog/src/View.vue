<template>
  <div class="p-6 font-sans text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-xl max-w-6xl mx-auto flex flex-col gap-6">
    
    <!-- Top Dashboard Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-gray-100 dark:border-gray-800 pb-4 gap-4">
      <div class="flex items-center gap-3">
        <div class="p-2.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl">
          <span aria-hidden="true" class="text-2xl">⏱️</span>
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight text-gray-900 dark:text-white">Solopreneur OS</h1>
          <p class="text-xs text-gray-500 dark:text-gray-400">Worklog Management Module (Manual Mode)</p>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="flex bg-gray-50 dark:bg-gray-800/60 p-1 rounded-xl border border-gray-100 dark:border-gray-800">
        <button
          @click="activeTab = 'rollup'"
          class="px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all duration-200"
          :class="activeTab === 'rollup' ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
        >
          {{ t.weeklyRollup }}
        </button>
        <button
          @click="activeTab = 'review'"
          class="px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all duration-200 flex items-center gap-1.5"
          :class="activeTab === 'review' ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'"
        >
          <span>{{ t.reviewBoard }}</span>
          <span
            v-if="candidates.length > 0"
            class="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200"
          >
            {{ candidates.length }}
          </span>
        </button>
      </div>
    </div>

    <!-- MAIN BODY TABS -->
    <div class="flex-1">
      
      <!-- TAB 1: WEEKLY SUMMARY ROLLUP GRID -->
      <div v-if="activeTab === 'rollup'" class="flex flex-col gap-6 animate-fadeIn">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            📊 {{ t.weeklyRollup }}
          </h2>
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {{ formatWeekRange() }}
          </span>
        </div>

        <!-- Spreadsheet rollup grid -->
        <div class="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm bg-gray-50/50 dark:bg-gray-900/50">
          <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-xs">
            <thead class="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th scope="col" class="px-4 py-3 text-left font-bold text-gray-600 dark:text-gray-300 w-1/3">
                  {{ t.client }} / {{ t.project }}
                </th>
                <th v-for="day in weekDays" :key="day.dateStr" scope="col" class="px-3 py-3 text-center font-bold text-gray-600 dark:text-gray-300">
                  {{ day.label }}
                  <span class="block text-[10px] font-normal text-gray-400 dark:text-gray-500">{{ formatDateLabel(day.dateStr) }}</span>
                </th>
                <th scope="col" class="px-4 py-3 text-center font-bold text-indigo-600 dark:text-indigo-400">
                  {{ t.total }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-900">
              <tr v-if="rollupRows.length === 0">
                <td :colspan="9" class="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                  {{ t.noCommitted }}
                </td>
              </tr>
              <tr v-for="row in rollupRows" :key="row.key" class="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                <td class="px-4 py-3 font-semibold text-gray-900 dark:text-white">
                  {{ row.key }}
                </td>
                <td v-for="day in weekDays" :key="day.dateStr" class="px-3 py-3 text-center">
                  <span v-if="row.hours[day.dateStr] > 0" class="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium">
                    {{ row.hours[day.dateStr].toFixed(1) }}h
                  </span>
                  <span v-else class="text-gray-300 dark:text-gray-700">-</span>
                </td>
                <td class="px-4 py-3 text-center font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50/10 dark:bg-indigo-950/10">
                  {{ row.total.toFixed(1) }}h
                </td>
              </tr>
              <!-- Totals row -->
              <tr v-if="rollupRows.length > 0" class="bg-gray-50 dark:bg-gray-800 font-bold border-t-2 border-gray-200 dark:border-gray-700">
                <td class="px-4 py-3 text-gray-700 dark:text-gray-300">
                  {{ t.total }}
                </td>
                <td v-for="day in weekDays" :key="day.dateStr" class="px-3 py-3 text-center text-gray-900 dark:text-white">
                  {{ dayTotals.totals[day.dateStr] > 0 ? dayTotals.totals[day.dateStr].toFixed(1) + 'h' : '-' }}
                </td>
                <td class="px-4 py-3 text-center text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 dark:bg-indigo-400/10 text-sm">
                  {{ dayTotals.grandTotal.toFixed(1) }}h
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Detailed list of committed entries with inline editing and deletion -->
        <div class="flex flex-col gap-3 mt-4">
          <h3 class="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
            📝 Details
          </h3>
          
          <div class="flex flex-col gap-3">
            <div
              v-for="entry in thisWeekCommitted"
              :key="entry.id"
              class="p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800/40 hover:shadow-md transition-shadow flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            >
              <!-- Editing Entry State -->
              <div v-if="editingEntryId === entry.id" class="flex-1 flex flex-col gap-3">
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label class="block text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-1">{{ t.client }}</label>
                    <input v-model="editForm.clientId" type="text" class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none" />
                  </div>
                  <div>
                    <label class="block text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-1">{{ t.project }}</label>
                    <input v-model="editForm.projectId" type="text" class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none" />
                  </div>
                  <div>
                    <label class="block text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-1">{{ t.billable }}</label>
                    <label class="inline-flex items-center mt-1 cursor-pointer">
                      <input v-model="editForm.billable" type="checkbox" class="sr-only peer" />
                      <div class="relative w-7 h-4 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-500"></div>
                    </label>
                  </div>
                  <div>
                    <label class="block text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-1">{{ t.startTime }}</label>
                    <input v-model="editForm.startTime" type="text" class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none" />
                  </div>
                  <div>
                    <label class="block text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-1">{{ t.endTime }}</label>
                    <input v-model="editForm.endTime" type="text" class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label class="block text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-1">{{ t.notes }}</label>
                  <textarea v-model="editForm.notes" rows="2" class="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"></textarea>
                </div>
                <div class="flex justify-end gap-2 mt-2">
                  <button @click="editingEntryId = null" class="px-3 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-lg text-xs font-semibold transition-colors">
                    {{ t.cancel }}
                  </button>
                  <button @click="saveEditCommitted(entry.id)" class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition-colors">
                    {{ t.save }}
                  </button>
                </div>
              </div>

              <!-- Standard View Committed State -->
              <div v-else class="flex-1 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div class="flex-1 flex flex-col gap-1.5">
                  <div class="flex items-center flex-wrap gap-2 text-xs">
                    <span class="font-bold text-gray-900 dark:text-white text-sm">{{ entry.clientId }}</span>
                    <span v-if="entry.projectId" class="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                      {{ entry.projectId }}
                    </span>
                    <span
                      class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                      :class="entry.billable ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400' : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400'"
                    >
                      {{ entry.billable ? t.billable : "Non-billable" }}
                    </span>
                  </div>
                  <div class="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
                    <span>{{ formatTimeRange(entry.startTime, entry.endTime) }}</span>
                    <span>•</span>
                    <span class="font-bold text-gray-600 dark:text-gray-300">{{ (entry.duration / 3600).toFixed(2) }} hrs</span>
                  </div>
                  <p v-if="entry.notes" class="text-xs text-gray-600 dark:text-gray-400 mt-1 pl-2 border-l border-gray-200 dark:border-gray-700">
                    {{ entry.notes }}
                  </p>
                </div>

                <!-- Edit and Delete Actions -->
                <div class="flex items-center gap-2 self-end sm:self-center">
                  <button
                    @click="startEditCommitted(entry)"
                    class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                    :title="t.edit"
                  >
                    ✏️
                  </button>
                  <button
                    @click="deleteCommitted(entry.id)"
                    class="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-rose-600 dark:text-gray-400 dark:hover:text-rose-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                    :title="t.delete"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- TAB 2: CANDIDATE REVIEW BOARD -->
      <div v-if="activeTab === 'review'" class="flex flex-col gap-6 animate-fadeIn">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
            📂 {{ t.reviewBoard }}
          </h2>
        </div>

        <div v-if="candidates.length === 0" class="px-6 py-12 text-center text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/10">
          <div class="text-3xl mb-2">📋</div>
          <p class="text-sm">{{ t.noCandidates }}</p>
        </div>

        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            v-for="candidate in candidates"
            :key="candidate.id"
            class="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/40 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
          >
            <!-- Inferred tag indicator -->
            <div class="absolute top-0 right-0 w-24 h-24 pointer-events-none overflow-hidden">
              <div
                class="absolute transform rotate-45 bg-indigo-500/10 dark:bg-indigo-400/10 text-indigo-600 dark:text-indigo-400 font-bold text-[9px] text-center py-1 w-[120px] top-4 -right-6 uppercase tracking-wider border-b border-indigo-200/20"
              >
                {{ t.confidence }}: {{ Math.round(candidate.confidence * 100) }}%
              </div>
            </div>

            <!-- Card Heading / Identity -->
            <div class="flex flex-col gap-1.5">
              <div class="flex items-center flex-wrap gap-2 pr-12">
                <input
                  v-model="candidate.clientId"
                  type="text"
                  class="font-bold text-gray-900 dark:text-white bg-transparent border-b border-dashed border-gray-300 focus:border-indigo-500 focus:outline-none text-sm px-1 py-0.5"
                  placeholder="Client"
                />
                <input
                  v-model="candidate.projectId"
                  type="text"
                  class="text-xs text-gray-500 dark:text-gray-400 bg-transparent border-b border-dashed border-gray-300 focus:border-indigo-500 focus:outline-none px-1 py-0.5 w-32"
                  placeholder="Project (optional)"
                />
              </div>

              <!-- Inline Billable checkbox -->
              <div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mt-1">
                <input v-model="candidate.billable" type="checkbox" :id="'bill-' + candidate.id" class="rounded border-gray-300 dark:border-gray-700 text-indigo-600 focus:ring-indigo-500" />
                <label :for="'bill-' + candidate.id" class="cursor-pointer">{{ t.billable }}</label>
              </div>
            </div>

            <!-- Time Ranges block -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-gray-50 dark:bg-gray-900 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
              <div>
                <label class="block text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-0.5">{{ t.startTime }}</label>
                <input
                  v-model="candidate.startTime"
                  type="text"
                  class="w-full bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none font-medium px-0.5"
                  @change="updateCandidateDuration(candidate)"
                />
              </div>
              <div>
                <label class="block text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-0.5">{{ t.endTime }}</label>
                <input
                  v-model="candidate.endTime"
                  type="text"
                  class="w-full bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none font-medium px-0.5"
                  @change="updateCandidateDuration(candidate)"
                />
              </div>
              <div class="sm:col-span-2 pt-1 border-t border-gray-200/20 flex justify-between items-center text-[10px] text-gray-400 font-medium">
                <span>{{ t.duration }}:</span>
                <span class="font-bold text-indigo-600 dark:text-indigo-400 text-xs">
                  {{ (candidate.duration / 3600).toFixed(2) }} hours
                </span>
              </div>
            </div>

            <!-- Detailed Notes -->
            <div class="flex flex-col gap-1">
              <label class="block text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{{ t.notes }}</label>
              <textarea
                v-model="candidate.notes"
                rows="2"
                class="w-full bg-gray-50/50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800 rounded-lg p-2 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              ></textarea>
            </div>

            <!-- Evidence section (if present) -->
            <div v-if="candidate.evidence && candidate.evidence.length > 0" class="flex flex-col gap-1.5">
              <label class="block text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{{ t.evidence }}</label>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="(ev, idx) in candidate.evidence"
                  :key="idx"
                  class="px-2 py-0.5 rounded-full text-[9px] font-semibold bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900"
                >
                  {{ ev.kind || 'activity' }}
                </span>
              </div>
            </div>

            <!-- Action Buttons inside Card -->
            <div class="flex justify-between items-center gap-3 mt-2 pt-3 border-t border-gray-100 dark:border-gray-800">
              <button
                @click="deleteCandidateDraft(candidate.id)"
                class="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/10 text-xs font-semibold transition-all duration-200"
              >
                {{ t.delete }}
              </button>

              <div class="flex items-center gap-2">
                <button
                  @click="saveCandidateDraft(candidate)"
                  class="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-semibold transition-all duration-200"
                >
                  {{ t.save }}
                </button>
                <button
                  @click="approveCandidateDraft(candidate.id)"
                  class="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 text-white text-xs font-bold shadow-sm transition-all duration-200"
                >
                  {{ t.approve }} ✓
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { WorklogEntry, CandidateEntry } from "./types";
import { useT } from "./lang";

const props = defineProps<{ selectedResult: ToolResultComplete<any> }>();
const t = useT();

// Tabs: 'rollup' (Weekly summary) or 'review' (Candidate board)
const activeTab = ref("rollup");

const committed = ref<WorklogEntry[]>(props.selectedResult.data?.committed ?? []);
const candidates = ref<CandidateEntry[]>(props.selectedResult.data?.candidates ?? []);

// Editcommitted entry form state
const editingEntryId = ref<string | null>(null);
const editForm = ref({
  clientId: "",
  projectId: "",
  startTime: "",
  endTime: "",
  notes: "",
  billable: true,
});

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
    // Keep snapshot on error
  }
}

let unsub: (() => void) | undefined;
onMounted(() => {
  void refresh();
  unsub = pubsub.subscribe("changed", () => {
    void refresh();
  });
  
  // If there are candidates waiting on first load, open the Review board
  if (candidates.value.length > 0) {
    activeTab.value = "review";
  }
});
onUnmounted(() => unsub?.());

watch(
  () => props.selectedResult.uuid,
  () => {
    committed.value = props.selectedResult.data?.committed ?? [];
    candidates.value = props.selectedResult.data?.candidates ?? [];
    void refresh();
  },
);

// Date Helpers
function getStartOfWeek(offsetWeeks = 0): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + (offsetWeeks * 7);
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
}

const weekDays = computed(() => {
  const base = getStartOfWeek(0);
  const days: { dateStr: string; label: string }[] = [];
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + i * 24 * 3600 * 1000);
    days.push({
      dateStr: d.toISOString().substring(0, 10),
      label: weekdays[i],
    });
  }
  return days;
});

function formatDateLabel(dateStr: string): string {
  // Return e.g. "05/20"
  return dateStr.substring(5).replace("-", "/");
}

function formatWeekRange(): string {
  const start = getStartOfWeek(0);
  const end = new Date(start.getTime() + 6 * 24 * 3600 * 1000);
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function formatTimeRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const dateStr = s.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const sTime = s.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const eTime = e.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${dateStr}, ${sTime} - ${eTime}`;
}

// Group entries in current week
const thisWeekCommitted = computed(() => {
  const start = getStartOfWeek(0).toISOString().substring(0, 10);
  const end = new Date(getStartOfWeek(0).getTime() + 7 * 24 * 3600 * 1000).toISOString().substring(0, 10);
  return committed.value
    .filter((e) => {
      const dStr = e.startTime.substring(0, 10);
      return dStr >= start && dStr < end;
    })
    .sort((a, b) => b.startTime.localeCompare(a.startTime));
});

// Grouped rollup row calculations for sheet view
interface RollupRow {
  key: string;
  hours: Record<string, number>;
  total: number;
}

const rollupRows = computed(() => {
  const days = weekDays.value;
  const start = days[0].dateStr;
  const end = new Date(new Date(days[6].dateStr).getTime() + 24 * 3600 * 1000).toISOString().substring(0, 10);

  const weekEntries = committed.value.filter((e) => {
    const dStr = e.startTime.substring(0, 10);
    return dStr >= start && dStr < end;
  });

  const rowMap = new Map<string, RollupRow>();

  for (const e of weekEntries) {
    const key = e.projectId ? `${e.clientId} / ${e.projectId}` : e.clientId;
    const dateStr = e.startTime.substring(0, 10);
    const hrs = e.duration / 3600;

    if (!rowMap.has(key)) {
      rowMap.set(key, {
        key,
        hours: {},
        total: 0,
      });
    }

    const row = rowMap.get(key)!;
    row.hours[dateStr] = (row.hours[dateStr] || 0) + hrs;
    row.total += hrs;
  }

  return Array.from(rowMap.values()).sort((a, b) => b.total - a.total);
});

const dayTotals = computed(() => {
  const totals: Record<string, number> = {};
  let grandTotal = 0;
  for (const day of weekDays.value) {
    let daySum = 0;
    for (const row of rollupRows.value) {
      daySum += row.hours[day.dateStr] || 0;
    }
    totals[day.dateStr] = daySum;
    grandTotal += daySum;
  }
  return { totals, grandTotal };
});

// Action Dispatches

// 1. Candidate Actions
function updateCandidateDuration(candidate: CandidateEntry) {
  try {
    const startMs = new Date(candidate.startTime).getTime();
    const endMs = new Date(candidate.endTime).getTime();
    if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
      candidate.duration = Math.floor((endMs - startMs) / 1000);
    }
  } catch {
    // Ignore invalid dates during typing
  }
}

async function saveCandidateDraft(candidate: CandidateEntry) {
  const result = await dispatch<RefreshResponse>({
    kind: "candidateSave",
    candidate: { ...candidate },
  });
  if (result.data) {
    if (result.data.candidates) candidates.value = result.data.candidates;
    if (result.data.committed) committed.value = result.data.committed;
  }
}

async function deleteCandidateDraft(id: string) {
  const result = await dispatch<RefreshResponse>({
    kind: "candidateDelete",
    id,
  });
  if (result.data) {
    if (result.data.candidates) candidates.value = result.data.candidates;
    if (result.data.committed) committed.value = result.data.committed;
  }
}

async function approveCandidateDraft(id: string) {
  const result = await dispatch<RefreshResponse>({
    kind: "candidateApprove",
    id,
  });
  if (result.data) {
    if (result.data.candidates) candidates.value = result.data.candidates;
    if (result.data.committed) committed.value = result.data.committed;
  }
}

// 2. Committed Actions
function startEditCommitted(entry: WorklogEntry) {
  editingEntryId.value = entry.id;
  editForm.value = {
    clientId: entry.clientId,
    projectId: entry.projectId || "",
    startTime: entry.startTime,
    endTime: entry.endTime,
    notes: entry.notes || "",
    billable: entry.billable,
  };
}

async function saveEditCommitted(id: string) {
  const result = await dispatch<RefreshResponse>({
    kind: "committedEdit",
    id,
    entry: {
      clientId: editForm.value.clientId,
      projectId: editForm.value.projectId || undefined,
      startTime: editForm.value.startTime,
      endTime: editForm.value.endTime,
      notes: editForm.value.notes,
      billable: editForm.value.billable,
    },
  });
  if (result.data) {
    if (result.data.candidates) candidates.value = result.data.candidates;
    if (result.data.committed) committed.value = result.data.committed;
  }
  editingEntryId.value = null;
}

async function deleteCommitted(id: string) {
  if (confirm("Are you sure you want to delete this worklog entry?")) {
    const result = await dispatch<RefreshResponse>({
      kind: "committedDelete",
      id,
    });
    if (result.data) {
      if (result.data.candidates) candidates.value = result.data.candidates;
      if (result.data.committed) committed.value = result.data.committed;
    }
  }
}
</script>

<style scoped>
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fadeIn {
  animation: fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
</style>
