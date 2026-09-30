import React from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { CoinovaLogoMark } from './GameIllustrations';

interface PWAInstallButtonProps {
  variant?: 'banner' | 'button';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = React.memo(
  ({ variant = 'button' }) => {
    const { isInstallable, isInstalled, install } = usePWAInstall();

    // Only render when the browser explicitly supports & allows installing COINOVA
    // and the app is not already installed / running in standalone mode.
    if (isInstalled || !isInstallable) {
      return null;
    }

    if (variant === 'banner') {
      return (
        <div className="shrink-0 border-b border-[#FFEA00]/30 bg-[#0D0C08]/95 px-3.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <CoinovaLogoMark className="h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-[11px] font-extrabold text-white">
                  Install Aplikasi COINOVA
                </p>
                <p className="truncate text-[10px] text-zinc-400">
                  Akses cepat langsung dari layar utama HP Anda
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void install();
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-3 py-1.5 text-[10.5px] font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_14px_rgba(255,234,0,0.32)] transition active:scale-95"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-3.5 w-3.5 shrink-0"
              >
                <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
              </svg>
              <span>Install COINOVA</span>
            </button>
          </div>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => {
          void install();
        }}
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-[#FFEA00]/55 bg-[#12110B] py-3 text-xs font-black uppercase tracking-wider text-[#FFEA00] shadow-[0_0_16px_rgba(255,234,0,0.18)] transition hover:bg-[#FFEA00]/15 active:scale-[0.99]"
      >
        <CoinovaLogoMark className="h-4 w-4 shrink-0" />
        <span>INSTALL COINOVA</span>
      </button>
    );
  }
);
