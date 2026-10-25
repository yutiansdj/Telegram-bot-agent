<script setup>
import { computed, ref, watch } from 'vue';
import { NIcon, NBadge } from 'naive-ui';
import { Icon } from '@iconify/vue';
import { useRoute, useRouter } from 'vue-router';
import { useThemeStore } from '@/stores/theme';
import { useAuthStore } from '@/stores/auth';

const props = defineProps({ mobileOpen: Boolean });
const emit = defineEmits(['close']);
const theme = useThemeStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const collapsed = computed(() => theme.collapsed && !props.mobileOpen);

/**
 * 二级菜单结构
 * { label, icon, key: '/path' }            —— 单项
 * { label, icon, key: 'm-xxx', children: [] } —— 可展开的父级
 */
const menu = computed(() => {
  const items = [
    { label: '概览', icon: 'tabler:home', key: '/dashboard' },
    {
      label: '代理管理', icon: 'tabler:affiliate', key: 'm-proxy',
      children: [
        { label: '我的代理', key: '/accounts', icon: 'tabler:router' },
        { label: '流量统计', key: '/traffic', icon: 'tabler:chart-area-line' },
        { label: '使用教程', key: '/guide', icon: 'tabler:book' },
      ],
    },
    {
      label: '流量工单', icon: 'tabler:ticket', key: 'm-ticket',
      children: [
        { label: '申请流量', key: '/tickets', icon: 'tabler:send' },
        { label: '申请记录', key: '/applications', icon: 'tabler:clipboard-list' },
      ],
    },
    {
      label: '账户中心', icon: 'tabler:user-circle', key: 'm-account',
      children: [
        { label: '个人设置', key: '/profile', icon: 'tabler:settings' },
        { label: '消息通知', key: '/notifications', icon: 'tabler:bell' },
      ],
    },
  ];

  if (auth.isAdmin) {
    items.push({
      label: '运维后台', icon: 'tabler:shield-lock', key: 'm-admin', children: [
        { label: '运维总览', key: '/admin/overview', icon: 'tabler:gauge' },
        { label: '运行状态', key: '/admin/system', icon: 'tabler:activity' },
      ],
    },
    {
      label: '用户与代理', icon: 'tabler:users', key: 'm-um', children: [
        { label: '用户管理', key: '/admin/users', icon: 'tabler:users' },
        { label: '代理管理', key: '/admin/accounts', icon: 'tabler:affiliate' },
        { label: '节点管理', key: '/admin/nodes', icon: 'tabler:server-2' },
        { label: '申请审核', key: '/admin/tickets', icon: 'tabler:ticket' },
      ],
    },
    {
      label: '内容运营', icon: 'tabler:speakerphone', key: 'm-content', children: [
        { label: '公告管理', key: '/admin/notices', icon: 'tabler:speakerphone' },
        { label: '站点设置', key: '/admin/site', icon: 'tabler:world' },
        { label: '外观主题', key: '/admin/appearance', icon: 'tabler:palette' },
      ],
    },
    {
      label: '系统配置', icon: 'tabler:adjustments', key: 'm-system', children: [
        { label: '邮件服务', key: 'm-mail-dup', icon: 'tabler:mail', children: [
          { label: '发信配置', key: '/admin/smtp', icon: 'tabler:mail' },
          { label: '邮件模板', key: '/admin/templates', icon: 'tabler:template' },
        ] },
        { label: '人机验证', key: '/admin/captcha', icon: 'tabler:shield-lock' },
        { label: '机器人', key: 'm-bot', icon: 'tabler:brand-telegram', children: [
          { label: '机器人配置', key: '/admin/bot', icon: 'tabler:settings' },
          { label: '多机器人', key: '/admin/bots', icon: 'tabler:robot' },
        ] },
        { label: 'AI 与模型', key: 'm-ai', icon: 'tabler:sparkles', children: [
          { label: 'AI 助手', key: '/admin/ai', icon: 'tabler:sparkles' },
          { label: 'WorkBuddy', key: '/admin/workbuddy', icon: 'tabler:brand-openai' },
        ] },
        { label: '群组管理', key: '/admin/groups', icon: 'tabler:users-group' },
        { label: '注册与安全', key: 'm-sec-dup', icon: 'tabler:lock', children: [
          { label: '注册策略', key: '/admin/security', icon: 'tabler:lock-access' },
          { label: '登录安全', key: '/admin/loginsecurity', icon: 'tabler:shield-check' },
        ] },
        { label: '数据与备份', key: '/admin/backup', icon: 'tabler:database' },
        { label: '审计日志', key: '/admin/audit', icon: 'tabler:file-search' },
        { label: '系统设置', key: '/admin/settings', icon: 'tabler:tool' },
      ],
    });
  }
  return items;
});

// ---- 展开状态（默认展开当前路由所在父级） ----
const openKeys = ref(new Set());

function parentsOf(path, items, trail = []) {
  for (const it of items) {
    if (it.key === path) return trail;
    if (it.children) {
      const found = parentsOf(path, it.children, [...trail, it.key]);
      if (found) return found;
    }
  }
  return null;
}

function syncOpen() {
  if (collapsed.value) return;
  const parents = parentsOf(route.path, menu.value) || [];
  const next = new Set(openKeys.value);
  for (const k of parents) next.add(k);
  openKeys.value = next;
}

watch(() => route.path, syncOpen, { immediate: true });
watch(collapsed, (v) => { if (!v) syncOpen(); });

