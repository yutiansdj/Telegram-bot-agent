<script setup>

import { ref, onMounted, computed, h } from 'vue';
import {
  NButton, NIcon, NInput, NInputNumber, NSelect, NSwitch, NForm, NFormItem,
  NAlert, NTag, NDataTable, NTabs, NTabPane, NPopconfirm, NSkeleton,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { useSearchFocus } from '@/composables/useSearchFocus';
import { fmtDate } from '@/utils/format';

const loading = ref(true);
const saving = ref(false);
const s = ref({});
const logs = ref({ list: [], total: 0, configured: false });
const logLoading = ref(false);
const testTo = ref('');
const testing = ref(false);
const showPwd = ref(false);

const templates = [
  { key: 'welcome', name: '欢迎邮件', desc: '用户注册成功后自动发送', field: 'mail_notify_register' },
  { key: 'ticket', name: '工单通知', desc: '流量申请审核结果通知', field: 'mail_notify_ticket' },
  { key: 'quota', name: '额度预警', desc: '流量使用达到阈值提醒', field: 'mail_notify_quota' },
];

const secureOptions = [
  { label: 'SSL/TLS（465）', value: 'ssl' },
  { label: 'STARTTLS（587）', value: 'tls' },
  { label: '不加密（25）', value: 'none' },
];

const presets = ref([]);
const mtaReady = ref(false);
const checking = ref(false);
const checkResult = ref(null);

const presetOptions = computed(() => [
  { label: '自定义 SMTP 服务器', value: '' },
  ...presets.value.map((p) => ({ label: p.label, value: p.value })),
]);

const currentPreset = computed(() => presets.value.find((p) => p.value === s.value.smtp_preset));

function onPresetChange(v) {
  s.value.smtp_preset = v;
  const p = presets.value.find((x) => x.value === v);
  if (p) {
    s.value.smtp_host = p.host;
    s.value.smtp_port = String(p.port);
    s.value.smtp_secure = p.secure;
  }
  checkResult.value = null;
}

async function checkConn() {
  checking.value = true;
  checkResult.value = null;
  try {
    const res = await api.adminMailCheck({ settings: s.value });
    checkResult.value = res.data;
  } catch (e) { window.$message.error(e.message); }
  finally { checking.value = false; }
}

function toggle(name) {
  s.value[name] = s.value[name] === '1' ? '0' : '1';
}



async function load() {
  loading.value = true;
  try {
    const [res, pre] = await Promise.all([api.adminSettings(), api.adminMailPresets()]);
    s.value = { ...res.data.settings };
    // 数值型设置统一转 number，避免输入框空白
    for (const k of Object.keys(s.value)) {
      if (/_(mb|min|max|days|hours|limit|len|ttl|options|attempts|timeout|window|port|keep|size|percent|pct|rate)$/.test(k) || k === 'ui_radius' || k === 'ui_font_size') {
        if (s.value[k] !== '' && s.value[k] !== null && !isNaN(Number(s.value[k]))) s.value[k] = Number(s.value[k]);
        else if (s.value[k] === '') s.value[k] = null;
      }
    }
    presets.value = pre.data.presets || [];
    mtaReady.value = !!pre.data.mta;
    testTo.value = s.value.smtp_test_to || s.value.smtp_from || '';
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function save() {
  saving.value = true;
  try {
    await api.adminSaveSettings(s.value);
    window.$message.success('邮件配置已保存');
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

async function testSend() {
  if (!testTo.value) { window.$message.warning('请填写测试收件邮箱'); return; }
  testing.value = true;
  try {
    const res = await api.adminSmtpTest({ to: testTo.value, settings: s.value });
    window.$message.success(res.message);
    loadLogs();
  } catch (e) { window.$message.error(e.message); }
  finally { testing.value = false; }
}

async function loadLogs() {
  logLoading.value = true;
  try {
    const res = await api.adminMailLogs({ page: 1, pageSize: 50 });
    logs.value = res.data;
  } catch (e) { window.$message.error(e.message); }
  finally { logLoading.value = false; }
}

async function clearLogs() {
  try {
    await api.adminClearMailLogs();
    window.$message.success('已清空');
    loadLogs();
  } catch (e) { window.$message.error(e.message); }
}

const logColumns = [
  { title: '时间', key: 'created_at', width: 145, render: (r) => fmtDate(r.created_at) },
  { title: '收件人', key: 'to_addr', width: 180, ellipsis: { tooltip: true } },
  { title: '主题', key: 'subject', ellipsis: { tooltip: true } },
  {
    title: '状态', key: 'status', width: 90,
    render: (r) => h(NTag, { size: 'small', type: r.status === 'sent' ? 'success' : 'error', bordered: false },
      { default: () => (r.status === 'sent' ? '已发送' : '失败') }),
  },
  { title: '错误信息', key: 'error', width: 220, ellipsis: { tooltip: true }, render: (r) => r.error || '-' },
];

useSearchFocus(null);
onMounted(() => { load(); loadLogs(); });
</script>

<template>
  <div>
    <PageHeader title="邮件设置" subtitle="配置 SMTP 发信服务，用于注册欢迎、工单通知与额度预警" icon="tabler:mail">
      <template #actions>
        <NButton size="small" quaternary @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          重置
        </NButton>
        <NButton type="primary" size="small" :loading="saving" @click="save">保存配置</NButton>
      </template>
    </PageHeader>

    <NAlert v-if="!logs.configured" type="warning" :bordered="false" class="mb-3" :show-icon="true">
      当前邮件服务未启用或未配置，所有通知邮件都不会发送。填写下方配置并开启「启用邮件服务」后生效。
    </NAlert>

    <div class="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-3 items-start">
      <NSkeleton v-if="loading" height="420px" :sharp="false" />

      <div v-else class="flex flex-col gap-3">
        <div class="tg-card p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="tg-section-title">
              <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:server" /></NIcon>
              发信服务器
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs tg-text-3">启用邮件服务</span>
              <NSwitch :value="s.smtp_enabled === '1'" size="small" @update:value="toggle('smtp_enabled')" />
            </div>
          </div>

          <NAlert v-if="mtaReady" type="success" :bordered="false" class="mb-4" :show-icon="true">
            <b>免配置发送</b>：服务器已内置邮件中继。选择你的邮箱服务商，只需填写<b>邮箱账号</b>和<b>授权码</b>即可发送，无需填写服务器地址、端口或加密方式。
          </NAlert>
          <NFormItem data-search-anchor="smtp-preset" label="邮箱服务商">
            <NSelect :value="s.smtp_preset" :options="presetOptions" placeholder="选择后自动配置服务器" @update:value="onPresetChange" />
          </NFormItem>
          <div v-if="currentPreset" class="preset-tip">
            <NIcon size="14"><Icon icon="tabler:info-circle" /></NIcon>
            <span>{{ currentPreset.note }} · 服务器 {{ currentPreset.host }}:{{ currentPreset.port }}</span>
          </div>

          <div v-if="!s.smtp_preset" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <NFormItem label="SMTP 服务器">
              <NInput v-model:value="s.smtp_host" placeholder="smtp.qq.com" />
            </NFormItem>
            <NFormItem label="端口 / 加密方式">
              <div class="flex gap-2 w-full">
                <NInputNumber v-model:value.number="s.smtp_port" :min="1" :max="65535" placeholder="465" class="!w-[110px]" />
                <NSelect v-model:value="s.smtp_secure" :options="secureOptions" class="flex-1" />
              </div>
            </NFormItem>
          </div>
          <NForm label-placement="top">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NFormItem data-search-anchor="smtp-auth" label="账号（登录用户名）">
                <NInput v-model:value="s.smtp_user" placeholder="noreply@example.com" autocomplete="off" />
              </NFormItem>
              <NFormItem label="密码 / 授权码">
                <div class="flex gap-1 w-full">
                  <NInput
                    v-model:value="s.smtp_pass" :type="showPwd ? 'text' : 'password'"
                    placeholder="QQ/163 需使用授权码" autocomplete="new-password"
                  />
                  <NButton @click="showPwd = !showPwd">
                    <template #icon><NIcon size="15"><Icon :icon="showPwd ? 'tabler:eye-off' : 'tabler:eye'" /></NIcon></template>
                  </NButton>
                </div>
              </NFormItem>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NFormItem label="发件人地址">
                <NInput v-model:value="s.smtp_from" placeholder="留空则使用登录账号" />
              </NFormItem>
              <NFormItem label="发件人显示名">
                <NInput v-model:value="s.smtp_from_name" placeholder="TG 代理平台" />
              </NFormItem>
            </div>
          </NForm>
        </div>

        <div class="tg-card p-5">
          <div class="tg-section-title mb-3">
            <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:mail-box" /></NIcon>
            通知模板
          </div>
          <div class="tpl-list">
            <div class="tpl-row">
              <div>
                <div class="text-[13.5px] font-medium">注册欢迎邮件</div>
                <div class="text-xs tg-text-3">用户注册成功后自动发送</div>
              </div>
              <NSwitch :value="s.mail_notify_register === '1'" size="small" @update:value="toggle('mail_notify_register')" />
            </div>
            <div class="tpl-row">
              <div>
                <div class="text-[13.5px] font-medium">流量申请结果通知</div>
                <div class="text-xs tg-text-3">审核通过或拒绝时通知用户</div>
              </div>
              <NSwitch :value="s.mail_notify_ticket === '1'" size="small" @update:value="toggle('mail_notify_ticket')" />
            </div>
            <div class="tpl-row">
              <div>
                <div class="text-[13.5px] font-medium">额度预警提醒</div>
                <div class="text-xs tg-text-3">流量达到阈值时提醒用户</div>
              </div>
              <NSwitch :value="s.mail_notify_quota === '1'" size="small" @update:value="toggle('mail_notify_quota')" />
            </div>
            <div class="flex items-center justify-between pt-3">
              <span class="text-xs tg-text-3">邮件内容支持自定义模板</span>
              <NButton size="tiny" type="primary" secondary tag="a" href="/admin/templates">
                <template #icon><NIcon size="13"><Icon icon="tabler:template" /></NIcon></template>
                编辑邮件模板
              </NButton>
            </div>
          </div>
          <div v-if="false" class="tpl-list">
            <div v-for="t in templates" :key="t.key" class="tpl-row">
              <div>
                <div class="text-[13.5px] font-medium">{{ t.name }}</div>
                <div class="text-xs tg-text-3">{{ t.desc }}</div>
              </div>
              <NSwitch :value="s[t.field] === '1'" size="small" @update:value="toggle(t.field)" />
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <div data-search-anchor="smtp-test" class="tg-card p-4">
          <div class="tg-section-title mb-3">
            <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:send" /></NIcon>
            发送测试邮件
          </div>
          <NInput v-model:value="testTo" placeholder="收件邮箱" class="mb-2">
            <template #prefix><NIcon size="14" class="tg-text-3"><Icon icon="tabler:at" /></NIcon></template>
          </NInput>
          <div class="grid grid-cols-2 gap-2 mb-2">
            <NButton :loading="checking" @click="checkConn">检测连接</NButton>
            <NButton type="primary" :loading="testing" @click="testSend">发送测试</NButton>
          </div>
          <div v-if="checkResult" class="check-result" :class="{ ok: checkResult.reachable }">
            <NIcon size="13"><Icon :icon="checkResult.reachable ? 'tabler:circle-check' : 'tabler:circle-x'" /></NIcon>
            {{ checkResult.reachable ? `连接正常 · ${checkResult.latency}ms` : '无法连接服务器' }}
            <span class="opacity-70">（{{ checkResult.host }}:{{ checkResult.port }}）</span>
          </div>
          <div class="text-xs tg-text-3 mt-2 leading-relaxed">
            测试使用当前表单中的配置（无需先保存）。发送结果会记录在下方「发送记录」中。
          </div>
        </div>

        <div class="tg-card p-4">
          <div class="tg-section-title mb-2">常见问题</div>
          <ul class="faq">
            <li><b>QQ / 163 邮箱</b>：密码位置填「授权码」，不是登录密码</li>
            <li><b>端口与加密</b>：465 选 SSL，587 选 STARTTLS</li>
            <li><b>发送失败</b>：检查服务器防火墙是否放行 465/587 出站</li>
            <li><b>进入垃圾箱</b>：建议使用企业邮箱域名做发件人</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="tg-card mt-3">
      <NTabs type="line" size="small" class="px-4 pt-2">
        <NTabPane name="logs" :tab="`发送记录${logs.total ? ' (' + logs.total + ')' : ''}`">
          <div class="pb-3 -mx-4">
            <NDataTable
              :columns="logColumns" :data="logs.list" :loading="logLoading" :bordered="false" size="small"
              :row-key="(r) => r.id" :scroll-x="780" :max-height="340"
            />
            <div class="px-4 pt-2 flex justify-end">
              <NPopconfirm @positive-click="clearLogs">
                <template #trigger>
                  <NButton size="tiny" quaternary type="error">清空记录</NButton>
                </template>
                确定清空全部邮件发送记录？
              </NPopconfirm>
            </div>
          </div>
        </NTabPane>
      </NTabs>
    </div>
  </div>
</template>

<style scoped>
.tpl-list { display: flex; flex-direction: column; }
.tpl-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 0; border-bottom: 1px dashed var(--tg-border);
}
.tpl-row:last-child { border-bottom: none; }
.preset-tip { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--tg-text-2); background:var(--tg-surface-2); border:1px solid var(--tg-border); border-radius:7px; padding:7px 10px; margin:-6px 0 14px; }
.check-result { display:flex; align-items:center; gap:5px; font-size:12px; padding:6px 9px; border-radius:6px; background:rgba(220,38,38,.08); color:#dc2626; }
.check-result.ok { background:rgba(22,163,74,.08); color:#16a34a; }
.faq { margin: 0; padding-left: 16px; font-size: 12.5px; color: var(--tg-text-2); line-height: 1.9; }
</style>
