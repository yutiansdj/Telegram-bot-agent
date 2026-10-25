<script setup>
import { ref, onMounted, computed } from 'vue';
import { NButton, NIcon, NRadioGroup, NRadio, NSlider, NAlert } from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { useThemeStore } from '@/stores/theme';

const theme = useThemeStore();
const loading = ref(true);
const saving = ref(false);
const s = ref({});

const presets = [
  { key: 'default', name: '经典蓝', light: '#2450eb', dark: '#6b8ff8', desc: '企业后台默认配色' },
  { key: 'green', name: '青竹绿', light: '#0f9d58', dark: '#4ade80', desc: '清爽自然' },
  { key: 'violet', name: '星夜紫', light: '#7c3aed', dark: '#a78bfa', desc: '科技感强' },
  { key: 'orange', name: '琥珀橙', light: '#ea580c', dark: '#fb923c', desc: '活力醒目' },
  { key: 'cyan', name: '冰川青', light: '#0e7490', dark: '#22d3ee', desc: '冷静专业' },
  { key: 'rose', name: '玫瑰红', light: '#e11d48', dark: '#fb7185', desc: '高对比度' },
];

function toggle(name) { s.value[name] = s.value[name] === '1' ? '0' : '1'; }

function applyPreset(p) {
  s.value.ui_theme = p.key;
  s.value.ui_primary_light = p.light;
  s.value.ui_primary_dark = p.dark;
  preview();
}

/** 实时预览（不保存到服务器） */
function preview() {
  const root = document.documentElement;
  if (s.value.ui_primary_light && !theme.dark) root.style.setProperty('--tg-brand', s.value.ui_primary_light);
  if (s.value.ui_primary_dark && theme.dark) root.style.setProperty('--tg-brand', s.value.ui_primary_dark);
  if (s.value.ui_radius) root.style.setProperty('--tg-radius', s.value.ui_radius + 'px');
  if (s.value.ui_sidebar_style) theme.setSidebarStyle(s.value.ui_sidebar_style);
}

