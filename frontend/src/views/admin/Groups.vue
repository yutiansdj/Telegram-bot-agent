<script setup>
import { ref, onMounted, h, reactive, computed } from 'vue';
import {
  NButton, NIcon, NInput, NInputNumber, NSwitch, NForm, NFormItem, NSelect, NTag,
  NTabs, NTabPane, NAlert, NDataTable, NModal, NPopconfirm, NSpace, NEmpty, NRadioGroup,
  NRadio, NDivider, NTooltip, NSpin,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { useSearchFocus } from '@/composables/useSearchFocus';
import { fmtDate, fmtRelative } from '@/utils/format';

const loading = ref(true);
const saving = ref(false);
const tab = ref('verify');
const s = ref({});
const groups = reactive({ list: [], stats: {} });
const admins = reactive({ list: [], groups: [], allowAll: true, whitelist: [] });
const words = reactive({ list: [] });
const sessions = reactive({ list: [], total: 0, page: 1 });
const modlogs = reactive({ list: [], total: 0, page: 1 });
const members = reactive({ list: [], total: 0, page: 1 });
const memberChat = ref('');

const showGroup = ref(false);
const groupForm = ref({});
const showWord = ref(false);
const wordForm = ref({});
const showImport = ref(false);
const importText = ref('');

// 验证题预览
const preview = ref(null);
const previewLoading = ref(false);
const answers = ref([]);
const answerResult = ref('');

function toggle(k) { s.value[k] = s.value[k] === '1' ? '0' : '1'; }

const actionOptions = [
  { label: '仅删除', value: 'delete' },
  { label: '仅禁言', value: 'mute' },
  { label: '删除 + 禁言', value: 'delete_mute' },
  { label: '踢出群组', value: 'kick' },
];

const categoryOptions = [
  { label: '关键词', value: 'word' },
  { label: '正则表达式', value: 'regex' },
];

async function load() {
  loading.value = true;
  try {
    const [g, st, a, w] = await Promise.all([
      api.groups(), api.adminSettings(), api.groupAdmins(''), api.bannedWords(),
    ]);
    groups.list = g.data.list;
    groups.stats = g.data.stats;
    s.value = { ...st.data.settings };
    // 数值项确保为数字，避免为空显示
    for (const k of ['grp_captcha_options', 'grp_captcha_attempts', 'grp_captcha_timeout', 'grp_word_mute_minutes', 'grp_flood_limit', 'grp_flood_window', 'grp_flood_mute_minutes']) {
      s.value[k] = Number(s.value[k]) || 0;
    }
    admins.list = a.data.list;
    admins.groups = a.data.groups;
    admins.allowAll = a.data.allowAll;
    admins.whitelist = a.data.whitelist;
    words.list = w.data.list;
    await testPreview();
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function save() {
  saving.value = true;
  try {
    await api.adminSaveSettings(s.value);
    window.$message.success('群组守卫配置已保存');
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

async function testPreview() {
  previewLoading.value = true;
  answerResult.value = '';
  answers.value = [];
  try {
    const res = await api.groupTest({ type: s.value.grp_captcha_type, options: s.value.grp_captcha_options });
    preview.value = res.data;
  } catch (e) { preview.value = null; }
  finally { previewLoading.value = false; }
}

function pickAnswer(opt) {
  if (!preview.value) return;
  answers.value = [opt];
  answerResult.value = opt === preview.value.answer ? 'pass' : 'fail';
}

function openGroup(row) {
  groupForm.value = row ? { ...row } : { chat_id: '', title: '', verify_enabled: 1, captcha_type: 'choice', captcha_options: 4, captcha_attempts: 3, captcha_timeout: 120 };
  showGroup.value = true;
}

async function saveGroup() {
  try {
    await api.saveGroup(groupForm.value);
    window.$message.success('群组已保存');
    showGroup.value = false;
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function delGroup(chatId) {
  try { await api.deleteGroup(chatId); await load(); window.$message.success('已删除'); } catch (e) { window.$message.error(e.message); }
}

async function toggleAdmin(row) {
  try {
    const res = await api.toggleGroupAdmin(row.id);
    window.$message.success(res.message);
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function saveGlobalAdminSetting() {
  try {
    await api.adminSaveSettings({ grp_admin_allow_all: s.value.grp_admin_allow_all, grp_admin_whitelist: s.value.grp_admin_whitelist });
    window.$message.success('已保存');
  } catch (e) { window.$message.error(e.message); }
}

function openWord(row) {
  wordForm.value = row ? { ...row } : { word: '', category: 'word', action: 'delete_mute', mute_minutes: 5, enabled: true };
  showWord.value = true;
}

async function saveWord() {
  try {
    await api.saveWord(wordForm.value);
    window.$message.success('已保存');
    showWord.value = false;
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function delWord(id) {
  try { await api.deleteWord(id); await load(); } catch (e) { window.$message.error(e.message); }
}

async function doImport() {
  try {
    const res = await api.importWords({ words: importText.value, mute_minutes: s.value.grp_word_mute_minutes });
    window.$message.success(res.message);
    showImport.value = false;
    importText.value = '';
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function loadSessions() {
  try {
    const res = await api.verifySessions({ page: sessions.page, pageSize: 20 });
    sessions.list = res.data.list;
    sessions.total = res.data.total;
  } catch (e) { window.$message.error(e.message); }
}

async function loadModlogs() {
  try {
    const res = await api.modLogs({ page: modlogs.page, pageSize: 20 });
    modlogs.list = res.data.list;
    modlogs.total = res.data.total;
  } catch (e) { window.$message.error(e.message); }
}

function onTab(v) {
  tab.value = v;
  if (v === 'sessions') loadSessions();
  if (v === 'logs') loadModlogs();
  if (v === 'members') loadMembers();
}

async function loadMembers() {
  try {
    const res = await api.groupMembers({ chat_id: memberChat.value, page: members.page, pageSize: 50 });
    members.list = res.data.list;
    members.total = res.data.total;
  } catch (e) { window.$message.error(e.message); }
}

const memberColumns = [
  { title: '群组', key: 'chat_id', width: 150, render: (r) => h('span', { class: 'font-mono', style: 'font-size:12px' }, r.chat_id) },
  { title: '成员', key: 'name', width: 160, render: (r) => r.name || r.tg_id },
  { title: 'Telegram ID', key: 'tg_id', width: 140 },
  { title: '状态', key: 'status', width: 100, render: (r) => h(NTag, { size: 'small', bordered: false, type: r.status === 'member' ? 'success' : 'default' }, { default: () => (r.status === 'member' ? '在群' : r.status) }) },
  { title: '入群时间', key: 'joined_at', width: 145, render: (r) => fmtDate(r.joined_at) },
];

const statusTag = (st) => {
  const map = { pending: ['warning', '待验证'], passed: ['success', '已通过'], failed: ['error', '失败'], timeout: ['default', '超时'] };
  const [type, text] = map[st] || ['default', st];
  return h(NTag, { size: 'small', type, bordered: false }, { default: () => text });
};

const wordColumns = [
  { title: '内容', key: 'word', ellipsis: { tooltip: true } },
  { title: '类型', key: 'category', width: 100, render: (r) => h(NTag, { size: 'small', bordered: false, type: r.category === 'regex' ? 'warning' : 'info' }, { default: () => (r.category === 'regex' ? '正则' : '关键词') }) },
  { title: '处理', key: 'action', width: 120, render: (r) => actionOptions.find((a) => a.value === r.action)?.label || r.action },
  { title: '禁言', key: 'mute_minutes', width: 80, render: (r) => `${r.mute_minutes} 分钟` },
  { title: '状态', key: 'enabled', width: 80, render: (r) => h(NTag, { size: 'small', type: r.enabled ? 'success' : 'default', bordered: false }, { default: () => (r.enabled ? '启用' : '停用') }) },
  {
    title: '操作', key: 'actions', width: 120,
    render: (r) => h(NSpace, { size: 4 }, {
      default: () => [
        h(NButton, { size: 'tiny', secondary: true, onClick: () => openWord(r) }, { default: () => '编辑' }),
        h(NPopconfirm, { onPositiveClick: () => delWord(r.id) }, {
          trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
          default: () => '确定删除？',
        }),
      ],
    }),
  },
];

const groupColumns = [
  { title: '群组', key: 'title', minWidth: 160, render: (r) => h('div', null, [
    h('div', { style: 'font-weight:500;font-size:13px' }, r.title || '（未命名）'),
    h('div', { style: 'font-size:11.5px;color:var(--tg-text-3)' }, r.chat_id),
  ]) },
  { title: '验证', key: 'verify_enabled', width: 80, render: (r) => h(NTag, { size: 'small', type: r.verify_enabled ? 'success' : 'default', bordered: false }, { default: () => (r.verify_enabled ? '开启' : '关闭') }) },
  { title: '管理员', key: 'admin_count', width: 90, align: 'center', render: (r) => `${r.admin_count} 人` },
  { title: '被禁用', key: 'blocked_count', width: 90, align: 'center', render: (r) => r.blocked_count ? h(NTag, { size: 'small', type: 'error', bordered: false }, { default: () => `${r.blocked_count} 人` }) : '0' },
  { title: '验证次数', key: 'verify_count', width: 90, align: 'center' },
  { title: '操作', key: 'actions', width: 130, render: (r) => h(NSpace, { size: 4 }, {
    default: () => [
      h(NButton, { size: 'tiny', secondary: true, onClick: () => openGroup(r) }, { default: () => '编辑' }),
      h(NPopconfirm, { onPositiveClick: () => delGroup(r.chat_id) }, {
        trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
        default: () => '确定移除该群组？',
      }),
    ],
  }) },
];

const adminColumns = [
  { title: '群组', key: 'chat_id', width: 150, render: (r) => h('span', { class: 'font-mono', style: 'font-size:12px' }, r.chat_id) },
  { title: '管理员', key: 'tg_id', width: 160, render: (r) => r.title ? '@' + r.title : 'ID ' + r.tg_id },
  { title: '放行权限', key: 'blocked', width: 110, render: (r) => h(NTag, { size: 'small', type: r.blocked ? 'error' : 'success', bordered: false }, { default: () => (r.blocked ? '已禁用' : '可用') }) },
  { title: '加入时间', key: 'created_at', width: 140, render: (r) => fmtDate(r.created_at) },
  {
    title: '操作', key: 'actions', width: 120,
    render: (r) => h(NButton, { size: 'tiny', secondary: true, type: r.blocked ? 'success' : 'error', onClick: () => toggleAdmin(r) },
      { default: () => (r.blocked ? '恢复权限' : '禁用权限') }),
  },
];

const sessionColumns = [
  { title: '时间', key: 'created_at', width: 145, render: (r) => fmtDate(r.created_at) },
  { title: '群组', key: 'chat_id', width: 140, render: (r) => h('span', { class: 'font-mono', style: 'font-size:12px' }, r.chat_id) },
  { title: '用户', key: 'tg_name', width: 130, render: (r) => r.tg_name || r.tg_id },
  { title: '尝试', key: 'attempts', width: 80, render: (r) => `${r.attempts}/${r.max_attempts}` },
  { title: '结果', key: 'status', width: 90, render: (r) => statusTag(r.status) },
];

const logColumns = [
  { title: '时间', key: 'created_at', width: 145, render: (r) => fmtDate(r.created_at) },
  { title: '群组', key: 'chat_id', width: 130, render: (r) => h('span', { class: 'font-mono', style: 'font-size:12px' }, r.chat_id) },
  { title: '用户', key: 'tg_name', width: 120 },
  { title: '动作', key: 'action', width: 150, render: (r) => h(NTag, { size: 'small', bordered: false, type: /fail|timeout|filter/.test(r.action) ? 'error' : /pass/.test(r.action) ? 'success' : 'info' }, { default: () => r.action }) },
  { title: '详情', key: 'detail', ellipsis: { tooltip: true } },
];

useSearchFocus(tab);
onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="群组管理" subtitle="入群人机验证、违禁内容拦截、管理员权限与审核记录" icon="tabler:users-group">
      <template #actions>
        <NButton size="small" quaternary :loading="loading" @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
        </NButton>
        <NButton type="primary" size="small" :loading="saving" @click="save">保存配置</NButton>
      </template>
    </PageHeader>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
      <div class="tg-card p-4">
        <div class="text-xs tg-text-3">已接入群组</div>
        <div class="text-[22px] font-semibold mt-1">{{ groups.stats.groups ?? 0 }}</div>
      </div>
      <div class="tg-card p-4">
        <div class="text-xs tg-text-3">今日验证</div>
        <div class="text-[22px] font-semibold mt-1">{{ groups.stats.todayVerify ?? 0 }}</div>
      </div>
      <div class="tg-card p-4">
        <div class="text-xs tg-text-3">验证通过率</div>
        <div class="text-[22px] font-semibold mt-1">{{ groups.stats.passRate ?? 0 }}%</div>
      </div>
      <div class="tg-card p-4">
        <div class="text-xs tg-text-3">违禁词</div>
        <div class="text-[22px] font-semibold mt-1">{{ words.list.filter(w => w.enabled).length }}</div>
      </div>
    </div>

    <div class="tg-card">
      <NTabs :value="tab" type="line" size="small" class="px-4 pt-2" @update:value="onTab">
        <!-- 入群验证 -->
        <NTabPane name="verify" tab="入群验证"><div data-search-anchor="grp-verify">
          <NSpin :show="loading">
            <div class="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 py-3">
              <div>
                <div class="row">
                  <div><div class="row-title">启用入群验证</div><div class="row-desc">新成员入群后需完成人机验证</div></div>
                  <NSwitch :value="s.grp_verify_enabled === '1'" size="small" @update:value="toggle('grp_verify_enabled')" />
                </div>
                <div class="row">
                  <div><div class="row-title">题目类型</div><div class="row-desc">多选答案 / 算术题</div></div>
                  <NRadioGroup :value="s.grp_captcha_type" size="small" @update:value="(v) => { s.grp_captcha_type = v; testPreview(); }">
                    <NRadio value="choice">多选答案</NRadio>
                    <NRadio value="math">算术题</NRadio>
                  </NRadioGroup>
                </div>
                <div class="grid grid-cols-3 gap-3 mt-3">
                  <NFormItem label="选项数量">
                    <NInputNumber v-model:value.number="s.grp_captcha_options" :min="2" :max="8" class="!w-full" @update:value="testPreview" />
                  </NFormItem>
                  <NFormItem label="尝试次数">
                    <NInputNumber v-model:value.number="s.grp_captcha_attempts" :min="1" :max="10" class="!w-full" />
                  </NFormItem>
                  <NFormItem label="超时（秒）">
                    <NInputNumber v-model:value.number="s.grp_captcha_timeout" :min="30" :max="3600" class="!w-full" />
                  </NFormItem>
                </div>
                <div class="row">
                  <div><div class="row-title">显示「管理员直接通过」按钮</div><div class="row-desc">按钮出现在所有答案下方，仅管理员可点</div></div>
                  <NSwitch :value="s.grp_show_admin_pass === '1'" size="small" @update:value="toggle('grp_show_admin_pass')" />
                </div>
                <div class="row">
                  <div><div class="row-title">验证失败/超时踢出</div><div class="row-desc">关闭则只保持禁言</div></div>
                  <NSwitch :value="s.grp_kick_on_fail === '1'" size="small" @update:value="toggle('grp_kick_on_fail')" />
                </div>
                <div class="row">
                  <div><div class="row-title">入群先禁言</div><div class="row-desc">验证通过后自动解禁</div></div>
                  <NSwitch :value="s.grp_on_join_mute === '1'" size="small" @update:value="toggle('grp_on_join_mute')" />
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                  <NFormItem label="通过文案">
                    <NInput v-model:value="s.grp_pass_text" size="small" placeholder="支持 {{name}} {{group}}" />
                  </NFormItem>
                  <NFormItem label="失败文案">
                    <NInput v-model:value="s.grp_fail_text" size="small" />
                  </NFormItem>
                  <NFormItem label="超时文案">
                    <NInput v-model:value="s.grp_timeout_text" size="small" />
                  </NFormItem>
                </div>
              </div>

              <!-- 验证题预览 -->
              <div class="preview-box">
                <div class="flex items-center justify-between mb-2">
                  <div class="tg-section-title">验证效果预览</div>
                  <NButton size="tiny" quaternary :loading="previewLoading" @click="testPreview">
                    <template #icon><NIcon size="13"><Icon icon="tabler:refresh" /></NIcon></template>
                  </NButton>
                </div>
                <div class="chat-sim">
                  <div class="chat-head">🤖 机器人 · 私聊</div>
                  <div class="chat-body">
                    <div class="msg">🔐 <b>入群验证</b><br /><br />群组：<b>示例群组</b><br />题目：<b>{{ preview?.question || '加载中…' }}</b><br /><br />你有 <b>{{ s.grp_captcha_attempts }}</b> 次机会</div>
                    <div class="opts">
                      <button
                        v-for="o in preview?.options || []" :key="o"
                        class="opt" :class="{
                          correct: answers.includes(o) && answerResult === 'pass',
                          wrong: answers.includes(o) && answerResult === 'fail',
                        }"
                        @click="pickAnswer(o)"
                      >{{ o }}</button>
                    </div>
                    <button v-if="s.grp_show_admin_pass === '1'" class="opt admin-pass">✅ 群管理员直接通过</button>
                    <div v-if="answerResult" class="result" :class="answerResult">
                      {{ answerResult === 'pass' ? '✅ 回答正确，验证通过！' : `❌ 回答错误，正确答案：${preview?.answer}` }}
                    </div>
                  </div>
                </div>
                <div class="text-xs tg-text-3 mt-2 leading-relaxed">
                  点击选项即可模拟验证。正确答案会在答错后显示，方便你核对配置是否合理。
                </div>
              </div>
            </div>
          </NSpin>
        </div></NTabPane>

        <!-- 管理员 -->
        <NTabPane name="admins" tab="管理员权限"><div data-search-anchor="grp-admins">
          <div class="py-3">
            <NAlert type="info" :bordered="false" class="mb-3" :show-icon="true">
              默认所有群管理员与群主都可使用「直接通过」按钮。可在此禁用指定管理员的放行权限，使其仍需正常验证。
            </NAlert>
            <div class="row">
              <div><div class="row-title">允许所有群管理员放行</div><div class="row-desc">关闭后仅白名单管理员可用</div></div>
              <NSwitch :value="s.grp_admin_allow_all === '1'" size="small" @update:value="(v) => { s.grp_admin_allow_all = v ? '1' : '0'; saveGlobalAdminSetting(); }" />
            </div>
            <NFormItem label="管理员白名单（Telegram ID，逗号分隔）" class="!mt-3">
              <div class="flex gap-2 w-full">
                <NInput v-model:value="s.grp_admin_whitelist" placeholder="123456789,987654321" />
                <NButton @click="saveGlobalAdminSetting">保存</NButton>
              </div>
            </NFormItem>
            <div class="tg-section-title mb-2 mt-2">已登记的群管理员</div>
            <NDataTable :columns="adminColumns" :data="admins.list" :bordered="false" size="small" :row-key="(r) => r.id" :max-height="320" />
            <NEmpty v-if="!admins.list.length" size="small" description="暂无记录（机器人在群内收到管理员变更事件后会自动登记）" />
          </div>
        </div></NTabPane>

        <!-- 违禁内容 -->
        <NTabPane name="filter" tab="违禁内容"><div data-search-anchor="grp-filter">
          <div class="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4 py-3">
            <div>
              <div class="row">
                <div><div class="row-title">启用内容检测</div><div class="row-desc">总开关，关闭后所有检测失效</div></div>
                <NSwitch :value="s.grp_word_filter_enabled === '1'" size="small" @update:value="toggle('grp_word_filter_enabled')" />
              </div>
              <div class="row">
                <div><div class="row-title">违禁词检测</div><div class="row-desc">使用下方词库匹配</div></div>
                <NSwitch :value="s.grp_filter_words === '1'" size="small" @update:value="toggle('grp_filter_words')" />
              </div>
              <div class="row">
                <div><div class="row-title">链接/广告检测</div><div class="row-desc">拦截网址与 t.me 链接</div></div>
                <NSwitch :value="s.grp_filter_links === '1'" size="small" @update:value="toggle('grp_filter_links')" />
              </div>
              <div class="row">
                <div><div class="row-title">图片/二维码检测</div><div class="row-desc">拦截群内图片消息（频道帖子不受此限制）</div></div>
                <NSwitch :value="s.grp_filter_qrcode === '1'" size="small" @update:value="toggle('grp_filter_qrcode')" />
              </div>
              <div class="row">
                <div><div class="row-title">频道帖子检测</div><div class="row-desc">频道只有管理员能发帖，默认关闭以免误删</div></div>
                <NSwitch :value="s.grp_filter_channels === '1'" size="small" @update:value="toggle('grp_filter_channels')" />
              </div>
              <div class="row">
                <div><div class="row-title">转发消息检测</div><div class="row-desc">拦截频道转发的广告</div></div>
                <NSwitch :value="s.grp_filter_forward === '1'" size="small" @update:value="toggle('grp_filter_forward')" />
              </div>
              <div class="row">
                <div><div class="row-title">@所有人 检测</div><div class="row-desc">拦截 @all / @everyone</div></div>
                <NSwitch :value="s.grp_filter_mention_all === '1'" size="small" @update:value="toggle('grp_filter_mention_all')" />
              </div>
              <div class="row">
                <div><div class="row-title">刷屏检测</div><div class="row-desc">短时间大量消息自动处理</div></div>
                <NSwitch :value="s.grp_flood_enabled === '1'" size="small" @update:value="toggle('grp_flood_enabled')" />
              </div>
              <div class="grid grid-cols-3 gap-2 mt-2">
                <NFormItem label="刷屏条数">
                  <NInputNumber v-model:value.number="s.grp_flood_limit" :min="3" :max="50" size="small" class="!w-full" />
                </NFormItem>
                <NFormItem label="时间窗（秒）">
                  <NInputNumber v-model:value.number="s.grp_flood_window" :min="3" :max="60" size="small" class="!w-full" />
                </NFormItem>
                <NFormItem label="禁言（分钟）">
                  <NInputNumber v-model:value.number="s.grp_flood_mute_minutes" :min="1" :max="1440" size="small" class="!w-full" />
                </NFormItem>
              </div>
            </div>

            <div>
              <div class="tg-section-title mb-2">命中处理方式</div>
              <NSelect v-model:value="s.grp_word_action" :options="actionOptions" size="small" />
              <NFormItem label="默认禁言时长（分钟）" class="!mt-3">
                <NInputNumber v-model:value.number="s.grp_word_mute_minutes" :min="1" :max="1440" class="!w-full" />
              </NFormItem>
              <NAlert type="warning" :bordered="false" class="mt-2">
                机器人需拥有「删除消息」与「封禁用户」权限，否则无法执行处理动作。
              </NAlert>

              <div class="flex items-center justify-between mt-4 mb-2">
                <div class="tg-section-title">违禁词库</div>
                <div class="flex gap-2">
                  <NButton size="tiny" @click="showImport = true">批量导入</NButton>
                  <NButton size="tiny" type="primary" @click="openWord()">添加</NButton>
                </div>
              </div>
              <NDataTable :columns="wordColumns" :data="words.list" :bordered="false" size="small" :row-key="(r) => r.id" :max-height="300" :scroll-x="620" />
            </div>
          </div>
        </div></NTabPane>

        <!-- 群组列表 -->
        <NTabPane name="groups" tab="群组列表">
          <div class="flex justify-between py-3">
            <div class="text-xs tg-text-3">把机器人拉进群并设为管理员后，会自动出现在此列表</div>
            <NButton size="small" type="primary" @click="openGroup()">手动添加群组</NButton>
          </div>
          <NDataTable :columns="groupColumns" :data="groups.list" :bordered="false" size="small" :row-key="(r) => r.id" />
          <NEmpty v-if="!groups.list.length" size="small" description="暂无群组" class="py-6" />
        </NTabPane>

        <!-- 群成员 -->
        <NTabPane name="members" tab="群成员"><div data-search-anchor="grp-members">
          <div class="flex gap-2 py-3">
            <NInput v-model:value="memberChat" size="small" placeholder="群组 ID（留空=全部）" clearable style="width: 240px" @keyup.enter="loadMembers" />
            <NButton size="small" @click="loadMembers">查询</NButton>
            <span class="text-xs tg-text-3 self-center">共 {{ members.total }} 位成员</span>
          </div>
          <div class="pb-3 -mx-4">
            <NDataTable :columns="memberColumns" :data="members.list" :bordered="false" size="small" :row-key="(r) => r.id" :max-height="400" :scroll-x="720"
              :pagination="{ page: members.page, pageSize: 50, itemCount: members.total, prefix: ({ itemCount }) => `共 ${itemCount} 人`, onChange: (p) => { members.page = p; loadMembers(); } }" />
          </div>
        </div></NTabPane>

        <!-- 验证记录 -->
        <NTabPane name="sessions" tab="验证记录"><div data-search-anchor="grp-sessions">
          <div class="py-3">
            <NDataTable :columns="sessionColumns" :data="sessions.list" :bordered="false" size="small" :row-key="(r) => r.id" :max-height="420"
              :pagination="{ page: sessions.page, pageSize: 20, itemCount: sessions.total, prefix: ({ itemCount }) => `共 ${itemCount} 条`, onChange: (p) => { sessions.page = p; loadSessions(); } }" />
          </div>
        </div></NTabPane>

        <!-- 处理日志 -->
        <NTabPane name="logs" tab="处理日志"><div data-search-anchor="grp-logs">
          <div class="py-3">
            <NDataTable :columns="logColumns" :data="modlogs.list" :bordered="false" size="small" :row-key="(r) => r.id" :max-height="420"
              :pagination="{ page: modlogs.page, pageSize: 20, itemCount: modlogs.total, prefix: ({ itemCount }) => `共 ${itemCount} 条`, onChange: (p) => { modlogs.page = p; loadModlogs(); } }" />
          </div>
        </div></NTabPane>
      </NTabs>
    </div>

    <!-- 群组表单 -->
    <NModal v-model:show="showGroup" preset="card" :title="groupForm.id ? '编辑群组' : '添加群组'" style="max-width: 440px" :bordered="false" size="small">
      <NForm label-placement="top">
        <NFormItem label="群组 ID（如 -1001234567890）">
          <NInput v-model:value="groupForm.chat_id" :disabled="!!groupForm.id" placeholder="在群内发送 /id 或从日志获取" />
        </NFormItem>
        <NFormItem label="群组名称">
          <NInput v-model:value="groupForm.title" placeholder="选填" />
        </NFormItem>
        <div class="row"><div><div class="row-title">启用该群验证</div></div><NSwitch v-model:value="groupForm.verify_enabled" size="small" /></div>
        <div class="grid grid-cols-3 gap-2 mt-3">
          <NFormItem label="题目类型">
            <NSelect v-model:value="groupForm.captcha_type" size="small" :options="[{ label: '多选', value: 'choice' }, { label: '算术', value: 'math' }]" />
          </NFormItem>
          <NFormItem label="选项数">
            <NInputNumber v-model:value="groupForm.captcha_options" :min="2" :max="8" size="small" class="!w-full" />
          </NFormItem>
          <NFormItem label="尝试次数">
            <NInputNumber v-model:value="groupForm.captcha_attempts" :min="1" :max="10" size="small" class="!w-full" />
          </NFormItem>
        </div>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showGroup = false">取消</NButton>
          <NButton size="small" type="primary" @click="saveGroup">保存</NButton>
        </div>
      </template>
    </NModal>

    <!-- 违禁词表单 -->
    <NModal v-model:show="showWord" preset="card" :title="wordForm.id ? '编辑规则' : '添加规则'" style="max-width: 420px" :bordered="false" size="small">
      <NForm label-placement="top">
        <NFormItem label="内容">
          <NInput v-model:value="wordForm.word" placeholder="关键词或正则表达式" />
        </NFormItem>
        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="类型">
            <NSelect v-model:value="wordForm.category" :options="categoryOptions" />
          </NFormItem>
          <NFormItem label="处理方式">
            <NSelect v-model:value="wordForm.action" :options="actionOptions" />
          </NFormItem>
        </div>
        <NFormItem label="禁言时长（分钟）">
          <NInputNumber v-model:value="wordForm.mute_minutes" :min="1" :max="1440" class="!w-full" />
        </NFormItem>
        <div class="row"><div><div class="row-title">启用</div></div><NSwitch v-model:value="wordForm.enabled" size="small" /></div>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showWord = false">取消</NButton>
          <NButton size="small" type="primary" @click="saveWord">保存</NButton>
        </div>
      </template>
    </NModal>

    <!-- 批量导入 -->
    <NModal v-model:show="showImport" preset="card" title="批量导入违禁词" style="max-width: 460px" :bordered="false" size="small">
      <div class="text-xs tg-text-3 mb-2">每行一个词，或使用逗号分隔</div>
      <NInput v-model:value="importText" type="textarea" :autosize="{ minRows: 8 }" placeholder="广告&#10;推广&#10;加微信&#10;刷单" />
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showImport = false">取消</NButton>
          <NButton size="small" type="primary" @click="doImport">导入</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px dashed var(--tg-border); }
.row:last-child { border-bottom: none; }
.row-title { font-size: 13px; font-weight: 500; }
.row-desc { font-size: 11.5px; color: var(--tg-text-3); margin-top: 1px; }

.preview-box { background: var(--tg-surface-2); border: 1px solid var(--tg-border); border-radius: 10px; padding: 12px; }
.chat-sim { border-radius: 9px; overflow: hidden; border: 1px solid var(--tg-border); background: var(--tg-surface); }
.chat-head { padding: 7px 10px; font-size: 11.5px; color: var(--tg-text-3); border-bottom: 1px solid var(--tg-border); }
.chat-body { padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.msg { background: var(--tg-surface-2); border-radius: 8px; padding: 9px 11px; font-size: 12.5px; line-height: 1.7; }
.opts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.opt {
  padding: 8px; border-radius: 7px; border: 1px solid var(--tg-border);
  background: var(--tg-surface); color: var(--tg-text); font-size: 12.5px; cursor: pointer;
  transition: all .15s ease;
}
.opt:hover { border-color: var(--tg-brand); color: var(--tg-brand); }
.opt.correct { background: rgba(22,163,74,.1); border-color: #16a34a; color: #16a34a; }
.opt.wrong { background: rgba(220,38,38,.08); border-color: #dc2626; color: #dc2626; }
.opt.admin-pass { grid-column: 1 / -1; color: #16a34a; border-color: rgba(22,163,74,.4); }
.result { font-size: 12px; padding: 6px 9px; border-radius: 6px; }
.result.pass { background: rgba(22,163,74,.1); color: #16a34a; }
.result.fail { background: rgba(220,38,38,.08); color: #dc2626; }
</style>
