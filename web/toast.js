import { $ } from './app.js';
import { t } from './i18n.js';

let toastTimer;

export function showToast(key, value = '') {
  const toast = $('command-toast');
  clearTimeout(toastTimer);
  toast.textContent = t(key).replace(/%[ds]/, () => String(value));
  toastTimer = setTimeout(() => { toast.textContent = ''; }, 1800);
}
