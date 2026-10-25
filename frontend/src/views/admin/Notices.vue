<script setup>
import { ref, onMounted, h } from 'vue';
import {
  NButton, NIcon, NInput, NModal, NForm, NFormItem, NSelect, NSwitch,
  NTag, NDataTable, NPopconfirm, NSpace, NDivider, NEmpty, NAlert,
} from 'naive-ui';
import { Icon } from '@iconify/vue';
import PageHeader from '@/components/common/PageHeader.vue';
import { api } from '@/api';
import { fmtDate } from '@/utils/format';

const loading = ref(true);
const list = ref([]);
const marquee = ref([]);

const showForm = ref(false);
const editing = ref(null);
const saving = ref(false);
const form = ref({});
const showMarquee = ref(false);
const marqueeForm = ref({ text: '', active: true, sort: 0 });

const typeOptions = [
  { label: '信息', value: 'info' },
  { label: '成功', value: 'success' },
  { label: '警告', value: 'warning' },
  { label: '紧急', value: 'error' },
];
const levelOptions = [
  { label: '普通', value: 'normal' },
  { label: '重要', value: 'important' },
  { label: '紧急', value: 'urgent' },
];

async function load() {
  loading.value = true;
  try {
    const res = await api.adminNotices();
    list.value = res.data.list;
    marquee.value = res.data.marquee;
  } catch (e) { window.$message.error(e.message); }
  finally { loading.value = false; }
}

function openCreate() {
  editing.value = null;
  form.value = { title: '', content: '', type: 'info', level: 'normal', target: 'all', pinned: false, active: true, starts_at: null, ends_at: null };
  showForm.value = true;
}

function openEdit(row) {
  editing.value = row;
  form.value = {
    id: row.id, title: row.title, content: row.content, type: row.type, level: row.level,
    target: row.target, pinned: !!row.pinned, active: !!row.active, starts_at: row.starts_at, ends_at: row.ends_at,
  };
  showForm.value = true;
}

async function save() {
  saving.value = true;
  try {
    await api.adminSaveNotice(form.value);
    window.$message.success('公告已保存');
    showForm.value = false;
    await load();
  } catch (e) { window.$message.error(e.message); }
  finally { saving.value = false; }
}

