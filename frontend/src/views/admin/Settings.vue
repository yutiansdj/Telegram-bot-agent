<script setup>
import { ref, onMounted, computed } from 'vue';
import {
  NButton, NIcon, NInput, NInputNumber, NSwitch, NForm, NFormItem, NAlert, NDivider, NTag, NSpin,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const loading = ref(true);
const saving = ref(false);
const s = ref({});

const boolFields = ['register_enabled', 'ticket_enabled', 'ticket_auto_approve', 'show_public_status'];

function toggle(name) {
  s.value[name] = s.value[name] === '1' ? '0' : '1';
}

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
    const res = await api.adminSaveSettings(s.value);
    s.value = { ...res.data.settings };
    window.$message.success('设置已保存');
    auth.fetchPublicInfo();
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

async function resync() {
  try {
    const res = await api.adminResync();
    window.$message.success(res.message);
  } catch (e) { window.$message.error(e.message); }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="系统设置" subtitle="站点信息、注册策略、流量规则与代理参数配置" icon="tabler:settings">
      <template #actions>
        <NButton size="small" quaternary @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          重置
        </NButton>
        <NButton type="primary" size="small" :loading="saving" @click="save">保存设置</NButton>
      </template>
    </PageHeader>

    <NSpin :show="loading">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <!-- 站点信息 -->
        <div class="tg-card p-5">
          <div class="tg-section-title mb-4">
            <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:world" /></NIcon>
            站点信息
          </div>
          <NForm label-placement="top">
            <NFormItem label="站点名称">
              <NInput v-model:value="s.site_name" placeholder="显示在登录页与侧边栏" />
            </NFormItem>
            <NFormItem label="站点描述">
              <NInput v-model:value="s.site_desc" type="textarea" :autosize="{ minRows: 2 }" />
            </NFormItem>
            <NFormItem label="全站公告（显示在用户仪表盘）">
              <NInput v-model:value="s.announcement" type="textarea" :autosize="{ minRows: 2 }" placeholder="留空则不显示" />
            </NFormItem>
            <div class="grid grid-cols-2 gap-3">
              <NFormItem label="客服联系方式">
                <NInput v-model:value="s.support_contact" placeholder="@username" />
              </NFormItem>
              <NFormItem label="ICP 备案号">
                <NInput v-model:value="s.icp" placeholder="选填" />
              </NFormItem>
            </div>
          </NForm>
        </div>

        <!-- 注册与用户策略 -->
        <div class="tg-card p-5">
          <div class="tg-section-title mb-4">
            <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:user-cog" /></NIcon>
            注册与用户策略
          </div>
          <NForm label-placement="top">
            <div class="setting-row">
              <div>
                <div class="setting-name">开放自助注册</div>
                <div class="setting-desc">关闭后仅管理员可创建账号</div>
              </div>
              <NSwitch :value="s.register_enabled === '1'" size="small" @update:value="toggle('register_enabled')" />
            </div>
            <NFormItem label="注册赠送额度（MB）" class="mt-2">
              <NInputNumber v-model:value.number="s.register_quota_mb" :min="0" :step="1024" class="!w-full" />
            </NFormItem>
            <div class="grid grid-cols-2 gap-3">
              <NFormItem label="新用户默认额度（MB）">
                <NInputNumber v-model:value.number="s.default_quota_mb" :min="0" :step="1024" class="!w-full" />
              </NFormItem>
              <NFormItem label="每人最多代理数">
                <NInputNumber v-model:value.number="s.max_accounts_per_user" :min="1" :max="100" class="!w-full" />
              </NFormItem>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">展示公开统计</div>
                <div class="setting-desc">在登录页展示用户数与节点数</div>
              </div>
              <NSwitch :value="s.show_public_status === '1'" size="small" @update:value="toggle('show_public_status')" />
            </div>
          </NForm>
        </div>

        <!-- 流量申请 -->
        <div class="tg-card p-5">
          <div class="tg-section-title mb-4">
            <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:ticket" /></NIcon>
            流量申请策略
          </div>
          <NForm label-placement="top">
            <div class="setting-row">
              <div>
                <div class="setting-name">开放流量申请</div>
                <div class="setting-desc">允许用户自助提交流量申请</div>
              </div>
              <NSwitch :value="s.ticket_enabled === '1'" size="small" @update:value="toggle('ticket_enabled')" />
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">自动审核通过</div>
                <div class="setting-desc">开启后申请将自动发放（谨慎使用）</div>
              </div>
              <NSwitch :value="s.ticket_auto_approve === '1'" size="small" @update:value="toggle('ticket_auto_approve')" />
            </div>
            <NFormItem label="单日单人流量上限（MB，0 不限制）" class="mt-2">
              <NInputNumber v-model:value.number="s.daily_transfer_limit_mb" :min="0" :step="1024" class="!w-full" />
            </NFormItem>
          </NForm>
        </div>

        <!-- 代理参数 -->
        <div class="tg-card p-5">
          <div class="tg-section-title mb-4">
            <NIcon size="16" class="mr-1 align-[-3px]"><Icon icon="tabler:server" /></NIcon>
            代理与节点参数
          </div>
          <NForm label-placement="top">
            <NFormItem label="全局公网地址（用于生成用户代理链接）">
              <NInput v-model:value="s.node_public_ip" placeholder="例如 154.222.24.221" />
            </NFormItem>
            <NFormItem label="伪装域名池（逗号分隔，用于生成 secret 的 domain fronting 段）">
              <NInput v-model:value="s.fake_domains" placeholder="www.cloudflare.com,www.microsoft.com" />
            </NFormItem>
          </NForm>
          <NAlert type="info" :bordered="false" class="!mt-1">
            修改全局公网地址后，所有代理链接会立即更新为新地址；伪装域名只对新建或重置密钥的代理生效。
          </NAlert>
          <NDivider class="!my-4" />
          <div class="flex items-center justify-between">
            <div>
              <div class="setting-name">同步代理状态</div>
              <div class="setting-desc">按额度与有效期规则启动/停止全部代理进程</div>
            </div>
            <NButton size="small" @click="resync">立即同步</NButton>
          </div>
        </div>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.setting-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--tg-border);
}
.setting-row:last-child { border-bottom: none; }
.setting-name { font-size: 13.5px; font-weight: 500; }
.setting-desc { font-size: 12px; color: var(--tg-text-3); margin-top: 1px; }
</style>
