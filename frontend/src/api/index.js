import axios from 'axios';
import { useAuthStore } from '@/stores/auth';

const http = axios.create({ baseURL: '/api', timeout: 20000 });

http.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('tgproxy_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

http.interceptors.response.use(
  (res) => {
    const body = res.data;
    if (body && typeof body.code === 'number' && body.code !== 0) {
      return Promise.reject(new Error(body.message || '请求失败'));
    }
    return body;
  },
  (err) => {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message || '网络异常';
    if (status === 401) {
      const auth = useAuthStore();
      auth.logout(false);
      if (!location.pathname.startsWith('/login')) {
        location.href = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
      }
    }
    const e = new Error(msg);
    e.status = status;
    e.data = err.response?.data;
    return Promise.reject(e);
  },
);

export default http;

export const api = {
  // 公共
  publicInfo: () => http.get('/public/info'),
  login: (data) => http.post('/auth/login', data),
  register: (data) => http.post('/auth/register', data),
  me: () => http.get('/auth/me'),
  changePassword: (data) => http.post('/auth/password', data),
  updateProfile: (data) => http.put('/auth/profile', data),

  // 用户侧
  dashboard: () => http.get('/user/dashboard'),
  myTraffic: (days = 7) => http.get('/user/traffic', { params: { days } }),
  nodes: () => http.get('/nodes'),
  myAccounts: () => http.get('/accounts'),
  createAccount: (data) => http.post('/accounts', data),
  updateAccount: (id, data) => http.put(`/accounts/${id}`, data),
  toggleAccount: (id) => http.post(`/accounts/${id}/toggle`),
  rotateAccount: (id) => http.post(`/accounts/${id}/rotate`),
  deleteAccount: (id) => http.delete(`/accounts/${id}`),
  testAccount: (id) => http.get(`/accounts/${id}/test`),
  myTickets: (params) => http.get('/tickets', { params }),
  createTicket: (data) => http.post('/tickets', data),

  // 管理端
  adminDashboard: () => http.get('/admin/dashboard'),
  adminUsers: (params) => http.get('/admin/users', { params }),
  adminCreateUser: (data) => http.post('/admin/users', data),
  adminUpdateUser: (id, data) => http.put(`/admin/users/${id}`, data),
  adminDeleteUser: (id) => http.delete(`/admin/users/${id}`),
  adminGrantQuota: (id, mb) => http.post(`/admin/users/${id}/quota`, { mb }),
  adminAccounts: (params) => http.get('/admin/accounts', { params }),
  adminCreateAccount: (data) => http.post('/admin/accounts', data),
  adminUpdateAccount: (id, data) => http.put(`/admin/accounts/${id}`, data),
  adminToggleAccount: (id) => http.post(`/admin/accounts/${id}/toggle`),
  adminRotateAccount: (id) => http.post(`/admin/accounts/${id}/rotate`),
  adminDeleteAccount: (id) => http.delete(`/admin/accounts/${id}`),
  adminAccountAction: (id, action) => http.post(`/admin/accounts/${id}/action/${action}`),
  adminNodes: () => http.get('/admin/nodes'),
  adminCreateNode: (data) => http.post('/admin/nodes', data),
  adminUpdateNode: (id, data) => http.put(`/admin/nodes/${id}`, data),
  adminDeleteNode: (id) => http.delete(`/admin/nodes/${id}`),
  adminNodeHealth: () => http.get('/admin/nodes/health'),
  adminSyncNodes: () => http.post('/admin/nodes/sync'),
  adminTickets: (params) => http.get('/admin/tickets', { params }),
  adminReviewTicket: (id, data) => http.post(`/admin/tickets/${id}/review`, data),
  adminBatchTicket: (data) => http.post('/admin/tickets/batch', data),
  adminAudit: (params) => http.get('/admin/audit', { params }),
  adminLoginLogs: (params) => http.get('/admin/login-logs', { params }),
  adminSettings: () => http.get('/admin/settings'),
  adminSaveSettings: (data) => http.put('/admin/settings', data),
  adminResync: () => http.post('/admin/resync'),
  adminSystem: () => http.get('/admin/system'),
  adminSiteInfo: () => http.get('/admin/site-info'),
  adminMailPresets: () => http.get('/admin/mail/presets'),
  adminMailCheck: (data) => http.post('/admin/mail/check', data),
  adminMailTemplates: () => http.get('/admin/mail/templates'),
  adminSaveTemplate: (data) => http.post('/admin/mail/templates', data),
  adminResetTemplate: (key) => http.post('/admin/mail/templates/reset', { key }),
  adminPreviewMail: (data) => http.post('/admin/mail/preview', data),
  captchaStatus: () => http.get('/admin/captcha/status'),
  // 机器人
  botStatus: () => http.get('/admin/bot/status'),
  botStart: () => http.post('/admin/bot/start'),
  botStop: () => http.post('/admin/bot/stop'),
  botRestart: () => http.post('/admin/bot/restart'),
  botTestToken: (token) => http.post('/admin/bot/test', { token }),
  botBroadcast: (data) => http.post('/admin/bot/broadcast', typeof data === 'string' ? { text: data } : data),
  botBroadcastTargets: () => http.get('/admin/bot/broadcast/targets'),
  botTestChat: (chatId) => http.post('/admin/bot/broadcast/test', { chatId }),
  botUsers: (params) => http.get('/admin/bot/users', { params }),
  botUpdateUser: (id, data) => http.put(`/admin/bot/users/${id}`, data),
  botCommands: (params) => http.get('/admin/bot/commands', { params }),
  botButtons: () => http.get('/admin/bot/buttons'),
  botSaveButton: (data) => http.post('/admin/bot/buttons', data),
  botDeleteButton: (id) => http.delete(`/admin/bot/buttons/${id}`),
  botSetCommands: (data) => http.post('/admin/bot/setmenu', data),
  botGetCommands: () => http.get('/admin/bot/commands/menu'),
  // 群组
  groups: () => http.get('/admin/groups'),
  saveGroup: (data) => http.post('/admin/groups', data),
  deleteGroup: (chatId) => http.delete('/admin/groups', { params: { chat_id: chatId } }),
  groupAdmins: (chatId) => http.get('/admin/groups/admins', { params: { chat_id: chatId } }),
  toggleGroupAdmin: (id) => http.post('/admin/groups/admins/toggle', { id }),
  bannedWords: () => http.get('/admin/groups/words'),
  saveWord: (data) => http.post('/admin/groups/words', data),
  deleteWord: (id) => http.delete(`/admin/groups/words/${id}`),
  importWords: (data) => http.post('/admin/groups/words/import', data),
  verifySessions: (params) => http.get('/admin/groups/verify', { params }),
  modLogs: (params) => http.get('/admin/groups/modlogs', { params }),
  groupTest: (data) => http.post('/admin/groups/test', data),
  guardSettings: () => http.get('/admin/groups/settings'),
  groupMembers: (params) => http.get('/admin/groups/members', { params }),
  invites: () => http.get('/admin/invites'),
  inviteRecords: (params) => http.get('/admin/invites/records', { params }),
  confirmInvite: (id) => http.post('/admin/invites/confirm', { id }),
  emailStatus: () => http.get('/email/status'),
  sendEmailCode: (email) => http.post('/email/send', { email }),
  verifyEmailCode: (email, code) => http.post('/email/verify', { email, code }),
  emailLogs: (params) => http.get('/admin/email-logs', { params }),
  previewEmailTpl: (data) => http.post('/admin/email/preview', data),
  captchaConfig: () => http.get('/captcha/config'),
  captchaChallenge: (scene) => http.get('/captcha/challenge', { params: { scene } }),

  // SMTP / 邮件
  adminSmtpTest: (data) => http.post('/admin/smtp/test', data),
  adminMailLogs: (params) => http.get('/admin/mail-logs', { params }),
  adminClearMailLogs: () => http.delete('/admin/mail-logs'),

  // 资源
  adminUploadAsset: (data) => http.post('/admin/assets', data),
  adminDeleteAsset: (kind) => http.delete('/admin/assets', { params: { kind } }),

  // 公告
  adminNotices: () => http.get('/admin/notices'),
  adminSaveNotice: (data) => http.post('/admin/notices', data),
  adminDeleteNotice: (id) => http.delete(`/admin/notices/${id}`),
  adminSaveMarquee: (data) => http.post('/admin/marquee', data),
  adminDeleteMarquee: (id) => http.delete(`/admin/marquee/${id}`),
  notices: () => http.get('/notices'),
  markNoticeRead: (ids) => http.post('/notices/read', { ids }),

  // 备份 / 维护
  adminBackups: () => http.get('/admin/backups'),
  adminCreateBackup: () => http.post('/admin/backups'),
  adminDeleteBackup: (name) => http.delete('/admin/backups', { params: { name } }),
  adminMaintenance: (on) => http.post('/admin/maintenance', { on }),
  adminCleanup: () => http.post('/admin/cleanup'),
};
