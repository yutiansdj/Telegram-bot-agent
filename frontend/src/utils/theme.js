import { computed } from 'vue';
import { useThemeStore } from '@/stores/theme';

/** Naive UI 主题定制：浅色为纯白企业风格，深色为中性石墨色 */
export function useThemeOverrides() {
  const theme = useThemeStore();
  return computed(() => {
    const dark = theme.dark;
    const surface = dark ? '#16181d' : '#ffffff';
    const text = dark ? '#e8eaee' : '#1a1d23';
    const text2 = dark ? '#a2a9b6' : '#5b6270';
    const border = dark ? '#24272e' : '#eceef2';
    return {
      common: {
        primaryColor: dark ? (theme.primaryDark || '#6b8ff8') : (theme.primaryLight || '#2450eb'),
        primaryColorHover: dark ? '#88a5fa' : '#1d3cd8',
        primaryColorPressed: dark ? '#5578e6' : '#1a35c0',
        primaryColorSuppl: dark ? (theme.primaryDark || '#6b8ff8') : (theme.primaryLight || '#2450eb'),
        infoColor: dark ? '#6b8ff8' : '#2450eb',
        successColor: dark ? '#4ade80' : '#16a34a',
        warningColor: dark ? '#fbbf24' : '#d97706',
        errorColor: dark ? '#f87171' : '#dc2626',
        textColorBase: text,
        textColor1: text,
        textColor2: text2,
        textColor3: dark ? '#6f7684' : '#8b919e',
        borderColor: border,
        dividerColor: border,
        bodyColor: surface,
        cardColor: surface,
        modalColor: surface,
        popoverColor: surface,
        tableColor: surface,
        tableHeaderColor: dark ? '#1b1e24' : '#fafbfc',
        inputColor: dark ? '#1b1e24' : '#ffffff',
        hoverColor: dark ? '#1e2229' : '#f5f7fa',
        borderRadius: (theme.radius || '7') + 'px',
        borderRadiusSmall: '5px',
        fontSize: '14px',
      },
      Card: { borderRadius: '10px', color: surface, borderColor: border },
      DataTable: {
        thColor: dark ? '#1b1e24' : '#fafbfc',
        thTextColor: text,
        thFontWeight: '600',
        tdColorHover: dark ? '#1e2229' : '#f8fafc',
        borderColor: border,
      },
      Layout: { color: dark ? '#0f1115' : '#f6f7f9', siderColor: surface },
      Menu: {
        itemTextColor: text2,
        itemTextColorActive: dark ? '#e8eaee' : '#111827',
        itemTextColorHover: text,
        itemColorActive: dark ? '#1e2534' : '#eef3ff',
        itemColorActiveHover: dark ? '#232b3d' : '#e5edff',
        itemColorHover: dark ? '#1b1f27' : '#f4f6fa',
        itemIconColor: dark ? '#8b919e' : '#6b7280',
        itemIconColorActive: dark ? '#88a5fa' : '#2450eb',
        itemIconColorHover: text,
        itemHeight: '40px',
        borderRadius: (theme.radius || '7') + 'px',
      },
      Tabs: { tabTextColorActiveLine: dark ? '#e8eaee' : '#111827', barColor: dark ? '#6b8ff8' : '#2450eb' },
      Tag: { borderRadius: '5px' },
      Button: { fontWeight: '500' },
      Input: { color: dark ? '#1b1e24' : '#ffffff' },
      Descriptions: { thColor: dark ? '#1b1e24' : '#fafbfc' },
      Dialog: { borderRadius: '12px' },
    };
  });
}
