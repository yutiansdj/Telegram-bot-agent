<script setup>
import { ref, onMounted, computed } from 'vue';
import { NButton, NIcon, NInput, NForm, NFormItem, NDescriptions, NDescriptionsItem, NTag, NSwitch } from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { fmtDate, fmtMB } from '@/utils/format';

const auth = useAuthStore();
const theme = useThemeStore();
const loading = ref(true);
const stats = ref({ accounts: 0, quota_mb: 0 });
const savingProfile = ref(false);
const savingPwd = ref(false);
const email = ref('');

const pwd = ref({ oldPassword: '', newPassword: '', confirm: '' });

const usedPct = computed(() => (stats.value.quota_mb ? 0 : 0));

async function load() {
  loading.value = true;
  try {
    const res = await api.me();
    stats.value = res.data.stats;
    email.value = res.data.user.email || '';
    auth.user = res.data.user;
    auth.persist();
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function saveProfile() {
  savingProfile.value = true;
  try {
    await api.updateProfile({ email: email.value });
    window.$message.success('资料已保存');
    await load();
  } catch (e) { window.$message.error(e.message); }
  finally { savingProfile.value = false; }
}

async function savePwd() {
  if (!pwd.value.oldPassword) { window.$message.warning('请输入原密码'); return; }
  if (pwd.value.newPassword.length < 6) { window.$message.warning('新密码至少 6 位'); return; }
  if (pwd.value.newPassword !== pwd.value.confirm) { window.$message.warning('两次输入的新密码不一致'); return; }
  savingPwd.value = true;
  try {
    await api.changePassword({ oldPassword: pwd.value.oldPassword, newPassword: pwd.value.newPassword });
    window.$message.success('密码已更新，请重新登录');
    pwd.value = { oldPassword: '', newPassword: '', confirm: '' };
    setTimeout(() => auth.logout(), 800);
  } catch (e) { window.$message.error(e.message); }
  finally { savingPwd.value = false; }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="个人设置" subtitle="管理你的账号资料、安全设置与界面偏好" icon="tabler:user-circle" />

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <!-- 账号信息 -->
      <div class="lg:col-span-2 flex flex-col gap-3">
        <div class="tg-card p-5">
          <div class="tg-section-title mb-4">账号资料</div>
          <div class="flex items-center gap-3 mb-5">
            <div class="avatar">{{ auth.displayName.slice(0, 1).toUpperCase() }}</div>
            <div>
              <div class="text-base font-semibold flex items-center gap-2">
                {{ auth.displayName }}
                <NTag size="small" :type="auth.isAdmin ? 'primary' : 'default'" :bordered="false">
                  {{ auth.isAdmin ? '管理员' : '普通用户' }}
                </NTag>
              </div>
              <div class="text-xs tg-text-3 mt-0.5">注册于 {{ fmtDate(auth.user?.created_at, false) }}</div>
            </div>
          </div>
          <NForm label-placement="top">
            <NFormItem label="用户名">
              <NInput :value="auth.displayName" disabled />
            </NFormItem>
            <NFormItem label="邮箱（用于接收流量提醒）">
              <NInput v-model:value="email" placeholder="选填" />
            </NFormItem>
          </NForm>
          <NButton type="primary" size="small" :loading="savingProfile" @click="saveProfile">保存资料</NButton>
        </div>

        <div class="tg-card p-5">
          <div class="tg-section-title mb-4">修改密码</div>
          <NForm label-placement="top">
            <NFormItem label="原密码">
              <NInput v-model:value="pwd.oldPassword" type="password" show-password-on="click" />
            </NFormItem>
            <NFormItem label="新密码">
              <NInput v-model:value="pwd.newPassword" type="password" show-password-on="click" placeholder="至少 6 位" />
            </NFormItem>
            <NFormItem label="确认新密码">
              <NInput v-model:value="pwd.confirm" type="password" show-password-on="click" />
            </NFormItem>
          </NForm>
          <NButton size="small" type="primary" :loading="savingPwd" @click="savePwd">更新密码</NButton>
          <span class="text-xs tg-text-3 ml-2">更新后需要重新登录</span>
        </div>
      </div>

      <!-- 侧栏 -->
      <div class="flex flex-col gap-3">
        <div class="tg-card p-4">
          <div class="tg-section-title mb-3">账户概况</div>
          <NDescriptions :column="1" label-placement="left" size="small" bordered>
            <NDescriptionsItem label="我的代理">{{ stats.accounts }} 个</NDescriptionsItem>
            <NDescriptionsItem label="账户总额度">{{ fmtMB(stats.quota_mb) }}</NDescriptionsItem>
            <NDescriptionsItem label="最近登录">{{ fmtDate(auth.user?.last_login_at) }}</NDescriptionsItem>
            <NDescriptionsItem label="账号状态">
              <NTag size="small" type="success" :bordered="false">正常</NTag>
            </NDescriptionsItem>
          </NDescriptions>
        </div>

        <div class="tg-card p-4">
          <div class="tg-section-title mb-3">界面偏好</div>
          <div class="flex items-center justify-between py-1.5">
            <div>
              <div class="text-[13px] font-medium">深色模式</div>
              <div class="text-xs tg-text-3">默认使用浅色主题</div>
            </div>
            <NSwitch :value="theme.dark" size="small" @update:value="theme.toggleDark()" />
          </div>
          <div class="flex items-center justify-between py-1.5">
            <div>
              <div class="text-[13px] font-medium">侧边栏折叠</div>
              <div class="text-xs tg-text-3">节省横向空间</div>
            </div>
            <NSwitch :value="theme.collapsed" size="small" @update:value="theme.toggleCollapse()" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.avatar {
  width: 52px; height: 52px; border-radius: 14px;
  display: grid; place-items: center;
  background: var(--tg-brand-soft); color: var(--tg-brand);
  font-size: 22px; font-weight: 600;
}
</style>
