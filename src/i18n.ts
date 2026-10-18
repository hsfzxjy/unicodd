import { computed, ref } from 'vue';
import { englishMessages, type MessageKey } from './locales/en';
import { chineseMessages } from './locales/zh-CN';

export const supportedLocales = ['en', 'zh-CN'] as const;

export type AppLocale = (typeof supportedLocales)[number];
export type TranslationParams = Readonly<Record<string, string | number>>;
export type { MessageKey } from './locales/en';

function detectLocale(): AppLocale {
  if (typeof window === 'undefined') return 'en';
  const saved = window.localStorage.getItem('unicodd.locale');
  if (saved === 'en' || saved === 'zh-CN') return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

const locale = ref<AppLocale>(detectLocale());

export function translate(
  key: MessageKey,
  params: TranslationParams = {},
  targetLocale: AppLocale = locale.value,
): string {
  const template = targetLocale === 'zh-CN' ? chineseMessages[key] : englishMessages[key];
  return template.replace(/\{([A-Za-z]+)\}/g, (_, name: string) => String(params[name] ?? ''));
}

export function errorStatusSuffix(error: string | null, targetLocale: AppLocale): string {
  const status = error?.match(/\((\d{3})\)/)?.[1];
  if (!status) return '';
  return targetLocale === 'zh-CN' ? `（状态 ${status}）` : ` (status ${status})`;
}

export function setLocale(nextLocale: AppLocale): void {
  locale.value = nextLocale;
  if (typeof document !== 'undefined') document.documentElement.lang = nextLocale;
  if (typeof window !== 'undefined') window.localStorage.setItem('unicodd.locale', nextLocale);
}

export function useI18n() {
  return {
    locale,
    localeLabel: computed(() => (locale.value === 'zh-CN' ? '简体中文' : 'English')),
    setLocale,
    t: (key: MessageKey, params?: TranslationParams) => translate(key, params),
  };
}

if (typeof document !== 'undefined') document.documentElement.lang = locale.value;