function toggle(key) {
  const next = new Set(openKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  openKeys.value = next;
}

const isActive = (item) => route.path === item.key;

function childActive(node) {
  if (!node.children) return false;
  return node.children.some((c) => (c.key === route.path) || (c.children && childActive(c)));
}

// 折叠态下点击父级：跳转到其第一个可访问子项
function firstLeaf(node) {
  let cur = node;
  while (cur.children && cur.children.length) cur = cur.children[0];
  return cur.key;
}
</script>

<template>
  <nav class="nav">
    <template v-for="item in menu" :key="item.key">
      <!-- 单层菜单 -->
      <RouterLink
        v-if="!item.children"
        :to="item.key"
        class="nav-item"
        :class="{ active: isActive(item), collapsed }"
        :title="collapsed ? item.label : ''"
        @click="emit('close')"
      >
        <NIcon size="18" class="nav-icon"><Icon :icon="item.icon" /></NIcon>
        <span v-if="!collapsed" class="nav-label">{{ item.label }}</span>
      </RouterLink>

      <!-- 二级菜单 -->
      <div v-else class="nav-group">
        <button
          class="nav-item group-btn"
          :class="{ 'has-active': childActive(item), collapsed, open: openKeys.has(item.key) }"
          :title="collapsed ? item.label : ''"
          @click="collapsed ? router.push(firstLeaf(item)) : toggle(item.key)"
        >
          <NIcon size="18" class="nav-icon"><Icon :icon="item.icon" /></NIcon>
          <template v-if="!collapsed">
            <span class="nav-label">{{ item.label }}</span>
            <NIcon size="14" class="chevron" :class="{ rotate: openKeys.has(item.key) }">
              <Icon icon="tabler:chevron-right" />
            </NIcon>
          </template>
        </button>

        <Transition name="sub">
          <div v-if="!collapsed && openKeys.has(item.key)" class="sub-wrap">
            <template v-for="child in item.children" :key="child.key">
              <!-- 第三级 -->
              <div v-if="child.children" class="nav-subgroup">
                <button class="nav-sub-btn" @click="toggle(child.key)">
                  <NIcon size="13"><Icon :icon="child.icon" /></NIcon>
                  <span>{{ child.label }}</span>
                  <NIcon size="12" class="chevron" :class="{ rotate: openKeys.has(child.key) }">
                    <Icon icon="tabler:chevron-right" />
                  </NIcon>
                </button>
                <Transition name="sub">
                  <div v-if="openKeys.has(child.key)" class="sub-wrap deep">
                    <RouterLink
                      v-for="g in child.children" :key="g.key"
                      :to="g.key" class="nav-item sub deep-link"
                      :class="{ active: route.path === g.key }"
                      @click="emit('close')"
                    >
                      <NIcon size="13"><Icon :icon="g.icon" /></NIcon>
                      <span class="nav-label">{{ g.label }}</span>
                    </RouterLink>
                  </div>
                </Transition>
              </div>
              <!-- 普通二级 -->
              <RouterLink
                v-else :to="child.key" class="nav-item sub"
                :class="{ active: route.path === child.key }"
                @click="emit('close')"
              >
                <NIcon size="14"><Icon :icon="child.icon" /></NIcon>
                <span class="nav-label">{{ child.label }}</span>
              </RouterLink>
            </template>
          </div>
        </Transition>
      </div>
    </template>
  </nav>
</template>

<style scoped>
.nav { display: flex; flex-direction: column; gap: 2px; padding: 8px 8px 20px; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 10px;
  border-radius: 7px;
  color: var(--tg-text-2);
  font-size: 13.5px;
  cursor: pointer;
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
}
.nav-item:hover { background: var(--tg-surface-2); color: var(--tg-text); }
.nav-item.active {
  background: var(--tg-brand-soft);
  color: var(--tg-brand);
  font-weight: 500;
}
.nav-item.active .nav-icon { color: var(--tg-brand); }
.nav-icon { flex-shrink: 0; color: var(--tg-text-3); }
.nav-label {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chevron { color: var(--tg-text-3); transition: transform 0.18s ease; flex-shrink: 0; }
.chevron.rotate { transform: rotate(90deg); }
.group-btn.has-active:not(.open) { color: var(--tg-text); }
.collapsed { justify-content: center; padding: 0; }

.sub-wrap {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 2px 0 4px;
  padding-left: 12px;
  border-left: 1px solid var(--tg-border);
  margin-left: 19px;
}
.sub { height: 34px; font-size: 13px; padding-left: 8px; }
.sub :deep(.nav-icon) { color: var(--tg-text-3); }
.nav-item.sub.active { background: var(--tg-brand-soft); }
.nav-subgroup { display: flex; flex-direction: column; }
.nav-sub-btn {
  display: flex; align-items: center; gap: 8px;
  height: 34px; padding: 0 8px; border: none; background: transparent;
  border-radius: 7px; color: var(--tg-text-2); font-size: 13px; cursor: pointer; width: 100%;
}
.nav-sub-btn:hover { background: var(--tg-surface-2); color: var(--tg-text); }
.nav-sub-btn span { flex: 1; text-align: left; }
.sub-wrap.deep { padding-left: 8px; margin-left: 6px; }

.sub-enter-active, .sub-leave-active { transition: opacity 0.16s ease, max-height 0.2s ease; overflow: hidden; }
.sub-enter-from, .sub-leave-to { opacity: 0; max-height: 0; }
.sub-enter-to, .sub-leave-from { opacity: 1; max-height: 400px; }
</style>