async function remove(row) {
  try {
    await api.adminDeleteNotice(row.id);
    window.$message.success('已删除');
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function saveMarquee() {
  if (!marqueeForm.value.text.trim()) { window.$message.warning('请填写跑马灯文字'); return; }
  try {
    await api.adminSaveMarquee(marqueeForm.value);
    window.$message.success('已保存');
    marqueeForm.value = { text: '', active: true, sort: 0 };
    showMarquee.value = false;
    await load();
  } catch (e) { window.$message.error(e.message); }
}

async function delMarquee(id) {
  try {
    await api.adminDeleteMarquee(id);
    await load();
  } catch (e) { window.$message.error(e.message); }
}

const columns = [
  { title: 'ID', key: 'id', width: 58 },
  {
    title: '标题', key: 'title', ellipsis: { tooltip: true },
    render: (r) => h('div', { class: 'flex items-center gap-1.5' }, [
      r.pinned ? h(NIcon, { size: 13, style: 'color:#d97706' }, { default: () => h(Icon, { icon: 'tabler:pinned' }) }) : null,
      h('span', { style: 'font-weight:500;font-size:13px' }, r.title),
    ]),
  },
  {
    title: '类型', key: 'type', width: 82,
    render: (r) => h(NTag, { size: 'small', type: r.type === 'error' ? 'error' : r.type === 'warning' ? 'warning' : r.type === 'success' ? 'success' : 'info', bordered: false }, { default: () => typeOptions.find((t) => t.value === r.type)?.label || r.type }),
  },
  {
    title: '级别', key: 'level', width: 76,
    render: (r) => h('span', { style: 'font-size:12px;color:var(--tg-text-2)' }, levelOptions.find((t) => t.value === r.level)?.label || r.level),
  },
  {
    title: '状态', key: 'active', width: 80,
    render: (r) => h(NTag, { size: 'small', type: r.active ? 'success' : 'default', bordered: false }, { default: () => (r.active ? '展示中' : '已隐藏') }),
  },
  { title: '发布时间', key: 'created_at', width: 140, render: (r) => fmtDate(r.created_at) },
  { title: '有效期', key: 'ends_at', width: 160, ellipsis: { tooltip: true }, render: (r) => (r.starts_at || r.ends_at) ? `${r.starts_at?.slice(0, 10) || '—'} ~ ${r.ends_at?.slice(0, 10) || '—'}` : '长期有效' },
  {
    title: '操作', key: 'actions', width: 120, fixed: 'right',
    render: (r) => h(NSpace, { size: 4, wrap: false }, {
      default: () => [
        h(NButton, { size: 'tiny', secondary: true, onClick: () => openEdit(r) }, { default: () => '编辑' }),
        h(NPopconfirm, { onPositiveClick: () => remove(r) }, {
          trigger: () => h(NButton, { size: 'tiny', quaternary: true, type: 'error' }, { default: () => '删除' }),
          default: () => '确定删除该公告？',
        }),
      ],
    }),
  },
];

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="公告管理" subtitle="发布全站公告与顶部跑马灯消息，支持定时展示" icon="tabler:speakerphone">
      <template #actions>
        <NButton size="small" quaternary @click="load">
          <template #icon><NIcon size="15"><Icon icon="tabler:refresh" /></NIcon></template>
          刷新
        </NButton>
        <NButton size="small" @click="showMarquee = true">
          <template #icon><NIcon size="15"><Icon icon="tabler:marquee" /></NIcon></template>
          跑马灯
        </NButton>
        <NButton type="primary" size="small" @click="openCreate">
          <template #icon><NIcon size="15"><Icon icon="tabler:plus" /></NIcon></template>
          发布公告
        </NButton>
      </template>
    </PageHeader>

    <div class="tg-card mb-3">
      <div class="px-4 py-3 border-b tg-divider flex items-center justify-between">
        <div class="tg-section-title">全站公告</div>
        <span class="text-xs tg-text-3">共 {{ list.length }} 条</span>
      </div>
      <NDataTable
        :columns="columns" :data="list" :loading="loading" :bordered="false" size="small"
        :row-key="(r) => r.id" :scroll-x="900"
        :max-height="420"
      />
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <!-- 跑马灯列表 -->
      <div class="tg-card">
        <div class="px-4 py-3 border-b tg-divider flex items-center justify-between">
          <div class="tg-section-title">
            <NIcon size="15" class="mr-1 align-[-3px]"><Icon icon="tabler:marquee" /></NIcon>
            滚动跑马灯
          </div>
          <NButton size="tiny" text type="primary" @click="showMarquee = true">添加</NButton>
        </div>
        <div class="p-3">
          <NEmpty v-if="!marquee.length" size="small" description="暂无跑马灯消息" />
          <div v-for="m in marquee" :key="m.id" class="marquee-row">
            <NIcon size="14" class="tg-text-3"><Icon icon="tabler:speakerphone" /></NIcon>
            <span class="flex-1 truncate text-[13px]">{{ m.text }}</span>
            <NTag size="small" :type="m.active ? 'success' : 'default'" :bordered="false">
              {{ m.active ? '启用' : '停用' }}
            </NTag>
            <NPopconfirm @positive-click="delMarquee(m.id)">
              <template #trigger>
                <NButton size="tiny" quaternary type="error">
                  <template #icon><NIcon size="13"><Icon icon="tabler:trash" /></NIcon></template>
                </NButton>
              </template>
              确定删除？
            </NPopconfirm>
          </div>
        </div>
      </div>

      <!-- 公告预览 -->
      <div class="tg-card p-4">
        <div class="tg-section-title mb-3">效果预览</div>
        <NAlert v-for="n in list.filter((x) => x.active).slice(0, 3)" :key="n.id"
          :type="n.type" :bordered="false" class="mb-2" :show-icon="true">
          <b>{{ n.title }}</b>
          <div class="text-xs mt-0.5 whitespace-pre-wrap">{{ n.content || '（无内容）' }}</div>
        </NAlert>
        <NEmpty v-if="!list.filter((x) => x.active).length" size="small" description="没有展示中的公告" />
        <NDivider class="!my-3" />
        <div class="text-xs tg-text-3">
          公告会在用户登录后显示在仪表盘顶部与「消息通知」页面；跑马灯显示在顶部导航下方。
        </div>
      </div>
    </div>

    <!-- 公告表单 -->
    <NModal v-model:show="showForm" preset="card" :title="editing ? '编辑公告' : '发布公告'" style="max-width: 560px" :bordered="false" size="small">
      <NForm label-placement="top">
        <NFormItem label="标题">
          <NInput v-model:value="form.title" placeholder="例如：平台维护通知" :maxlength="120" show-count />
        </NFormItem>
        <NFormItem label="内容">
          <NInput v-model:value="form.content" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" :maxlength="2000" show-count />
        </NFormItem>
        <div class="grid grid-cols-3 gap-3">
          <NFormItem label="类型">
            <NSelect v-model:value="form.type" :options="typeOptions" />
          </NFormItem>
          <NFormItem label="级别">
            <NSelect v-model:value="form.level" :options="levelOptions" />
          </NFormItem>
          <NFormItem label="展示对象">
            <NSelect v-model:value="form.target" :options="[{ label: '所有用户', value: 'all' }, { label: '新用户', value: 'new' }, { label: '管理员', value: 'admin' }]" />
          </NFormItem>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <NFormItem label="开始时间（选填）">
            <NInput v-model:value="form.starts_at" placeholder="YYYY-MM-DD HH:mm:ss" />
          </NFormItem>
          <NFormItem label="结束时间（选填）">
            <NInput v-model:value="form.ends_at" placeholder="留空表示长期有效" />
          </NFormItem>
        </div>
        <div class="flex items-center gap-6">
          <div class="flex items-center gap-2">
            <NSwitch v-model:value="form.active" size="small" />
            <span class="text-[13px]">立即展示</span>
          </div>
          <div class="flex items-center gap-2">
            <NSwitch v-model:value="form.pinned" size="small" />
            <span class="text-[13px]">置顶</span>
          </div>
        </div>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showForm = false">取消</NButton>
          <NButton size="small" type="primary" :loading="saving" @click="save">保存</NButton>
        </div>
      </template>
    </NModal>

    <!-- 跑马灯表单 -->
    <NModal v-model:show="showMarquee" preset="card" title="添加跑马灯" style="max-width: 420px" :bordered="false" size="small">
      <NForm label-placement="top">
        <NFormItem label="文字内容">
          <NInput v-model:value="marqueeForm.text" placeholder="例如：新用户注册即送 10GB 流量" :maxlength="300" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="showMarquee = false">取消</NButton>
          <NButton size="small" type="primary" @click="saveMarquee">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.marquee-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 0; border-bottom: 1px dashed var(--tg-border);
}
.marquee-row:last-child { border-bottom: none; }
</style>
