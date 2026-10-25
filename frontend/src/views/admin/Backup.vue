<script setup>
import { ref, onMounted, h, computed } from 'vue';
import {
  NButton, NIcon, NDataTable, NTag, NPopconfirm, NSpace, NAlert, NStatistic,
  NGrid, NGi, NSpin, NSwitch, NInputNumber, NDivider,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { useSearchFocus } from '@/composables/useSearchFocus';
import { fmtBytes, fmtDate } from '@/utils/format';

const loading = ref(true);
const creating = ref(false);
const backups = ref({ list: [], keep: 10 });
const info = ref(null);
const cleanup = ref(null);
const maintenance = ref(false);

async function load() {
  loading.value = true;
  try {
    const [b, i] = await Promise.all([api.adminBackups(), api.adminSiteInfo()]);
    backups.value = b.data;
    info.value = i.data;
    maintenance.value = i.data.maintenance;
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function createBackup() {
  creating.value = true;
  try {
    const res = await api.adminCreateBackup();
    window.$message.success(res.message);
    await load();
  } catch (e) { window.$message.error(e.message); }
  finally { creating.value = false; }
}

async function removeBackup(row) {
  try {
    await api.adminDeleteBackup(row.name);
    window.$message.success('已删除');
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function runCleanup() {
  try {
    const res = await api.adminCleanup();
    cleanup.value = res.data;
    window.$message.success(res.message);
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function toggleMaintenance(on) {
  try {
    const res = await api.adminMaintenance(on);
    maintenance.value = on;
    window.$message.success(res.message);
  } catch (e) {
    maintenance.value = !on;
    window.$message.error(e.message);
  }
}

const columns = [
  { title: '备份文件', key: 'name', ellipsis: { tooltip: true }, render: (r) => h('span', { class: 'font-mono', style: 'font-size:12px' }, r.name) },
  { title: '大小', key: 'size', width: 110, align: 'right', render: (r) => fmtBytes(r.size) },
  { title: '创建时间', key: 'created_at', width: 150, render: (r) => fmtDate(r.created_at) },
  {
    title: '操作', key: 'actions', width: 150, fixed: 'right',
    render: (r) => h(NSpace, { size: 4, wrap: false }, {
      default: () => [
        h(NButton, { size: 'tiny', secondary: true, type: 'primary', tag: 'a', href: `/api/admin/backups/download?name=${encodeURIComponent(r.name)}` }, { default: () => '下载' }),
        h(NPopconfirm, { onPositiveClick: () => removeBackup(r) }, {
          trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
          default: () => '确定删除该备份？',
        }),
      ],
    }),
  },
];

useSearchFocus(null);
onMounted(load);
</script>

<template>
  <div>
    <PageHeader data-search-anchor="backup-create" title="数据与备份" subtitle="数据库备份、容量统计、数据清理与维护模式" icon="tabler:database">
      <template #actions>
        <NButton size="small" quaternary :loading="loading" @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          刷新
        </NButton>
        <NButton type="primary" size="small" :loading="creating" @click="createBackup">
          <template #icon><NIcon size="15"><Icon icon="tabler:database-plus" /></NIcon></template>
          立即备份
        </NButton>
      </template>
    </PageHeader>

    <NGrid :x-gap="12" :y-gap="12" cols="1 s:2 m:4" responsive="screen">
      <NGi>
        <div class="tg-card p-4">
          <div class="text-xs tg-text-3">数据库大小</div>
          <div class="text-[22px] font-semibold mt-1">{{ fmtBytes(info?.sizes.db || 0) }}</div>
        </div>
      </NGi>
      <NGi>
        <div class="tg-card p-4">
          <div class="text-xs tg-text-3">上传资源</div>
          <div class="text-[22px] font-semibold mt-1">{{ fmtBytes(info?.sizes.uploads || 0) }}</div>
        </div>
      </NGi>
      <NGi>
        <div class="tg-card p-4">
          <div class="text-xs tg-text-3">备份数量</div>
          <div class="text-[22px] font-semibold mt-1">{{ info?.backups ?? 0 }}</div>
        </div>
      </NGi>
      <NGi>
        <div class="tg-card p-4">
          <div class="text-xs tg-text-3">运行中代理</div>
          <div class="text-[22px] font-semibold mt-1">{{ info?.running ?? 0 }}</div>
        </div>
      </NGi>
    </NGrid>

    <div class="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 mt-3 items-start">
      <div class="tg-card">
        <div class="px-4 py-3 border-b tg-divider flex items-center justify-between">
          <div class="tg-section-title">备份列表</div>
          <span class="text-xs tg-text-3">自动保留最近 {{ backups.keep }} 份</span>
        </div>
        <NDataTable
          :columns="columns" :data="backups.list" :loading="loading" :bordered="false" size="small"
          :row-key="(r) => r.name" :max-height="380" :scroll-x="600"
        />
      </div>

      <div class="flex flex-col gap-3">
        <!-- 维护模式 -->
        <div class="tg-card p-4" data-search-anchor="backup-maintenance">
          <div class="tg-section-title mb-3">
            <NIcon size="15" class="mr-1 align-[-3px]"><Icon icon="tabler:tool" /></NIcon>
            维护模式
          </div>
          <div class="flex items-center justify-between">
            <div class="text-[13px]">开启后仅管理员可登录</div>
            <NSwitch :value="maintenance" size="small" @update:value="toggleMaintenance" />
          </div>
          <NAlert v-if="maintenance" type="warning" :bordered="false" class="mt-3">
            平台维护中：普通用户无法登录，已登录的代理不受影响。
          </NAlert>
        </div>

        <!-- 清理 -->
        <div class="tg-card p-4" data-search-anchor="backup-cleanup">
          <div class="tg-section-title mb-3">
            <NIcon size="15" class="mr-1 align-[-3px]"><Icon icon="tabler:trash" /></NIcon>
            数据清理
          </div>
          <div class="text-xs tg-text-3 leading-relaxed mb-3">
            按「审计日志保留天数」清理过期审计与登录日志（保留天数可在系统设置中修改），并删除 1 年前的流量明细。
          </div>
          <NPopconfirm @positive-click="runCleanup">
            <template #trigger>
              <NButton size="small" block tertiary type="warning">执行清理</NButton>
            </template>
            确定清理过期数据？此操作不可恢复。
          </NPopconfirm>
          <div v-if="cleanup" class="text-xs tg-text-3 mt-2">
            上次清理：审计 {{ cleanup.audit }} 条 / 登录 {{ cleanup.login }} 条 / 流量 {{ cleanup.traffic }} 条
          </div>
        </div>
      </div>
    </div>

    <NAlert type="info" :bordered="false" class="mt-3" :show-icon="true">
      备份使用 SQLite 原生 `VACUUM INTO` 生成一致性快照，可直接下载保存。建议定期下载到本地或对象存储。
    </NAlert>
  </div>
</template>
