import { defineStore } from 'pinia';

const THEME_KEY = 'tgproxy_theme';
const COLLAPSE_KEY = 'tgproxy_collapsed';

export const useThemeStore = defineStore('theme', {
  state: () => ({
    dark: localStorage.getItem(THEME_KEY) === 'dark',
    collapsed: localStorage.getItem(COLLAPSE_KEY) === '1',
    sidebarBrand: localStorage.getItem('tgproxy_sidebar_style') === 'brand',
    // 由后端站点设置注入
    primaryLight: '',
    primaryDark: '',
    radius: '',
  }),
  actions: {
    apply() {
      const root = document.documentElement;
      root.classList.toggle('dark', this.dark);
      root.style.colorScheme = this.dark ? 'dark' : 'light';
      localStorage.setItem(THEME_KEY, this.dark ? 'dark' : 'light');
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', this.dark ? '#101014' : '#ffffff');
    },
    toggleDark() {
      this.dark = !this.dark;
      this.apply();
    },
    setDark(v) {
      this.dark = !!v;
      this.apply();
    },
    toggleCollapse() {
      this.collapsed = !this.collapsed;
      localStorage.setItem(COLLAPSE_KEY, this.collapsed ? '1' : '0');
    },
    setSidebarStyle(v) {
      this.sidebarBrand = v === 'brand';
      localStorage.setItem('tgproxy_sidebar_style', this.sidebarBrand ? 'brand' : 'light');
    },
    /** 应用后端配置的主题变量 */
    applySiteTheme(cfg = {}) {
      const root = document.documentElement;
      if (cfg.ui_primary_light) { this.primaryLight = cfg.ui_primary_light; root.style.setProperty('--tg-brand', cfg.ui_primary_light); }
      if (cfg.ui_primary_dark) { this.primaryDark = cfg.ui_primary_dark; }
      if (cfg.ui_radius) { this.radius = cfg.ui_radius; root.style.setProperty('--tg-radius', cfg.ui_radius + 'px'); }
      if (cfg.ui_sidebar_style) this.setSidebarStyle(cfg.ui_sidebar_style);
      if (cfg.ui_font_size) root.style.setProperty('font-size', (Number(cfg.ui_font_size) || 14) + 'px');
    },
    init() {
      this.apply();
    },
  },
});
