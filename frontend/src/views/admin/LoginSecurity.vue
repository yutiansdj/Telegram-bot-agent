<script setup>
import { ref, onMounted, h } from 'vue';
import {
  NButton, NIcon, NInputNumber, NSwitch, NDataTable, NTag, NAlert, NTabs, NTabPane,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { fmtDate } from '@/utils/format';

const loading = ref(true);
const saving = ref(false);
const s = ref({});
const logs = ref({ list: [], total: 0 });
const logLoading = ref(false);
const tab = ref('config');

function toggle(k) { s.value[k] = s.value[k] === '1' ? '0' : '1'; }

async function load() {
  loading.value = true;
  try {
    const res = await api.adminSettings();
    s.value = { ...res.data.settings };
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function save() {
  saving.value = true;
  try {
    await api.adminSaveSettings(s.value);
    window.$message.success('登录安全设置已保存');
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

async function loadLogs() {
  logLoading.value = true;
  try {
    const res = await api.adminLoginLogs({ page: 1, pageSize: 50 });
    logs.value = res.data;
  } catch (e) { window.$message.error(e.message); }
  finally { logLoading.value = false; }
}

function onTab(v) { tab.value = v; if (v === 'logs') loadLogs(); }

const columns = [
  { title: '时间', key: 'created_at', width: 150, render: (r) => fmtDate(r.created_at) },
  { title: '用户名', key: 'username', width: 120 },
  { title: '结果', key: 'success', width: 84, render: (r) => h(NTag, { size: 'small', type: r.success ? 'success' : 'error', bordered: false }, { default: () => (r.success ? '成功' : '失败') }) },
  { title: '说明', key: 'message', width: 110 },
  { title: 'IP', key: 'ip', width: 140, render: (r) => h('span', { class: 'font-mono', style: 'font-size:12px' }, r.ip || '-') },
  { title: '客户端', key: 'ua', ellipsis: { tooltip: true }, render: (r) => h('span', { style: 'font-size:12px;color:var(--tg-text-3)' }, r.ua || '-') },
];

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="登录安全" subtitle="登录防护、会话时长与登录审计" icon="tabler:shield-check">
      <template #actions>
        <NButton type="primary" size="small" :loading="saving" @click="save">保存设置</NButton>
      </template>
    </PageHeader>

    <div class="tg-card">
      <NTabs :value="tab" type="line" size="small" class="px-4 pt-2" @update:value="onTab">
        <NTabPane name="config" tab="安全策略">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 py-3">
            <div>
              <div class="row">
                <div>
                  <div class="row-title">登录失败次数限制</div>
                  <div class="row-desc">超过限制后临时锁定账号</div>
                </div>
                <NInputNumber v-model:value.number="s.login_fail_limit" :min="0" :max="20" size="small" style="width: 90px" />
              </div>
              <div class="row">
                <div>
                  <div class="row-title">锁定时长（分钟）</div>
                  <div class="row-desc">锁定期内无法登录</div>
                </div>
                <NInputNumber v-model:value.number="s.login_fail_lock_min" :min="1" :max="1440" size="small" style="width: 90px" />
              </div>
              <div class="row">
                <div>
                  <div class="row-title">会话有效期（小时）</div>
                  <div class="row-desc">超时后需要重新登录</div>
                </div>
                <NInputNumber v-model:value.number="s.session_hours" :min="1" :max="8760" size="small" style="width: 90px" />
              </div>
            </div>
            <div>
              <div class="row">
                <div>
                  <div class="row-title">最小密码长度</div>
                  <div class="row-desc">同时作用于注册与改密</div>
                </div>
                <NInputNumber v-model:value.number="s.password_min_len" :min="4" :max="32" size="small" style="width: 90px" />
              </div>
              <div class="row">
                <div>
                  <div class="row-title">审计日志保留天数</div>
                  <div class="row-desc">在数据备份页执行清理时生效</div>
                </div>
                <NInputNumber v-model:value.number="s.audit_retention_days" :min="7" :max="3650" size="small" style="width: 90px" />
              </div>
              <div class="row">
                <div>
                  <div class="row-title">强制单点登录</div>
                  <div class="row-desc">新登录会踢掉旧会话</div>
                </div>
                <NSwitch :value="s.force_single_session === '1'" size="small" @update:value="toggle('force_single_session')" />
              </div>
            </div>
          </div>
          <NAlert type="info" :bordered="false" class="mb-3">
            登录失败限制当前按「用户名 + IP」统计；建议同时开启下方登录日志以便追溯异常。
          </NAlert>
        </NTabPane>

        <NTabPane name="logs" :tab="`登录日志${logs.total ? ' (' + logs.total + ')' : ''}`">
          <div class="pb-3 -mx-4">
            <NDataTable
              :columns="columns" :data="logs.list" :loading="logLoading" :bordered="false" size="small"
              :row-key="(r) => r.id" :scroll-x="860" :max-height="420"
            />
          </div>
        </NTabPane>
      </NTabs>
    </div>
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px dashed var(--tg-border); }
.row-title { font-size: 13.5px; font-weight: 500; }
.row-desc { font-size: 12px; color: var(--tg-text-3); margin-top: 1px; }
</style>