async function load() {
  loading.value = true;
  try {
    const res = await api.adminSettings();
    s.value = { ...res.data.settings };
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function save() {
  saving.value = true;
  try {
    await api.adminSaveSettings(s.value);
    window.$message.success('外观设置已保存');
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

async function reset() {
  s.value.ui_theme = 'default';
  s.value.ui_primary_light = '#2450eb';
  s.value.ui_primary_dark = '#6b8ff8';
  s.value.ui_radius = '7';
  s.value.ui_sidebar_style = 'light';
  s.value.ui_font_size = '14';
  s.value.ui_density = 'normal';
  s.value.ui_login_style = 'split';
  preview();
}

const currentPreset = computed(() => presets.find((p) => p.key === s.value.ui_theme)?.name || '自定义');

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="外观主题" subtitle="配色方案、圆角、侧栏风格、字体与登录页样式" icon="tabler:palette">
      <template #actions>
        <NButton size="small" quaternary @click="reset">恢复默认</NButton>
        <NButton type="primary" size="small" :loading="saving" @click="save">保存设置</NButton>
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-3 items-start">
      <div class="flex flex-col gap-3">
        <!-- 主题预设 -->
        <div class="tg-card p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="tg-section-title">
              <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:color-swatch" /></NIcon>
              主题预设
            </div>
            <span class="text-xs tg-text-3">当前：{{ currentPreset }}</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <button
              v-for="p in presets" :key="p.key"
              class="preset" :class="{ active: s.ui_theme === p.key }"
              :style="{ '--c': p.light }"
              @click="applyPreset(p)"
            >
              <div class="preset-bar" :style="{ background: `linear-gradient(90deg, ${p.light}, ${p.dark})` }" />
              <div class="preset-body">
                <div class="font-medium text-[13px]">{{ p.name }}</div>
                <div class="text-[11.5px] tg-text-3">{{ p.desc }}</div>
              </div>
              <NIcon v-if="s.ui_theme === p.key" size="14" class="preset-check"><Icon icon="tabler:check" /></NIcon>
            </button>
          </div>
        </div>

        <!-- 细节调整 -->
        <div class="tg-card p-5">
          <div class="tg-section-title mb-4">
            <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:adjustments" /></NIcon>
            界面细节
          </div>

          <div class="opt-row">
            <div>
              <div class="text-[13.5px] font-medium">侧边栏风格</div>
              <div class="text-xs tg-text-3">浅色适合日常，深蓝品牌色更有辨识度</div>
            </div>
            <NRadioGroup :value="s.ui_sidebar_style" size="small" @update:value="(v) => { s.ui_sidebar_style = v; preview(); }">
              <NRadio value="light">浅色</NRadio>
              <NRadio value="brand">品牌深色</NRadio>
            </NRadioGroup>
          </div>

          <div class="opt-row">
            <div>
              <div class="text-[13.5px] font-medium">页面密度</div>
              <div class="text-xs tg-text-3">紧凑模式一屏显示更多内容</div>
            </div>
            <NRadioGroup :value="s.ui_density" size="small" @update:value="(v) => { s.ui_density = v; }">
              <NRadio value="compact">紧凑</NRadio>
              <NRadio value="normal">默认</NRadio>
              <NRadio value="loose">宽松</NRadio>
            </NRadioGroup>
          </div>

          <div class="opt-row">
            <div>
              <div class="text-[13.5px] font-medium">登录页样式</div>
              <div class="text-xs tg-text-3">左右分栏或居中卡片</div>
            </div>
            <NRadioGroup :value="s.ui_login_style" size="small" @update:value="(v) => { s.ui_login_style = v; }">
              <NRadio value="split">左右分栏</NRadio>
              <NRadio value="center">居中卡片</NRadio>
            </NRadioGroup>
          </div>

          <div class="opt-row">
            <div>
              <div class="text-[13.5px] font-medium">界面圆角</div>
              <div class="text-xs tg-text-3">{{ s.ui_radius }} px</div>
            </div>
            <NSlider
              :value="Number(s.ui_radius) || 7" :min="0" :max="16" :step="1"
              style="width: 180px" @update:value="(v) => { s.ui_radius = String(v); preview(); }"
            />
          </div>

          <div class="opt-row">
            <div>
              <div class="text-[13.5px] font-medium">基础字号</div>
              <div class="text-xs tg-text-3">{{ s.ui_font_size }} px（重新登录后完全生效）</div>
            </div>
            <NSlider
              :value="Number(s.ui_font_size) || 14" :min="12" :max="16" :step="1"
              style="width: 180px" @update:value="(v) => { s.ui_font_size = String(v); }"
            />
          </div>
        </div>

        <!-- 自定义主色 -->
        <div class="tg-card p-5">
          <div class="tg-section-title mb-4">
            <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:droplet" /></NIcon>
            自定义主色
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="color-field">
              <div class="text-xs tg-text-3 mb-1">浅色模式主色</div>
              <div class="flex items-center gap-2">
                <input type="color" :value="s.ui_primary_light" class="swatch" @input="(e) => { s.ui_primary_light = e.target.value; preview(); }" />
                <span class="font-mono text-xs">{{ s.ui_primary_light }}</span>
              </div>
            </div>
            <div class="color-field">
              <div class="text-xs tg-text-3 mb-1">深色模式主色</div>
              <div class="flex items-center gap-2">
                <input type="color" :value="s.ui_primary_dark" class="swatch" @input="(e) => { s.ui_primary_dark = e.target.value; preview(); }" />
                <span class="font-mono text-xs">{{ s.ui_primary_dark }}</span>
              </div>
            </div>
          </div>
          <NAlert type="info" :bordered="false" class="mt-3">
            颜色调整会实时预览；保存后再刷新页面即可全局生效（包括按钮、链接与选中态）。
          </NAlert>
        </div>
      </div>

      <!-- 预览区 -->
      <div class="tg-card p-4 sticky top-0">
        <div class="tg-section-title mb-3">效果预览</div>
        <div class="mini-app">
          <div class="mini-side" :class="{ brand: s.ui_sidebar_style === 'brand' }">
            <div class="mini-logo" />
            <div class="mini-item active" :style="{ background: s.ui_primary_light }" />
            <div class="mini-item" />
            <div class="mini-item" />
            <div class="mini-item" />
          </div>
          <div class="mini-main">
            <div class="mini-card">
              <div class="mini-title" :style="{ color: s.ui_primary_light }">示例卡片</div>
              <div class="mini-text" />
              <div class="mini-text short" />
              <div class="mini-btn" :style="{ background: s.ui_primary_light, borderRadius: (Number(s.ui_radius) || 7) + 'px' }">按钮</div>
            </div>
          </div>
        </div>
        <div class="text-xs tg-text-3 mt-3 leading-relaxed">
          预览基于当前选择的配色与圆角。拖拽滑块或点击色块可实时查看变化。
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preset {
  position: relative; overflow: hidden; text-align: left;
  border: 1px solid var(--tg-border); border-radius: 9px;
  background: var(--tg-surface); cursor: pointer; padding: 0;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.preset:hover { border-color: var(--tg-border-strong); box-shadow: 0 6px 16px rgba(16,24,40,.06); }
.preset.active { border-color: var(--c); box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 18%, transparent); }
.preset-bar { height: 34px; }
.preset-body { padding: 8px 10px; }
.preset-check { position: absolute; top: 8px; right: 8px; color: #fff; background: rgba(0,0,0,.25); border-radius: 50%; padding: 2px; }
.opt-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 0; border-bottom: 1px dashed var(--tg-border);
}
.opt-row:last-child { border-bottom: none; }
.swatch { width: 34px; height: 30px; border: 1px solid var(--tg-border); border-radius: 7px; padding: 2px; background: var(--tg-surface); cursor: pointer; }
.color-field { background: var(--tg-surface-2); border: 1px solid var(--tg-border); border-radius: 8px; padding: 10px; }

.mini-app { display: flex; height: 190px; border: 1px solid var(--tg-border); border-radius: 9px; overflow: hidden; background: var(--tg-bg); }
.mini-side { width: 64px; background: var(--tg-surface); border-right: 1px solid var(--tg-border); padding: 10px 8px; display: flex; flex-direction: column; gap: 6px; }
.mini-side.brand { background: linear-gradient(180deg, #1b2547, #141c36); border-color: #1d2540; }
.mini-logo { width: 20px; height: 20px; border-radius: 6px; background: linear-gradient(140deg,#3b6df6,#1d3cd8); margin-bottom: 6px; }
.mini-item { height: 8px; border-radius: 4px; background: var(--tg-border); }
.mini-side.brand .mini-item { background: rgba(255,255,255,.18); }
.mini-main { flex: 1; padding: 12px; }
.mini-card { background: var(--tg-surface); border: 1px solid var(--tg-border); border-radius: 8px; padding: 10px; }
.mini-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; }
.mini-text { height: 7px; border-radius: 4px; background: var(--tg-border); margin-bottom: 6px; }
.mini-text.short { width: 60%; }
.mini-btn { margin-top: 10px; color: #fff; font-size: 11px; text-align: center; padding: 5px 0; }
</style>
