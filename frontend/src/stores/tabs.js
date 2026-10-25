import { defineStore } from 'pinia';

let seq = 1;

/**
 * 多标签页（页签）管理
 * - 每个打开的页面生成一个 tab，支持固定首页、关闭、关闭其他、关闭右侧、刷新
 * - 与路由 path(fullPath) 一一对应，切换标签即切换路由
 */
export const useTabsStore = defineStore('tabs', {
  state: () => ({
    tabs: [],
    activePath: '',
    refreshKey: 0,
    cachedViews: [],
  }),
  getters: {
    activeTab: (s) => s.tabs.find((t) => t.path === s.activePath),
  },
  actions: {
    addTab(route) {
      const { fullPath: path, meta = {} } = route;
      if (!path || path.startsWith('/login') || meta.hideTab) return;
      const exists = this.tabs.find((t) => t.path === path);
      if (!exists) {
        this.tabs.push({
          id: seq++,
          path,
          name: route.name,
          title: meta.title || route.name || '未命名',
          icon: meta.icon || 'tabler:file',
          affix: !!meta.affix,
        });
      }
      this.activePath = path;
    },
    closeTab(path) {
      const idx = this.tabs.findIndex((t) => t.path === path);
      if (idx === -1) return null;
      const tab = this.tabs[idx];
      if (tab.affix) return null;
      this.tabs.splice(idx, 1);
      if (this.activePath === path) {
        const next = this.tabs[idx] || this.tabs[idx - 1] || this.tabs[0];
        return next?.path || '/';
      }
      return null;
    },
    closeOthers(path) {
      this.tabs = this.tabs.filter((t) => t.path === path || t.affix);
      this.activePath = path;
    },
    closeAll() {
      this.tabs = this.tabs.filter((t) => t.affix);
      return this.tabs[0]?.path || '/';
    },
    closeRight(path) {
      const idx = this.tabs.findIndex((t) => t.path === path);
      if (idx === -1) return null;
      this.tabs = this.tabs.filter((t, i) => i <= idx || t.affix);
      this.activePath = path;
      return null;
    },
    moveTab(from, to) {
      const item = this.tabs.splice(from, 1)[0];
      this.tabs.splice(to, 0, item);
    },
    refresh() {
      this.refreshKey++;
    },
    setTitle(path, title) {
      const t = this.tabs.find((x) => x.path === path);
      if (t) t.title = title;
    },
    reset() {
      this.tabs = [];
      this.activePath = '';
    },
  },
});
