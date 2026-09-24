/** ホーム画面から起動したアプリ（PWA）か */
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export interface StorageInfo { persisted: boolean | null; usageMB: number | null; quotaMB: number | null }

export async function storageInfo(): Promise<StorageInfo> {
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => null) : null;
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  return { persisted, usageMB: est?.usage != null ? est.usage / 1e6 : null, quotaMB: est?.quota != null ? est.quota / 1e6 : null };
}
