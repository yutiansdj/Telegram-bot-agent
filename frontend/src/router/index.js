import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useTabsStore } from '@/stores/tabs';

const Layout = () => import('@/components/layout/AppLayout.vue');

export const asyncRoutes = [
  {
    path: '/',
    component: Layout,
    children: [
      { path: '', redirect: '/dashboard' },
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/user/Dashboard.vue'),
        meta: { title: '仪表盘', icon: 'tabler:layout-dashboard', affix: true, group: 'user' },
      },
      {
        path: 'accounts',
        name: 'Accounts',
        component: () => import('@/views/user/Accounts.vue'),
        meta: { title: '我的代理', icon: 'tabler:affiliate', group: 'user' },
      },
      {
        path: 'traffic',
        name: 'Traffic',
        component: () => import('@/views/user/Traffic.vue'),
        meta: { title: '流量统计', icon: 'tabler:chart-area-line', group: 'user' },
      },
      {
        path: 'tickets',
        name: 'Tickets',
        component: () => import('@/views/user/Tickets.vue'),
        meta: { title: '流量申请', icon: 'tabler:ticket', group: 'user' },
      },
      {
        path: 'applications',
        name: 'Applications',
        component: () => import('@/views/user/Applications.vue'),
        meta: { title: '申请记录', icon: 'tabler:clipboard-list', group: 'user' },
      },
      {
        path: 'guide',
        name: 'Guide',
        component: () => import('@/views/user/Guide.vue'),
        meta: { title: '使用教程', icon: 'tabler:book', group: 'user' },
      },
      {
        path: 'profile',
        name: 'Profile',
        component: () => import('@/views/user/Profile.vue'),
        meta: { title: '个人设置', icon: 'tabler:user-circle', group: 'user' },
      },
      // ---------- 管理端 ----------
      {
        path: 'notifications',
        name: 'Notifications',
        component: () => import('@/views/user/Notifications.vue'),
        meta: { title: '消息通知', icon: 'tabler:bell', group: 'user' },
      },
      {
        path: 'admin/notices',
        name: 'AdminNotices',
        component: () => import('@/views/admin/Notices.vue'),
        meta: { title: '公告管理', icon: 'tabler:speakerphone', group: 'admin', admin: true },
      },
      {
        path: 'admin/site',
        name: 'AdminSite',
        component: () => import('@/views/admin/Site.vue'),
        meta: { title: '站点设置', icon: 'tabler:world', group: 'admin', admin: true },
      },
      {
        path: 'admin/appearance',
        name: 'AdminAppearance',
        component: () => import('@/views/admin/Appearance.vue'),
        meta: { title: '外观主题', icon: 'tabler:palette', group: 'admin', admin: true },
      },
      {
        path: 'admin/smtp',
        name: 'AdminSmtp',
        component: () => import('@/views/admin/Smtp.vue'),
        meta: { title: '邮件设置', icon: 'tabler:mail', group: 'admin', admin: true },
      },
      {
        path: 'admin/bot',
        name: 'AdminBot',
        component: () => import('@/views/admin/Bot.vue'),
        meta: { title: '机器人配置', icon: 'tabler:brand-telegram', group: 'admin', admin: true },
      },
      {
        path: 'admin/bots',
        name: 'AdminBots',
        component: () => import('@/views/admin/Bots.vue'),
        meta: { title: '多机器人', icon: 'tabler:robot', group: 'admin', admin: true },
      },
      {
        path: 'admin/workbuddy',
        name: 'AdminWorkBuddy',
        component: () => import('@/views/admin/WorkBuddy.vue'),
        meta: { title: 'WorkBuddy', icon: 'tabler:brand-openai', group: 'admin', admin: true },
      },
      {
        path: 'admin/ai',
        name: 'AdminAi',
        component: () => import('@/views/admin/Ai.vue'),
        meta: { title: 'AI 助手', icon: 'tabler:sparkles', group: 'admin', admin: true },
      },
      {
        path: 'admin/groups',
        name: 'AdminGroups',
        component: () => import('@/views/admin/Groups.vue'),
        meta: { title: '群组管理', icon: 'tabler:users-group', group: 'admin', admin: true },
      },
      {
        path: 'admin/captcha',
        name: 'AdminCaptcha',
        component: () => import('@/views/admin/Captcha.vue'),
        meta: { title: '人机验证', icon: 'tabler:shield-lock', group: 'admin', admin: true },
      },
      {
        path: 'admin/templates',
        name: 'AdminTemplates',
        component: () => import('@/views/admin/Templates.vue'),
        meta: { title: '邮件模板', icon: 'tabler:template', group: 'admin', admin: true },
      },
      {
        path: 'admin/security',
        name: 'AdminSecurity',
        component: () => import('@/views/admin/Security.vue'),
        meta: { title: '注册策略', icon: 'tabler:lock-access', group: 'admin', admin: true },
      },
      {
        path: 'admin/loginsecurity',
        name: 'AdminLoginSecurity',
        component: () => import('@/views/admin/LoginSecurity.vue'),
        meta: { title: '登录安全', icon: 'tabler:shield-check', group: 'admin', admin: true },
      },
      {
        path: 'admin/backup',
        name: 'AdminBackup',
        component: () => import('@/views/admin/Backup.vue'),
        meta: { title: '数据与备份', icon: 'tabler:database', group: 'admin', admin: true },
      },
      {
        path: 'admin/overview',
        name: 'AdminOverview',
        component: () => import('@/views/admin/Overview.vue'),
        meta: { title: '运维总览', icon: 'tabler:gauge', group: 'admin', admin: true },
      },
      {
        path: 'admin/users',
        name: 'AdminUsers',
        component: () => import('@/views/admin/Users.vue'),
        meta: { title: '用户管理', icon: 'tabler:users', group: 'admin', admin: true },
      },
      {
        path: 'admin/accounts',
        name: 'AdminAccounts',
        component: () => import('@/views/admin/Accounts.vue'),
        meta: { title: '代理管理', icon: 'tabler:affiliate', group: 'admin', admin: true },
      },
      {
        path: 'admin/nodes',
        name: 'AdminNodes',
        component: () => import('@/views/admin/Nodes.vue'),
        meta: { title: '节点管理', icon: 'tabler:server-2', group: 'admin', admin: true },
      },
      {
        path: 'admin/tickets',
        name: 'AdminTickets',
        component: () => import('@/views/admin/ReviewTickets.vue'),
        meta: { title: '申请审核', icon: 'tabler:ticket', group: 'admin', admin: true },
      },
      {
        path: 'admin/audit',
        name: 'AdminAudit',
        component: () => import('@/views/admin/Audit.vue'),
        meta: { title: '审计日志', icon: 'tabler:shield-check', group: 'admin', admin: true },
      },
      {
        path: 'admin/settings',
        name: 'AdminSettings',
        component: () => import('@/views/admin/Settings.vue'),
        meta: { title: '系统设置', icon: 'tabler:settings', group: 'admin', admin: true },
      },
      {
        path: 'admin/system',
        name: 'AdminSystem',
        component: () => import('@/views/admin/System.vue'),
        meta: { title: '运行状态', icon: 'tabler:activity', group: 'admin', admin: true },
      },
    ],
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/auth/Login.vue'),
    meta: { title: '登录', public: true, hideTab: true },
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/auth/Register.vue'),
    meta: { title: '注册', public: true, hideTab: true },
  },
  { path: '/:pathMatch(.*)*', name: 'NotFound', redirect: '/dashboard' },
];

const router = createRouter({
  history: createWebHistory(),
  routes: asyncRoutes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) {
    if (auth.token && (to.name === 'Login' || to.name === 'Register')) return { path: '/dashboard' };
    return true;
  }
  if (!auth.token) return { path: '/login', query: { redirect: to.fullPath } };
  if (!auth.user) {
    try { await auth.fetchMe(); } catch { return { path: '/login' }; }
  }
  if (to.meta.admin && !auth.isAdmin) return { path: '/dashboard' };
  return true;
});

router.afterEach((to) => {
  const tabs = useTabsStore();
  if (!to.meta.public && !to.meta.hideTab) tabs.addTab(to);
});

export default router;
