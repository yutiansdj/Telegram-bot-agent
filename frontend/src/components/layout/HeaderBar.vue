<script setup>
import { computed, h } from 'vue';
import {
  NButton, NIcon, NDropdown, NTooltip, NBreadcrumb, NBreadcrumbItem, NAvatar, NBadge,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useRoute, useRouter } from 'vue-router';
import { useThemeStore } from '@/stores/theme';
import { useAuthStore } from '@/stores/auth';
import { useTabsStore } from '@/stores/tabs';
import GlobalSearch from './GlobalSearch.vue';

const theme = useThemeStore();
const auth = useAuthStore();
const tabs = useTabsStore();
const route = useRoute();
const router = useRouter();

const title = computed(() => route.meta.title || '');
const isAdminPage = computed(() => route.path.startsWith('/admin'));

const userOptions = computed(() => [
  { label: `已登录：${auth.displayName}`, key: 'info', disabled: true },
  { type: 'divider', key: 'd1' },
  { label: '个人设置', key: 'profile', icon: () => h(NIcon, null, { default: () => h(Icon, { icon: 'tabler:user-circle' }) }) },
  { label: theme.dark ? '切换到浅色' : '切换到深色', key: 'theme', icon: () => h(NIcon, null, { default: () => h(Icon, { icon: theme.dark ? 'tabler:sun' : 'tabler:moon' }) }) },
  { type: 'divider', key: 'd2' },
  { label: '退出登录', key: 'logout', icon: () => h(NIcon, null, { default: () => h(Icon, { icon: 'tabler:logout' }) }) },
]);

function onUserSelect(key) {
  if (key === 'profile') router.push('/profile');
  else if (key === 'theme') theme.toggleDark();
  else if (key === 'logout') {
    window.$dialog.warning({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      positiveText: '退出',
      negativeText: '取消',
      onPositiveClick: () => {
        tabs.reset();
        auth.logout();
      },
    });
  }
}
</script>

<template>
  <header class="header">
    <!-- 左侧：移动端菜单 / 折叠 -->
    <div class="flex items-center gap-1">
      <NButton quaternary circle class="lg:hidden" @click="$emit('open-drawer')">
        <template #icon><NIcon size="20"><Icon icon="tabler:menu-2" /></NIcon></template>
      </NButton>
      <NTooltip placement="bottom" :delay="400">
        <template #trigger>
          <NButton quaternary circle class="hide-mobile" @click="theme.toggleCollapse()">
            <template #icon><NIcon size="19"><Icon :icon="theme.collapsed ? 'tabler:layout-sidebar-left-expand' : 'tabler:layout-sidebar-left-collapse'" /></NIcon></template>
          </NButton>
        </template>
        {{ theme.collapsed ? '展开菜单' : '收起菜单' }}
      </NTooltip>
    </div>

    <!-- 中间：面包屑 -->
    <div class="breadcrumb-wrap">
      <NBreadcrumb>
        <NBreadcrumbItem>
          <span class="crumb-muted">TG 代理平台</span>
        </NBreadcrumbItem>
        <NBreadcrumbItem v-if="isAdminPage">
          <span class="crumb-muted">运维后台</span>
        </NBreadcrumbItem>
        <NBreadcrumbItem>
          <span class="crumb-current">{{ title }}</span>
        </NBreadcrumbItem>
      </NBreadcrumb>
    </div>

    <!-- 右侧：操作 -->
    <div class="flex items-center gap-1">
      <GlobalSearch />
      <NTooltip placement="bottom" :delay="400">
        <template #trigger>
          <NButton quaternary circle @click="theme.toggleDark()">
            <template #icon><NIcon size="18"><Icon :icon="theme.dark ? 'tabler:sun' : 'tabler:moon'" /></NIcon></template>
          </NButton>
        </template>
        {{ theme.dark ? '浅色模式' : '深色模式' }}
      </NTooltip>

      <NButton quaternary circle tag="a" href="/guide" title="使用教程" class="hide-mobile">
        <template #icon><NIcon size="18"><Icon icon="tabler:help-circle" /></NIcon></template>
      </NButton>

      <div class="header-sep hide-mobile" />

      <NDropdown trigger="click" :options="userOptions" @select="onUserSelect">
        <div class="user-chip">
          <NAvatar round :size="28" color="var(--tg-brand-soft)" :style="{ color: 'var(--tg-brand)', fontWeight: 600, fontSize: '13px' }">
            {{ auth.displayName.slice(0, 1).toUpperCase() }}
          </NAvatar>
          <div class="user-meta hide-mobile">
            <div class="user-name">{{ auth.displayName }}</div>
            <div class="user-role">{{ auth.isAdmin ? '管理员' : '普通用户' }}</div>
          </div>
          <NIcon size="14" class="tg-text-3 hide-mobile"><Icon icon="tabler:chevron-down" /></NIcon>
        </div>
      </NDropdown>
    </div>
  </header>
</template>

<style scoped>
.header {
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 8px;
  background: var(--tg-header);
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--tg-border);
  position: relative;
  z-index: 20;
}
.breadcrumb-wrap { flex: 1; min-width: 0; padding: 0 4px; overflow: hidden; white-space: nowrap; }
.crumb-muted { color: var(--tg-text-3); font-size: 13px; }
.crumb-current { color: var(--tg-text); font-weight: 500; font-size: 13px; }
.header-sep { width: 1px; height: 20px; background: var(--tg-border); margin: 0 4px; }
.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 4px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.user-chip:hover { background: var(--tg-surface-2); }
.user-meta { line-height: 1.2; }
.user-name { font-size: 13px; font-weight: 500; color: var(--tg-text); max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.user-role { font-size: 11px; color: var(--tg-text-3); }
</style>
