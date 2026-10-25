<script setup>
import { ref, computed, onMounted, watch, h } from 'vue';
import { NEmpty, NSkeleton } from 'naive-ui';
import { fmtBytes } from '@/utils/format';

const props = defineProps({
  data: { type: Array, default: () => [] }, // [{date, up, down, total}]
  days: { type: Number, default: null },
  height: { type: Number, default: 180 },
  loading: Boolean,
});

const palette = ref(['total', 'up', 'down']);

const points = computed(() => {
  const d = props.data.filter((x) => x);
  if (!d.length) return [];
  const max = Math.max(...d.map((x) => x.total || 0), 1);
  return d.map((x, i) => ({
    ...x,
    x: d.length === 1 ? 50 : (i / (d.length - 1)) * 100,
    yTotal: 100 - ((x.total || 0) / max) * 100,
    yUp: 100 - ((x.up || 0) / max) * 100,
    yDown: 100 - ((x.down || 0) / max) * 100,
  }));
});

function path(key) {
  const p = points.value;
  if (!p.length) return '';
  if (p.length === 1) return `M 0 ${p[0][key]} L 100 ${p[0][key]}`;
  let d = `M ${p[0].x} ${p[0][key]}`;
  for (let i = 1; i < p.length; i++) {
    const prev = p[i - 1];
    const cur = p[i];
    const cx = (prev.x + cur.x) / 2;
    d += ` C ${cx} ${prev[key]}, ${cx} ${cur[key]}, ${cur.x} ${cur[key]}`;
  }
  return d;
}

function area(key) {
  const p = points.value;
  if (!p.length) return '';
  return `${path(key)} L ${p[p.length - 1].x} 100 L ${p[0].x} 100 Z`;
}

const maxVal = computed(() => Math.max(...props.data.map((x) => x.total || 0), 1));
const hoverIdx = ref(null);
const hoverPoint = computed(() => (hoverIdx.value === null ? null : points.value[hoverIdx.value]));
</script>

<template>
  <div class="spark-wrap" :style="{ height: height + 'px' }">
    <NSkeleton v-if="loading" height="100%" :sharp="false" />
    <NEmpty v-else-if="!points.length" size="small" description="暂无数据" class="h-full justify-center" />
    <template v-else>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="spark-svg">
        <defs>
          <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2450eb" stop-opacity="0.22" />
            <stop offset="100%" stop-color="#2450eb" stop-opacity="0" />
          </linearGradient>
        </defs>
        <line v-for="y in [25, 50, 75]" :key="y" x1="0" :y1="y" x2="100" :y2="y" stroke="var(--tg-border)" stroke-width="0.4" vector-effect="non-scaling-stroke" />
        <path :d="area('yTotal')" fill="url(#gradTotal)" stroke="none" />
        <path :d="path('yTotal')" fill="none" stroke="#2450eb" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linecap="round" />
        <path :d="path('yUp')" fill="none" stroke="#16a34a" stroke-width="1.2" stroke-dasharray="3 2" vector-effect="non-scaling-stroke" opacity="0.85" />
        <path :d="path('yDown')" fill="none" stroke="#d97706" stroke-width="1.2" stroke-dasharray="3 2" vector-effect="non-scaling-stroke" opacity="0.85" />
      </svg>
      <!-- 悬停交互 -->
      <div class="spark-hit">
        <div
          v-for="(p, i) in points"
          :key="p.date"
          class="spark-cell"
          @mouseenter="hoverIdx = i"
          @mouseleave="hoverIdx = null"
        />
      </div>
      <div
        v-if="hoverPoint"
        class="spark-tip"
        :style="{ left: Math.min(88, Math.max(12, hoverPoint.x)) + '%' }"
      >
        <div class="font-medium">{{ hoverPoint.date }}</div>
        <div>总 {{ fmtBytes(hoverPoint.total) }}</div>
        <div class="tg-text-3">↓ {{ fmtBytes(hoverPoint.down) }} / ↑ {{ fmtBytes(hoverPoint.up) }}</div>
      </div>
      <div class="spark-axis">
        <span>{{ points[0]?.date.slice(5) }}</span>
        <span>峰值 {{ fmtBytes(maxVal) }}</span>
        <span>{{ points[points.length - 1]?.date.slice(5) }}</span>
      </div>
      <div class="spark-legend">
        <span><i style="background:#2450eb" />合计</span>
        <span><i style="background:#16a34a" />上行</span>
        <span><i style="background:#d97706" />下行</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.spark-wrap { position: relative; width: 100%; display: flex; flex-direction: column; }
.spark-svg { position: absolute; inset: 0 0 22px 0; width: 100%; height: calc(100% - 22px); }
.spark-hit { position: absolute; inset: 0 0 22px 0; display: flex; }
.spark-cell { flex: 1; }
.spark-tip {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  background: var(--tg-surface);
  border: 1px solid var(--tg-border);
  box-shadow: 0 8px 24px rgba(16, 24, 40, 0.1);
  border-radius: 8px;
  padding: 6px 9px;
  font-size: 11.5px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 2;
  line-height: 1.5;
}
.spark-axis {
  position: absolute; bottom: 0; left: 0; right: 0;
  display: flex; justify-content: space-between;
  font-size: 11px; color: var(--tg-text-3);
}
.spark-legend { position: absolute; top: -2px; right: 0; display: none; }
</style>
