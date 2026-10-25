<script setup>
import { ref, onMounted, h } from 'vue';
import {
  NButton, NIcon, NDataTable, NTag, NModal, NForm, NFormItem, NInput, NInputNumber,
  NSelect, NPopconfirm, NSpace, NAlert, NSpin, NProgress,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { fmtBytes, fmtDate } from '@/utils/format';

const loading = ref(true);
const list = ref([]);
const health = ref({});
const checking = ref(false);
const syncing = ref(false);

const showForm = ref(false);
const editing = ref(null);
const saving = ref(false);
const form = ref({ name: '', host: '', public_ip: '', domain: '', port_base: 20000, port_range: 1000, status: 'online', note: '', sort: 0 });

async function load() {
  loading.value = true;
  try {
    const res = await api.adminNodes();
    list.value = res.data.list;
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

async function checkHealth() {
  checking.value = true;
  try {
    const res = await api.adminNodeHealth();
    const map = {};
    for (const n of res.data.list) map[n.id] = n.health;
    health.value = map;
    window.$message.success('健康检测完成');
  } catch (e) { window.$message.error(e.message); }
  finally { checking.value = false; }
}

async function sync() {
  syncing.value = true;
  try {
    const res = await api.adminSyncNodes();
    window.$message.success(res.message);
    await load();
  } catch (e) { window.$message.error(e.message); }
  finally { syncing.value = false; }
}

function openCreate() {
  editing.value = null;
  form.value = { name: '', host: '', public_ip: '', domain: '', port_base: 20000, port_range: 1000, status: 'online', note: '', sort: 0 };
  showForm.value = true;
}

function openEdit(row) {
  editing.value = row;
  form.value = {
    name: row.name, host: row.host, public_ip: row.public_ip || '', domain: row.domain || '',
    port_base: row.port_base, port_range: row.port_range, status: row.status, note: row.note || '', sort: row.sort,
  };
  showForm.value = true;
}

async function save() {
  saving.value = true;
  try {
    if (editing.value) await api.adminUpdateNode(editing.value.id, form.value);
    else await api.adminCreateNode(form.value);
    window.$message.success('已保存');
    showForm.value = false;
    await load();
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

async function remove(row) {
  try {
    await api.adminDeleteNode(row.id);
    window.$message.success('已删除');
    await load();
  } catch (e) { window.$message.error(e.message); }
}

const columns = [
  { title: 'ID', key: 'id', width: 60 },
  {
    title: '节点', key: 'name', minWidth: 180,
    render: (r) => h('div', null, [
      h('div', { style: 'font-weight:500;font-size:13px' }, r.name),
      h('div', { style: 'font-size:11.5px;color:var(--tg-text-3)' }, r.note || '—'),
    ]),
  },
  {
    title: '公网地址', key: 'ip', width: 160,
    render: (r) => h('span', { class: 'font-mono', style: 'font-size:12px' }, r.ip || r.host),
  },
  {
    title: '端口池', key: 'port_base', width: 130,
    render: (r) => h('span', { style: 'font-size:12px' }, `${r.port_base} ~ ${r.port_base + r.port_range - 1}`),
  },
  {
    title: '代理 / 运行', key: 'account_count', width: 110, align: 'center',
    render: (r) => h('span', { style: 'font-size:12.5px' }, `${r.account_count} / `,
      h('span', { style: 'color:#16a34a;font-weight:500' }, r.running || 0)),
  },
  {
    title: '已用流量', key: 'used_bytes', width: 100, align: 'right',
    render: (r) => h('span', { style: 'font-variant-numeric: tabular-nums;font-size:12.5px' }, fmtBytes(r.used_bytes)),
  },
  {
    title: '健康状态', key: 'health', width: 150,
    render: (r) => {
      const hh = health.value[r.id];
      if (!hh) return h(NTag, { size: 'small', bordered: false }, { default: () => '未检测' });
      if (hh.online) {
        return h(NTag, { size: 'small', type: 'success', bordered: false }, {
          default: () => `正常 · ${hh.dcLatency || 0}ms`,
        });
      }
      return h(NTag, { size: 'small', type: 'error', bordered: false }, { default: () => '异常' });
    },
  },
  {
    title: '状态', key: 'status', width: 80,
    render: (r) => h(NTag, { size: 'small', type: r.status === 'online' ? 'success' : 'error', bordered: false },
      { default: () => (r.status === 'online' ? '上线' : '下线') }),
  },
  {
    title: '操作', key: 'actions', width: 130, fixed: 'right',
    render: (r) => h(NSpace, { size: 4, wrap: false }, {
      default: () => [
        h(NButton, { size: 'tiny', secondary: true, onClick: () => openEdit(r) }, { default: () => '编辑' }),
        h(NPopconfirm, { onPositiveClick: () => remove(r) }, {
          trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
          default: () => '确定删除该节点？',
        }),
      ],
    }),
  },
];

onMounted(async () => { await load(); checkHealth(); });
</script>

<template>
  <div>
    <PageHeader title="节点管理" subtitle="管理代理节点地址、端口池与健康状态" icon="tabler:server-2">
      <template #actions>
        <NButton size="small" quaternary :loading="checking" @click="checkHealth">
          <template #icon><NIcon size="15"><Icon icon="tabler:heartbeat" /></NIcon></template>
          健康检测
        </NButton>
        <NButton size="small" quaternary :loading="syncing" @click="sync">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          同步状态
        </NButton>
        <NButton type="primary" size="small" @click="openCreate">
          <template #icon><NIcon size="15"><Icon icon="tabler:plus" /></NIcon></template>
          添加节点
        </NButton>
      </template>
    </PageHeader>

    <div class="tg-card">
      <NDataTable :columns="columns" :data="list" :loading="loading" :bordered="false" size="small" :row-key="(r) => r.id" :scroll-x="1000" />
    </div>

    <NAlert type="info" :bordered="false" class="mt-3" :show-icon="true">
      每个代理账号在节点上占用一个独立端口，端口池范围决定该节点可承载的代理数量。修改公网地址后，用户侧代理链接会同步更新。
    </NAlert>

    <NModal v-model:show="showForm" preset="card" :title="editing ? '编辑节点' : '添加节点'" style="max-width: 500px" :bordered="false" size="small">
      <NForm label-placement="top">
        <NFormItem label="节点名称">
          <NInput v-model:value="form.name" placeholder="例如：主节点-HK" />
        </NFormItem>
        <NFormItem label="服务器地址（host）">
          <NInput v-model:value="form.host" placeholder="本机节点可填内网地址或任意标识" />
        </NFormItem>
        <NFormItem label="对外公网地址（用户连接使用）">
          <NInput v-model:value="form.public_ip" placeholder="留空则使用系统设置中的全局公网地址" />
        </NFormItem>
        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="起始端口">
            <NInputNumber v-model:value="form.port_base" :min="1024" :max="65000" class="!w-full" />
          </NFormItem>
          <NFormItem label="端口数量">
            <NInputNumber v-model:value="form.port_range" :min="1" :max="20000" class="!w-full" />
          </NFormItem>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="状态">
            <NSelect v-model:value="form.status" :options="[{ label: '上线', value: 'online' }, { label: '下线', value: 'offline' }]" />
          </NFormItem>
          <NFormItem label="排序">
            <NInputNumber v-model:value="form.sort" class="!w-full" />
          </NFormItem>
        </div>
        <NFormItem label="备注">
          <NInput v-model:value="form.note" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showForm = false">取消</NButton>
          <NButton size="small" type="primary" :loading="saving" @click="save">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>
