<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useThemeStore } from '@/stores/theme';
import { useAuthStore } from '@/stores/auth';
import SidebarNav from './SidebarNav.vue';

const props = defineProps({ mobileOpen: Boolean });
const emit = defineEmits(['close']);
const theme = useThemeStore();
const auth = useAuthStore();
const router = useRouter();

const collapsed = computed(() => theme.collapsed && !props.mobileOpen);
const logo = computed(() => auth.info.site_logo || '');
</script>

<template>
  <aside class="sidebar" :class="{ collapsed, 'mobile-open': mobileOpen, brand: theme.sidebarBrand }">
    <div class="brand">
      <RouterLink to="/dashboard" class="brand-link" :class="{ 'justify-center': collapsed }" @click="emit('close')">
        <div class="brand-mark">
          <img v-if="logo" :src="logo" alt="logo" class="brand-img" />
          <svg v-else viewBox="0 0 24 24" width="19" height="19" fill="none">
            <path d="M20.6 4.1 3.4 10.9c-.7.3-.7 1.3.1 1.5l4.3 1.3 1.6 5.1c.2.6 1 .8 1.4.3l2.4-2.6 4.4 3.2c.5.4 1.3.1 1.5-.6l3.2-13c.2-.8-.6-1.5-1.3-1.2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="m8 13.7 8.5-6.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </div>
        <Transition name="fade">
          <div v-if="!collapsed" class="min-w-0">
            <div class="brand-title truncate">{{ auth.info.site_name || 'TG 代理平台' }}</div>
            <div class="brand-sub">MTProto Proxy</div>
          </div>
        </Transition>
      </RouterLink>
    </div>

    <div class="menu-scroll">
      <SidebarNav
        :mobile-open="mobileOpen"
        @close="emit('close')"
        @navigate="(p) => { emit('close'); router.push(p); }"
      />
    </div>

    <div class="sidebar-foot">
      <div v-if="!collapsed" class="support-box">
        <div class="text-xs font-medium">遇到问题？</div>
        <div class="text-xs tg-text-3 mt-0.5 truncate">联系 {{ auth.info.support_contact || '管理员' }}</div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 236px;
  flex-shrink: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--tg-sidebar);
  border-right: 1px solid var(--tg-border);
  transition: width 0.2s ease, transform 0.24s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 50;
}
.sidebar.collapsed { width: 64px; }
.brand {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border-bottom: 1px solid var(--tg-border);
  flex-shrink: 0;
}
.brand-link { display: flex; align-items: center; gap: 10px; min-width: 0; width: 100%; color: inherit; }
.brand-mark {
  width: 32px; height: 32px;
  border-radius: 9px;
  display: grid; place-items: center;
  color: #fff;
  background: linear-gradient(140deg, #3b6df6, #1d3cd8);
  flex-shrink: 0;
  overflow: hidden;
  box-shadow: 0 4px 10px rgba(36, 80, 235, 0.24);
}
.brand-img { width: 100%; height: 100%; object-fit: cover; }
.brand-title { font-size: 14px; font-weight: 600; line-height: 1.2; }
.brand-sub { font-size: 10.5px; color: var(--tg-text-3); letter-spacing: 0.04em; text-transform: uppercase; }
.menu-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }
.sidebar-foot { padding: 10px; border-top: 1px solid var(--tg-border); flex-shrink: 0; }
.support-box {
  background: var(--tg-surface-2);
  border: 1px solid var(--tg-border);
  border-radius: 8px;
  padding: 8px 10px;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.sidebar.brand { background: linear-gradient(180deg, #1b2547, #141c36); border-color: #1d2540; }
.sidebar.brand .brand-title { color: #fff; }
.sidebar.brand .brand { border-color: rgba(255,255,255,0.08); }
.sidebar.brand :deep(.nav-item) { color: rgba(255,255,255,0.72); }
.sidebar.brand :deep(.nav-item:hover) { background: rgba(255,255,255,0.08); color: #fff; }
.sidebar.brand :deep(.nav-item.active) { background: rgba(255,255,255,0.14); color: #fff; }
.sidebar.brand :deep(.nav-icon),
.sidebar.brand :deep(.chevron) { color: rgba(255,255,255,0.55); }
.sidebar.brand :deep(.sub-wrap) { border-color: rgba(255,255,255,0.12); }
.sidebar.brand :deep(.nav-sub-btn) { color: rgba(255,255,255,0.7); }
.sidebar.brand :deep(.nav-sub-btn:hover) { background: rgba(255,255,255,0.08); color: #fff; }
.sidebar.brand .support-box { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.08); color: #fff; }
.sidebar.brand .support-box .tg-text-3 { color: rgba(255,255,255,0.5); }

@media (max-width: 1023px) {
  .sidebar {
    position: fixed;
    left: 0; top: 0; bottom: 0;
    width: 252px !important;
    transform: translateX(-100%);
    box-shadow: 0 12px 40px rgba(16, 24, 40, 0.16);
  }
  .sidebar.mobile-open { transform: translateX(0); }
}
</style>
