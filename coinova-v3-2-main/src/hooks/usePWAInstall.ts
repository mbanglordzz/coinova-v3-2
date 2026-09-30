import { useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Capture `beforeinstallprompt` at module evaluation time so early events fired
// by Chrome Android before React finishes mounting are never missed.
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
let globalIsInstalled = false;
const listeners = new Set<() => void>();

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    document.referrer.includes('android-app://')
  );
}

function notifyListeners(): void {
  listeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  globalIsInstalled = checkIsStandalone();

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    globalIsInstalled = checkIsStandalone();
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    globalIsInstalled = true;
    globalDeferredPrompt = null;
    notifyListeners();
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(() => globalDeferredPrompt);
  const [isInstalled, setIsInstalled] = useState<boolean>(() =>
    checkIsStandalone()
  );

  useEffect(() => {
    const syncState = () => {
      const standalone = checkIsStandalone();
      globalIsInstalled = standalone;
      setIsInstalled(standalone);
      setDeferredPrompt(standalone ? null : globalDeferredPrompt);
    };

    syncState();
    listeners.add(syncState);

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleMediaChange = () => syncState();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaChange);
    }

    return () => {
      listeners.delete(syncState);
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleMediaChange);
      }
    };
  }, []);

  const install = async (): Promise<boolean> => {
    const activePrompt = globalDeferredPrompt || deferredPrompt;
    if (!activePrompt) return false;
    try {
      await activePrompt.prompt();
      const { outcome } = await activePrompt.userChoice;
      if (outcome === 'accepted') {
        globalIsInstalled = true;
        globalDeferredPrompt = null;
        notifyListeners();
        return true;
      }
    } catch {
      // Ignore user cancellation or prompt error
    }
    return false;
  };

  return {
    isInstallable: !isInstalled && Boolean(deferredPrompt),
    isInstalled,
    install,
  };
}
