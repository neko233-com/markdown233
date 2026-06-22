import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ptBR from './locales/pt-BR.json';
import ru from './locales/ru.json';
import ar from './locales/ar.json';
import hi from './locales/hi.json';

export type Locale =
  | 'zh-CN'
  | 'zh-TW'
  | 'en'
  | 'ja'
  | 'ko'
  | 'es'
  | 'fr'
  | 'de'
  | 'pt-BR'
  | 'ru'
  | 'ar'
  | 'hi';

export type Messages = Record<string, string>;

export const localeOptions: Array<{ id: Locale; label: string }> = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'ru', label: 'Русский' },
  { id: 'ar', label: 'العربية' },
  { id: 'hi', label: 'हिन्दी' },
];

const localeFiles: Record<Locale, Messages> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  en,
  ja,
  ko,
  es,
  fr,
  de,
  'pt-BR': ptBR,
  ru,
  ar,
  hi,
};

const aliases: Record<string, Locale> = {
  zh: 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-sg': 'zh-CN',
  'zh-hant': 'zh-TW',
  'zh-tw': 'zh-TW',
  'zh-hk': 'zh-TW',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  es: 'es',
  fr: 'fr',
  de: 'de',
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  ru: 'ru',
  ar: 'ar',
  hi: 'hi',
};

const languageKey = 'appLanguage';
const overrideKey = 'localeOverrides';

let activeLocale: Locale = detectLocale();
let userOverrides = readUserOverrides();

export function getLocale() {
  return activeLocale;
}

export function setLocale(locale: Locale | 'system') {
  if (locale === 'system') {
    localStorage.removeItem(languageKey);
    activeLocale = detectLocale();
  } else {
    localStorage.setItem(languageKey, locale);
    activeLocale = locale;
  }
  applyStaticI18n();
}

export function detectLocale(): Locale {
  const preferred = [localStorage.getItem(languageKey) || '', ...navigator.languages, navigator.language];
  for (const raw of preferred) {
    const lower = raw.toLowerCase();
    if (aliases[lower]) return aliases[lower];
    const base = lower.split('-')[0];
    if (aliases[base]) return aliases[base];
  }
  return 'en';
}

export function currentLanguageSetting() {
  return localStorage.getItem(languageKey) || 'system';
}

export function builtinMessages(locale = activeLocale): Messages {
  return {
    ...zhCN,
    ...en,
    ...localeFiles[locale],
  };
}

export function exportBuiltinLocale(locale = activeLocale) {
  return JSON.stringify(builtinMessages(locale), null, 2);
}

export function loadUserLocaleOverrides() {
  return JSON.stringify(userOverrides, null, 2);
}

export function saveUserLocaleOverrides(raw: string) {
  const parsed = raw.trim() ? JSON.parse(raw) as Messages : {};
  userOverrides = parsed;
  localStorage.setItem(overrideKey, JSON.stringify(parsed));
  applyStaticI18n();
}

export function resetUserLocaleOverrides() {
  userOverrides = {};
  localStorage.removeItem(overrideKey);
  applyStaticI18n();
}

export function t(key: string, params: Record<string, string | number> = {}) {
  const dictionary = {
    ...builtinMessages(activeLocale),
    ...userOverrides,
  };
  const template = dictionary[key] || key;
  return Object.entries(params).reduce(
    (value, [name, replacement]) => value.split(`{${name}}`).join(String(replacement)),
    template,
  );
}

export function applyStaticI18n() {
  document.documentElement.lang = activeLocale;
  document.documentElement.dir = activeLocale === 'ar' ? 'rtl' : 'ltr';
  document.title = t('appTitle');

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n || '');
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle || '');
  });

  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder || '');
  });
}

function readUserOverrides(): Messages {
  try {
    const saved = localStorage.getItem(overrideKey);
    return saved ? JSON.parse(saved) as Messages : {};
  } catch (error) {
    console.warn('Invalid locale overrides:', error);
    return {};
  }
}
