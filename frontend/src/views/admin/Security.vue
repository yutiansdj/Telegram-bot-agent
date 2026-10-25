<script setup>
import { ref, onMounted } from 'vue';
import { NButton, NIcon, NInput, NInputNumber, NSwitch, NForm, NFormItem, NAlert } from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { useSearchFocus } from '@/composables/useSearchFocus';

const loading = ref(true);
const saving = ref(false);
const s = ref({});
const mailReady = ref(false);
const evPreview = ref(null);
let tplTimer = null;

async function loadPreview() {
  try {
    const res = await api.previewEmailTpl({ subject: s.value.verify_template_subject, body: s.value.verify_template_body });
    evPreview.value = res.data;
  } catch { /* ignore */ }
}

function onTplChange() {
  clearTimeout(tplTimer);
  tplTimer = setTimeout(loadPreview, 500);
}

function toggle(k) { s.value[k] = s.value[k] === '1' ? '0' : '1'; }

async function load() {
  loading.value = true;
  try {
    const res = await api.adminSettings();
    s.value = { ...res.data.settings };
    // 数值型设置统一转 number，避免输入框空白
    for (const k of Object.keys(s.value)) {
      if (/_(mb|min|max|days|hours|limit|len|ttl|options|attempts|timeout|window|port|keep|size|percent|pct|rate)$/.test(k) || k === 'ui_radius' || k === 'ui_font_size') {
        if (s.value[k] !== '' && s.value[k] !== null && !isNaN(Number(s.value[k]))) s.value[k] = Number(s.value[k]);
        else if (s.value[k] === '') s.value[k] = null;
      }
    }
    try { const st = await api.emailStatus(); mailReady.value = st.data.mailReady; } catch { /* ignore */ }
    if (s.value.register_email_verify === '1') loadPreview();
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function save() {
  saving.value = true;
  try {
    await api.adminSaveSettings(s.value);
    window.$message.success('注册策略已保存');
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

useSearchFocus(null);
onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="注册策略" subtitle="控制用户注册入口、初始额度与申请规则" icon="tabler:lock-access">
      <template #actions>
        <NButton size="small" quaternary @click="load">重置</NButton>
        <NButton type="primary" size="small" :loading="saving" @click="save">保存设置</NButton>
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      <div class="tg-card p-5">
        <div class="tg-section-title mb-4">
          <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:user-plus" /></NIcon>
          注册开关与额度
        </div>
        <div class="row">
          <div>
            <div class="row-title">开放自助注册</div>
            <div class="row-desc">关闭后只能由管理员创建账号</div>
          </div>
          <NSwitch :value="s.register_enabled === '1'" size="small" @update:value="toggle('register_enabled')" />
        </div>
        <div class="row">
          <div>
            <div class="row-title">注册必须填写邮箱</div>
            <div class="row-desc">便于后续接收通知邮件</div>
          </div>
          <NSwitch :value="s.register_need_email === '1'" size="small" @update:value="toggle('register_need_email')" />
        </div>
        <div class="row" data-search-anchor="sec-email-verify">
          <div>
            <div class="row-title">注册必须完成邮箱验证</div>
            <div class="row-desc">用户需接收并填写验证码才能注册成功</div>
          </div>
          <NSwitch :value="s.register_email_verify === '1'" size="small" @update:value="(v) => { s.register_email_verify = v ? '1' : '0'; if (v) loadPreview(); }" />
        </div>
        <NAlert v-if="s.register_email_verify === '1' && !mailReady" type="warning" :bordered="false" class="mb-2">
          已开启邮箱验证，但邮件服务尚未配置，用户将无法注册。请先到「系统配置 → 邮件服务」完成发信设置。
        </NAlert>
        <div v-if="s.register_email_verify === '1'" class="ev-config">
          <div class="text-xs font-medium mb-2">验证码策略</div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <NFormItem label="有效期（分钟）"><NInputNumber v-model:value.number="s.verify_code_ttl" :min="1" :max="60" size="small" class="!w-full" /></NFormItem>
            <NFormItem label="重发冷却（秒）"><NInputNumber v-model:value.number="s.verify_code_cooldown" :min="10" :max="600" size="small" class="!w-full" /></NFormItem>
            <NFormItem label="每邮箱每日上限"><NInputNumber v-model:value.number="s.verify_code_daily_limit" :min="1" :max="50" size="small" class="!w-full" /></NFormItem>
            <NFormItem label="错误次数上限"><NInputNumber v-model:value.number="s.verify_code_max_attempts" :min="1" :max="20" size="small" class="!w-full" /></NFormItem>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <NFormItem label="每 IP 每日上限"><NInputNumber v-model:value.number="s.verify_code_ip_limit" :min="1" :max="500" size="small" class="!w-full" /></NFormItem>
            <NFormItem label="验证码位数"><NInputNumber v-model:value.number="s.verify_code_len" :min="4" :max="8" size="small" class="!w-full" /></NFormItem>
          </div>
          <NFormItem label="邮件标题">
            <NInput v-model:value="s.verify_template_subject" size="small" placeholder="支持 {{site}} {{code}}" @input="onTplChange" />
          </NFormItem>
          <NFormItem label="邮件正文（HTML，支持 {{site}} {{code}} {{ttl}} {{color}}）">
            <NInput v-model:value="s.verify_template_body" type="textarea" :autosize="{ minRows: 5, maxRows: 12 }" placeholder="留空使用内置模板" @input="onTplChange" />
          </NFormItem>
          <div class="flex items-center justify-between mb-1">
            <span class="text-xs tg-text-3">实时预览</span>
            <NButton size="tiny" text type="primary" @click="loadPreview">刷新</NButton>
          </div>
          <iframe v-if="evPreview" :srcdoc="evPreview.html" sandbox="" class="ev-preview" />
        </div>
        <NForm label-placement="top" class="mt-3">
          <div class="grid grid-cols-2 gap-3">
            <NFormItem data-search-anchor="sec-quota" label="注册赠送额度（MB）">
              <NInputNumber v-model:value.number="s.register_quota_mb" :min="0" :step="1024" class="!w-full" />
            </NFormItem>
            <NFormItem label="同 IP 注册上限">
              <NInputNumber v-model:value.number="s.register_ip_limit" :min="0" class="!w-full" />
            </NFormItem>
          </div>
        </NForm>
        <NAlert type="info" :bordered="false">
          同 IP 注册上限填 0 表示不限制。开启邮箱验证前请先在「邮件设置」中完成 SMTP 配置。
        </NAlert>
      </div>

      <div class="tg-card p-5">
        <div class="tg-section-title mb-4">
          <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:user-cog" /></NIcon>
          用户与代理限制
        </div>
        <NForm label-placement="top">
          <div class="grid grid-cols-2 gap-3">
            <NFormItem label="新用户默认额度（MB）">
              <NInputNumber v-model:value.number="s.default_quota_mb" :min="0" :step="1024" class="!w-full" />
            </NFormItem>
            <NFormItem label="每人最多代理数">
              <NInputNumber v-model:value.number="s.max_accounts_per_user" :min="1" :max="100" class="!w-full" />
            </NFormItem>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <NFormItem label="单日流量上限（MB）">
              <NInputNumber v-model:value.number="s.daily_transfer_limit_mb" :min="0" :step="1024" class="!w-full" />
            </NFormItem>
            <NFormItem label="最小密码长度">
              <NInputNumber v-model:value.number="s.password_min_len" :min="4" :max="32" class="!w-full" />
            </NFormItem>
          </div>
        </NForm>
        <div class="row">
          <div>
            <div class="row-title">开放流量申请</div>
            <div class="row-desc">允许用户自助提交流量申请</div>
          </div>
          <NSwitch :value="s.ticket_enabled === '1'" size="small" @update:value="toggle('ticket_enabled')" />
        </div>
        <div class="row">
          <div>
            <div class="row-title">自动审核通过</div>
            <div class="row-desc">提交后立即到账（谨慎开启）</div>
          </div>
          <NSwitch :value="s.ticket_auto_approve === '1'" size="small" @update:value="toggle('ticket_auto_approve')" />
        </div>
        <div class="grid grid-cols-2 gap-3 mt-3">
          <NFormItem label="待审核申请上限" class="!mb-0">
            <NInputNumber v-model:value.number="s.ticket_max_pending" :min="1" class="!w-full" />
          </NFormItem>
          <NFormItem label="单次申请上限（MB）" class="!mb-0">
            <NInputNumber v-model:value.number="s.ticket_max_amount_mb" :min="1" :step="1024" class="!w-full" />
          </NFormItem>
        </div>
        <NFormItem label="申请页提示文字" class="!mt-3 !mb-0">
          <NInput v-model:value="s.ticket_notice" type="textarea" :autosize="{ minRows: 2 }" placeholder="显示在用户申请流量的页面上" />
        </NFormItem>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ev-config { background: var(--tg-surface-2); border: 1px solid var(--tg-border); border-radius: 9px; padding: 12px; margin-bottom: 10px; }
.ev-preview { width: 100%; height: 240px; border: 1px solid var(--tg-border); border-radius: 8px; background: #fff; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px dashed var(--tg-border); }
.row-title { font-size: 13.5px; font-weight: 500; }
.row-desc { font-size: 12px; color: var(--tg-text-3); margin-top: 1px; }
</style>
