<script setup>
import { computed, h } from 'vue';
import { NButton, NDropdown, NIcon } from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useTabsStore } from '@/stores/tabs';
import { useRouter } from 'vue-router';

const tabs = useTabsStore();
const router = useRouter();

function go(tab) {
  if (tab.path !== tabs.activePath) router.push(tab.path);
}

function close(tab) {
  if (tab.affix) return;
  const next = tabs.closeTab(tab.path);
  if (next) router.push(next);
}

function closeOthers(tab) {
  if (!tab) return;
  tabs.closeOthers(tab.path);
  router.push(tab.path);
}

function closeAll() {
  const p = tabs.closeAll();
  if (p) router.push(p);
}

const canCloseOthers = computed(() => tabs.tabs.length > tabs.tabs.filter((t) => t.affix).length + 1);

const refreshOptions = computed(() => [
  { label: '关闭其他', key: 'others', disabled: !canCloseOthers.value },
  { label: '关闭全部', key: 'all' },
]);
</script>

<template>
  <div class="tabbar">
    <div class="tabs-scroll">
      <TransitionGroup name="tab-fade">
        <div
          v-for="tab in tabs.tabs"
          :key="tab.path"
          class="tab"
          :class="{ active: tab.path === tabs.activePath }"
          @click="go(tab)"
          @auxclick.middle.prevent="close(tab)"
        >
          <NIcon v-if="tab.path === tabs.activePath" size="14" class="tab-icon">
            <Icon :icon="tab.icon" />
          </NIcon>
          <span class="tab-title">{{ tab.title }}</span>
          <button v-if="!tab.affix" class="tab-close" @click.stop="close(tab)">
            <NIcon size="12"><Icon icon="tabler:x" /></NIcon>
          </button>
          <span v-else class="tab-dot" />
        </div>
      </TransitionGroup>
    </div>
    <div class="tab-actions">
      <NButton size="tiny" quaternary title="刷新当前页" @click="tabs.refresh()">
        <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
      </NButton>
      <NDropdown
        trigger="click"
        :options="refreshOptions"
        @select="(k) => (k === 'others' ? closeOthers(tabs.activeTab) : closeAll())"
      >
        <NButton size="tiny" quaternary title="标签页操作">
          <template #icon><NIcon size="15"><Icon icon="tabler:dots-vertical" /></NIcon></template>
        </NButton>
      </NDropdown>
    </div>
  </div>
</template>

<style scoped>
.tabbar {
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  background: var(--tg-tabbar);
  border-bottom: 1px solid var(--tg-border);
  padding: 0 8px;
  gap: 4px;
}
.tabs-scroll {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs-scroll::-webkit-scrollbar { display: none; }
.tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--tg-text-2);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  border: 1px solid transparent;
  user-select: none;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.tab:hover { background: var(--tg-surface-2); border-color: var(--tg-border); }
.tab.active {
  color: var(--tg-text);
  font-weight: 500;
  background: var(--tg-surface);
  border-color: var(--tg-border);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}
.tab-icon { color: var(--tg-brand); }
.tab-close {
  display: grid;
  place-items: center;
  width: 16px; height: 16px;
  border-radius: 4px;
  color: var(--tg-text-3);
  margin-left: 2px;
}
.tab-close:hover { background: rgba(140, 148, 160, 0.18); color: var(--tg-text); }
.tab-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--tg-border-strong); margin-left: 2px; }
.tab-actions { display: flex; align-items: center; gap: 0; padding-left: 4px; border-left: 1px solid var(--tg-border); }
</style>
