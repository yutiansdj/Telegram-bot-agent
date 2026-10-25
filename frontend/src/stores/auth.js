import { defineStore } from 'pinia';
import { api } from '@/api';
import { useThemeStore } from './theme';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('tgproxy_token') || '',
    user: JSON.parse(localStorage.getItem('tgproxy_user') || 'null'),
    info: { site_name: 'TG 代理申请平台', site_desc: '', announcement: '' },
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    isAdmin: (s) => s.user?.role === 'admin',
    displayName: (s) => s.user?.username || '',
  },
  actions: {
    persist() {
      if (this.token) localStorage.setItem('tgproxy_token', this.token);
      else localStorage.removeItem('tgproxy_token');
      if (this.user) localStorage.setItem('tgproxy_user', JSON.stringify(this.user));
      else localStorage.removeItem('tgproxy_user');
    },
    async login(payload) {
      const res = await api.login(payload);
      this.token = res.data.token;
      this.user = res.data.user;
      this.persist();
      return res.data.user;
    },
    async register(payload) {
      const res = await api.register(payload);
      this.token = res.data.token;
      this.user = res.data.user;
      this.persist();
      return res.data.user;
    },
    async fetchMe() {
      if (!this.token) return null;
      const res = await api.me();
      this.user = res.data.user;
      this.persist();
      return this.user;
    },
    async fetchPublicInfo() {
      try {
        const res = await api.publicInfo();
        this.info = res.data;
        document.title = res.data.site_name || 'TG 代理申请平台';
        // 应用站点主题变量
        useThemeStore().applySiteTheme(res.data);
        // 动态 favicon
        if (res.data.site_favicon) {
          let link = document.querySelector("link[rel='icon']");
          if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
          link.href = res.data.site_favicon;
        }
        // SEO 关键词
        if (res.data.site_keywords) {
          let meta = document.querySelector("meta[name='keywords']");
          if (!meta) { meta = document.createElement('meta'); meta.name = 'keywords'; document.head.appendChild(meta); }
          meta.content = res.data.site_keywords;
        }
      } catch { /* 忽略 */ }
    },
    logout(redirect = true) {
      this.token = '';
      this.user = null;
      this.persist();
      if (redirect) location.href = '/login';
    },
  },
});
