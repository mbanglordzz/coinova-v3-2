import React, { useEffect, useRef, useState } from 'react';
import {
  DragonLevelConfig,
  EWalletMethod,
  GameSettings,
  UserAccount,
  UserProfile,
  UserWallet,
  WalletTransaction,
  WithdrawalRecord,
} from '../types/dragon';
import { getLevelEconomy } from '../config/economy';
import {
  CoinovaAvatarSvg,
  CoinovaLogoMark,
  NovaCoinIcon,
  NovaDiamondIcon,
  TelegramChannelIcon,
  VerifiedBlueBadge,
} from './GameIllustrations';
import { CloseIcon, UploadNeonIcon } from './DragonIcons';
import { AiUgcAffiliateModal } from './AiUgcAffiliateModal';
import { maskWithdrawalAccountNumber } from './WithdrawView';
import {
  CoinovaVipModal,
  formatIndoDate,
  ServerFeatureStatusData,
} from './CoinovaEventsAndVipModals';

export interface BugReportItem {
  reportId: string;
  uid: string;
  username: string;
  description: string;
  featureArea: string;
  appVersion: string;
  hasScreenshot: boolean;
  screenshotFileName: string;
  screenshotDataUrl?: string;
  status: 'RECEIVED' | 'RESOLVED';
  reportedAt: string;
}

interface ProfileViewProps {
  user: UserAccount;
  wallet: UserWallet;
  profile: UserProfile;
  levels: DragonLevelConfig[];
  settings: GameSettings;
  transactions: WalletTransaction[];
  withdrawals: WithdrawalRecord[];
  isSandboxMode: boolean;
  onSaveProfile: (
    username: string,
    updates: {
      fullName: string;
      phone: string;
      defaultEwallet: EWalletMethod;
      ewalletNumber: string;
      ewalletAccountName: string;
      pinHash: string;
      notificationsEnabled: boolean;
    }
  ) => Promise<void>;
  onRedeemCode: (code: string) => Promise<void>;
  onConvertCoinToFire: (fireToObtain: number) => Promise<void>;
  onSubmitBugReport?: (report: BugReportItem) => void;
  onNavigateWithdraw: () => void;
  onNavigateTask?: () => void;
  onNavigateHome?: () => void;
  onOpenUpgrade: () => void;
  onSignOut: () => Promise<void>;
  onSwitchToCloudAuth: () => Promise<void>;
  onDeductCoinsForUgc?: (newCoinBalance: number, costCoins: number) => void;
  busyAction: string | null;
}

const EWALLET_METHODS: EWalletMethod[] = ['DANA', 'GoPay', 'OVO', 'ShopeePay'];
const BUG_STORAGE_KEY = 'coinova_bug_reports_v1';
const APP_VERSION_STRING = 'COINOVA OS v2.4.0';
const TELEGRAM_OFFICIAL_CHANNEL_URL = 'https://t.me/CoinovaOfficiall';

function compressBugImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () =>
        reject(
          new Error('Format gambar tidak didukung. Gunakan JPG, JPEG, PNG, atau WEBP.')
        );
      img.onload = () => {
        const maxDim = 800;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  wallet,
  profile,
  levels,
  settings,
  transactions,
  withdrawals,
  onSaveProfile,
  onSubmitBugReport,
  onNavigateHome,
  onOpenUpgrade,
  onSignOut,
  onDeductCoinsForUgc,
  busyAction,
}: ProfileViewProps) => {
  const [subScreen, setSubScreen] = useState<'MAIN' | 'SETTINGS' | 'BUG_REPORT'>(
    'MAIN'
  );

  // Modals on Profile Page
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [historyTab, setHistoryTab] = useState<'WITHDRAW' | 'CONVERT'>('WITHDRAW');
  const [showUgcModal, setShowUgcModal] = useState<boolean>(false);
  const [showVipModal, setShowVipModal] = useState<boolean>(false);
  const [featureStatus, setFeatureStatus] =
    useState<ServerFeatureStatusData | null>(null);
  const [activeQrisImageUrl, setActiveQrisImageUrl] = useState<string | null>(
    null
  );
  const [isLoadingQris, setIsLoadingQris] = useState<boolean>(false);

  const fetchFeatureStatus = React.useCallback(async () => {
    if (!user.uid) return;
    try {
      const res = await fetch(
        `/api/game/features-status/${encodeURIComponent(user.uid)}?t=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok) {
        setFeatureStatus(data);
      }
    } catch {
      // ignore
    }
  }, [user.uid]);

  const fetchActiveQris = React.useCallback(async () => {
    setIsLoadingQris(true);
    try {
      const res = await fetch(`/api/qris?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setActiveQrisImageUrl(
        data?.qris?.hasQris && data?.qris?.imageDataUrl
          ? String(data.qris.imageDataUrl)
          : null
      );
    } catch {
      // ignore
    } finally {
      setIsLoadingQris(false);
    }
  }, []);

  useEffect(() => {
    void fetchFeatureStatus();
  }, [fetchFeatureStatus]);

  useEffect(() => {
    if (showVipModal) {
      void fetchActiveQris();
      void fetchFeatureStatus();
    }
  }, [showVipModal, fetchActiveQris, fetchFeatureStatus]);

  // Settings Form & Toggles
  const [editUsername, setEditUsername] = useState<string>(user.username);
  const [editFullName, setEditFullName] = useState<string>(
    profile.fullName || user.username || ''
  );
  const [editPhone, setEditPhone] = useState<string>(
    profile.phone || ''
  );
  const [editEwallet, setEditEwallet] = useState<EWalletMethod>(
    profile.defaultEwallet || 'DANA'
  );
  const [editEwalletNumber, setEditEwalletNumber] = useState<string>(
    profile.ewalletNumber || ''
  );
  const [editEwalletName, setEditEwalletName] = useState<string>(
    profile.ewalletAccountName || user.username || ''
  );
  const [editPin, setEditPin] = useState<string>(profile.pinHash || '');
  const [settingsSavedMsg, setSettingsSavedMsg] = useState<string | null>(null);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [musicEnabled, setMusicEnabled] = useState<boolean>(true);
  const [vibrationEnabled, setVibrationEnabled] = useState<boolean>(false);
  const [pushNotifEnabled, setPushNotifEnabled] = useState<boolean>(
    profile.notificationsEnabled ?? true
  );
  const [promoNotifEnabled, setPromoNotifEnabled] = useState<boolean>(true);
  const [cacheSizeText, setCacheSizeText] = useState<string>('12.4 MB');

  // Bug Report State
  const [bugDescription, setBugDescription] = useState<string>('');
  const [bugFeatureArea, setBugFeatureArea] = useState<string>(
    'Profile / Sistem COINOVA'
  );
  const [bugScreenshotUrl, setBugScreenshotUrl] = useState<string>('');
  const [bugScreenshotName, setBugScreenshotName] = useState<string>('');
  const [bugReportTime, setBugReportTime] = useState<string>(() =>
    new Date().toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  );
  const [bugSubmitting, setBugSubmitting] = useState<boolean>(false);
  const [bugFeedback, setBugFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [bugReportsHistory, setBugReportsHistory] = useState<BugReportItem[]>(() => {
    try {
      const raw = localStorage.getItem(`${BUG_STORAGE_KEY}_${user.uid}`);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const bugFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setEditUsername(user.username);
    setEditFullName(profile.fullName || user.username || '');
    setEditPhone(profile.phone || '');
    setEditEwallet(profile.defaultEwallet || 'DANA');
    setEditEwalletNumber(profile.ewalletNumber || '');
    setEditEwalletName(profile.ewalletAccountName || user.username || '');
  }, [
    user.username,
    profile.fullName,
    profile.phone,
    profile.defaultEwallet,
    profile.ewalletNumber,
    profile.ewalletAccountName,
  ]);

  const currentLevelCfg = levels.find((l) => l.level === user.dragonLevel);
  const levelEconomy = getLevelEconomy(
    user.dragonLevel,
    currentLevelCfg,
    settings
  );

  const formatDateShort = (iso: string) => {
    try {
      const d = new Date(iso);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    } catch {
      return '27/09/2026';
    }
  };

  const handleSaveSettingsForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSavedMsg(null);
    await onSaveProfile(editUsername.trim() || user.username, {
      fullName: editFullName.trim(),
      phone: editPhone.trim(),
      defaultEwallet: editEwallet,
      ewalletNumber: editEwalletNumber.trim(),
      ewalletAccountName: editEwalletName.trim(),
      pinHash: editPin.trim(),
      notificationsEnabled: pushNotifEnabled,
    });
    setSettingsSavedMsg('Pengaturan profil & keamanan berhasil disimpan.');
  };

  const handleSelectBugImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setBugFeedback(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedMime = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ];
    if (
      !file.type.startsWith('image/') &&
      !allowedMime.includes(file.type.toLowerCase())
    ) {
      setBugFeedback({
        type: 'error',
        text: 'Format gambar tidak didukung. Gunakan file JPG, JPEG, PNG, atau WEBP.',
      });
      return;
    }

    try {
      const compressed = await compressBugImageToDataUrl(file);
      setBugScreenshotUrl(compressed);
      setBugScreenshotName(file.name);
    } catch (err) {
      setBugFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal memproses screenshot bug.',
      });
    } finally {
      if (bugFileInputRef.current) {
        bugFileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveBugImage = () => {
    setBugScreenshotUrl('');
    setBugScreenshotName('');
    if (bugFileInputRef.current) {
      bugFileInputRef.current.value = '';
    }
  };

  const handleSubmitBugForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bugSubmitting) return;
    setBugFeedback(null);

    const cleanDesc = bugDescription.trim();
    if (cleanDesc.length < 5) {
      setBugFeedback({
        type: 'error',
        text: 'Mohon ceritakan bug yang kamu alami (minimal 5 karakter).',
      });
      return;
    }

    setBugSubmitting(true);
    const nowIso = new Date().toISOString();

    try {
      let savedRecord: BugReportItem | null = null;

      try {
        const resp = await fetch('/api/game/bug-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: user.uid,
            username: user.username,
            description: cleanDesc,
            featureArea: bugFeatureArea,
            appVersion: APP_VERSION_STRING,
            screenshotDataUrl: bugScreenshotUrl,
            screenshotFileName: bugScreenshotName,
            reportedAt: nowIso,
          }),
        });
        const data = await resp.json();
        if (!resp.ok || !data?.ok) {
          throw new Error(data?.error || 'Gagal mengirim laporan bug ke server.');
        }
        savedRecord = data.report as BugReportItem;
      } catch {
        // Fallback to local persistence if offline so user data is never lost
        savedRecord = {
          reportId: `BUG-${Date.now().toString().slice(-6)}`,
          uid: user.uid,
          username: user.username,
          description: cleanDesc,
          featureArea: bugFeatureArea,
          appVersion: APP_VERSION_STRING,
          hasScreenshot: Boolean(bugScreenshotUrl),
          screenshotFileName: bugScreenshotName,
          screenshotDataUrl: bugScreenshotUrl,
          status: 'RECEIVED',
          reportedAt: nowIso,
        };
      }

      const nextList = [savedRecord, ...bugReportsHistory].slice(0, 20);
      setBugReportsHistory(nextList);
      try {
        localStorage.setItem(
          `${BUG_STORAGE_KEY}_${user.uid}`,
          JSON.stringify(nextList)
        );
      } catch {
        // ignore storage quota
      }

      onSubmitBugReport?.(savedRecord);

      // Reset form after successful submission
      setBugDescription('');
      setBugScreenshotUrl('');
      setBugScreenshotName('');
      setBugReportTime(
        new Date().toLocaleString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      );

      setBugFeedback({
        type: 'success',
        text: `Laporan Bug #${savedRecord.reportId} berhasil dikirim! Terima kasih atas masukanmu.`,
      });
    } catch (err) {
      setBugFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal mengirim laporan bug. Silakan coba lagi.',
      });
    } finally {
      setBugSubmitting(false);
    }
  };

  const myWithdrawals = withdrawals.filter((w) => w.uid === user.uid);
  const myConversions = transactions.filter(
    (t) => t.uid === user.uid && t.category === 'KONVERSI'
  );

  // ============================================================================
  // SUB-SCREEN 1: LAPORKAN BUG COINOVA
  // ============================================================================
  if (subScreen === 'BUG_REPORT') {
    return (
      <div className="coinova-hud-bg min-h-full w-full px-3.5 pt-3 pb-28 text-white select-none">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setSubScreen('MAIN')}
              aria-label="Kembali ke Profil"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#FFEA00]/45 bg-[#12110B] text-[#FFEA00] shadow active:scale-95"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                <path
                  d="M15 19l-7-7 7-7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-[#FACC15]">
                COINOVA SUPPORT
              </span>
              <h1 className="text-lg font-extrabold text-white">
                🐛 Laporkan Bug
              </h1>
            </div>
          </div>

          {/* Right Currency Pills */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 rounded-full border border-cyan-400/30 bg-[#0B0C10] px-2.5 py-1">
              <NovaDiamondIcon className="h-3.5 w-3.5" />
              <span className="font-mono-num text-xs font-extrabold text-cyan-300">
                {wallet.fireBalance.toLocaleString('id-ID')}
              </span>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-[#FACC15]/35 bg-[#0B0C10] px-2.5 py-1">
              <NovaCoinIcon className="h-3.5 w-3.5" />
              <span className="font-mono-num text-xs font-extrabold text-[#FACC15]">
                {wallet.coinBalance.toLocaleString('id-ID')}
              </span>
            </div>
          </div>
        </div>

        {/* Automatic System Diagnostics Info Card (Read-Only) */}
        <div className="coinova-card-glow mt-3.5 rounded-[22px] p-3.5">
          <div className="flex items-center justify-between border-b border-[#FACC15]/20 pb-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#FFEA00]">
              ⚡ Informasi Sistem Otomatis
            </span>
            <span className="rounded-full border border-[#FFEA00]/45 bg-[#FFEA00]/15 px-2 py-0.5 text-[9.5px] font-bold text-[#FFEA00]">
              Terdeteksi
            </span>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-[#FACC15]/20 bg-[#0B0B0F] px-2.5 py-2">
              <span className="block text-[9.5px] font-semibold uppercase text-zinc-400">
                User ID
              </span>
              <span className="font-mono-num mt-0.5 block truncate text-[11px] font-extrabold text-white">
                {user.uid} ({user.referralCode || 'F11B4A'})
              </span>
            </div>

            <div className="rounded-xl border border-[#FACC15]/20 bg-[#0B0B0F] px-2.5 py-2">
              <span className="block text-[9.5px] font-semibold uppercase text-zinc-400">
                Waktu Laporan
              </span>
              <span className="font-mono-num mt-0.5 block truncate text-[11px] font-extrabold text-[#FACC15]">
                {bugReportTime}
              </span>
            </div>

            <div className="rounded-xl border border-[#FACC15]/20 bg-[#0B0B0F] px-2.5 py-2">
              <span className="block text-[9.5px] font-semibold uppercase text-zinc-400">
                Halaman / Fitur
              </span>
              <span className="mt-0.5 block truncate text-[11px] font-extrabold text-[#FDE047]">
                {bugFeatureArea}
              </span>
            </div>

            <div className="rounded-xl border border-[#FACC15]/20 bg-[#0B0B0F] px-2.5 py-2">
              <span className="block text-[9.5px] font-semibold uppercase text-zinc-400">
                Versi Aplikasi
              </span>
              <span className="font-mono-num mt-0.5 block truncate text-[11px] font-extrabold text-[#FFEA00]">
                {APP_VERSION_STRING}
              </span>
            </div>
          </div>
        </div>

        {/* Main Bug Report Form */}
        <form
          onSubmit={handleSubmitBugForm}
          className="coinova-card mt-3.5 space-y-3.5 rounded-[22px] p-4"
        >
          {/* Area / Fitur Selector */}
          <div>
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#FACC15]">
              Pilih Area / Fitur Terkait
            </label>
            <select
              value={bugFeatureArea}
              onChange={(e) => setBugFeatureArea(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-[#FACC15]/30 bg-[#09090C] px-3.5 py-2.5 text-xs font-bold text-white outline-none focus:border-[#FFEA00]"
            >
              <option value="Profile / Sistem COINOVA" className="bg-[#09090C]">
                Profile / Sistem COINOVA
              </option>
              <option value="Home / Tap Koin & Core Energy" className="bg-[#09090C]">
                Home / Tap Koin &amp; Core Energy
              </option>
              <option value="Naikkan Level & Pembayaran QRIS" className="bg-[#09090C]">
                Naikkan Level &amp; Pembayaran QRIS
              </option>
              <option value="Task & Check-In Harian" className="bg-[#09090C]">
                Task &amp; Check-In Harian
              </option>
              <option value="Invite & Jaringan Referral" className="bg-[#09090C]">
                Invite &amp; Jaringan Referral
              </option>
              <option value="Withdraw & Konversi Diamond" className="bg-[#09090C]">
                Withdraw &amp; Konversi Diamond
              </option>
            </select>
          </div>

          {/* A. Upload Screenshot / Gambar */}
          <div>
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#FACC15]">
              Upload Screenshot / Gambar (Opsional)
            </label>
            <p className="mt-0.5 text-[10.5px] text-zinc-400">
              Format didukung: JPG, JPEG, PNG, WEBP
            </p>

            <input
              ref={bugFileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={handleSelectBugImage}
              className="hidden"
            />

            {!bugScreenshotUrl ? (
              <button
                type="button"
                onClick={() => bugFileInputRef.current?.click()}
                className="mt-2 flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[#FFEA00]/50 bg-[#09090C]/90 px-4 py-4 text-center transition hover:border-[#FFEA00] active:scale-[0.99]"
              >
                <UploadNeonIcon className="h-6 w-6 text-[#FFEA00]" />
                <span className="text-xs font-extrabold text-[#FFEA00]">
                  Pilih Screenshot dari Perangkat
                </span>
                <span className="text-[10px] text-zinc-400">
                  Klik untuk unggah bukti tampilan bug (JPG / PNG / WEBP)
                </span>
              </button>
            ) : (
              <div className="mt-2 rounded-2xl border border-[#FFEA00]/45 bg-[#09090C] p-3">
                <div className="relative overflow-hidden rounded-xl border border-[#FACC15]/25 bg-black/40">
                  <img
                    src={bugScreenshotUrl}
                    alt="Preview Screenshot Bug"
                    className="mx-auto max-h-48 w-full object-contain"
                  />
                </div>
                <p className="mt-2 truncate text-center text-[11px] font-bold text-[#FACC15]">
                  📎 {bugScreenshotName || 'screenshot_bug.jpg'}
                </p>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => bugFileInputRef.current?.click()}
                    className="rounded-xl border border-[#FFEA00]/45 bg-[#18160C] py-2 text-xs font-extrabold text-[#FFEA00] active:scale-95"
                  >
                    Ganti Gambar
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveBugImage}
                    className="rounded-xl border border-red-400/40 bg-red-500/15 py-2 text-xs font-extrabold text-red-300 active:scale-95"
                  >
                    Hapus Gambar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* B. Deskripsi Bug */}
          <div>
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-[#FACC15]">
              Deskripsi Bug
            </label>
            <textarea
              rows={4}
              value={bugDescription}
              onChange={(e) => setBugDescription(e.target.value)}
              placeholder="Ceritakan bug yang kamu alami..."
              className="mt-1.5 w-full resize-none rounded-2xl border border-[#FACC15]/30 bg-[#09090C] p-3.5 text-xs font-semibold leading-relaxed text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
            />
          </div>

          {bugFeedback && (
            <div
              className={`rounded-xl border px-3.5 py-2.5 text-xs font-extrabold ${
                bugFeedback.type === 'success'
                  ? 'border-[#FFEA00]/50 bg-[#FFEA00]/15 text-[#FFEA00]'
                  : 'border-red-400/50 bg-red-500/15 text-red-300'
              }`}
            >
              {bugFeedback.text}
            </div>
          )}

          {/* D. Tombol KIRIM LAPORAN BUG */}
          <button
            type="submit"
            disabled={bugSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-3 text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(255,234,0,0.35)] transition active:scale-[0.99]"
          >
            <span>🐛</span>
            <span>
              {bugSubmitting ? 'MENGIRIM LAPORAN...' : 'KIRIM LAPORAN BUG'}
            </span>
          </button>
        </form>

        {/* Riwayat Laporan Bug User */}
        {bugReportsHistory.length > 0 && (
          <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px]">
            <div className="flex items-center justify-between border-b border-[#FACC15]/20 bg-[#12110B] px-4 py-2.5">
              <span className="text-xs font-extrabold uppercase tracking-wider text-white">
                Riwayat Laporan Bug Saya
              </span>
              <span className="font-mono-num text-[11px] font-bold text-[#FFEA00]">
                {bugReportsHistory.length} Laporan
              </span>
            </div>
            <div className="space-y-2 p-3.5">
              {bugReportsHistory.map((item) => (
                <div
                  key={item.reportId}
                  className="rounded-xl border border-[#FACC15]/20 bg-[#0B0B0F] p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-num font-extrabold text-[#FFEA00]">
                      #{item.reportId}
                    </span>
                    <span className="rounded-full border border-[#FFEA00]/45 bg-[#FFEA00]/15 px-2.5 py-0.5 text-[10px] font-extrabold text-[#FFEA00]">
                      Diterima
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] font-bold text-[#FDE047]">
                    {item.featureArea}
                  </p>
                  <p className="mt-1 text-zinc-200">{item.description}</p>
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-400">
                    <span>{formatDateShort(item.reportedAt)}</span>
                    {item.hasScreenshot && <span>📎 Screenshot Terlampir</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // SUB-SCREEN 2: PENGATURAN COINOVA
  // ============================================================================
  if (subScreen === 'SETTINGS') {
    return (
      <div className="coinova-hud-bg min-h-full w-full px-3.5 pt-3 pb-24 text-white select-none">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setSubScreen('MAIN')}
              aria-label="Kembali ke Profil"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#FFEA00]/45 bg-[#12110B] text-[#FFEA00] shadow active:scale-95"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                <path
                  d="M15 19l-7-7 7-7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-[#FACC15]">
                COINOVA SYSTEM
              </span>
              <h1 className="text-lg font-extrabold text-white">Pengaturan</h1>
            </div>
          </div>

          {/* Right Currency Pills */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 rounded-full border border-cyan-400/30 bg-[#0B0C10] px-2.5 py-1">
              <NovaDiamondIcon className="h-3.5 w-3.5" />
              <span className="font-mono-num text-xs font-extrabold text-cyan-300">
                {wallet.fireBalance.toLocaleString('id-ID')}
              </span>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-[#FACC15]/35 bg-[#0B0C10] px-2.5 py-1">
              <NovaCoinIcon className="h-3.5 w-3.5" />
              <span className="font-mono-num text-xs font-extrabold text-[#FACC15]">
                {wallet.coinBalance.toLocaleString('id-ID')}
              </span>
            </div>
          </div>
        </div>

        {/* Section 1: AKUN, E-WALLET & KEAMANAN */}
        <form onSubmit={handleSaveSettingsForm} className="mt-4">
          <p className="px-1 text-[11px] font-extrabold uppercase tracking-wider text-[#FACC15]">
            AKUN, E-WALLET &amp; KEAMANAN
          </p>
          <div className="coinova-card mt-1.5 space-y-3 rounded-[20px] p-4">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10.5px] font-bold text-zinc-300">
                  Username
                </label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#FACC15]/25 bg-[#09090C] px-3 py-2 text-xs font-bold text-white outline-none focus:border-[#FFEA00]"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-zinc-300">
                  No. Telepon
                </label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="font-mono-num mt-1 w-full rounded-xl border border-[#FACC15]/25 bg-[#09090C] px-3 py-2 text-xs font-bold text-white outline-none focus:border-[#FFEA00]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10.5px] font-bold text-zinc-300">
                  E-Wallet Utama
                </label>
                <select
                  value={editEwallet}
                  onChange={(e) =>
                    setEditEwallet(e.target.value as EWalletMethod)
                  }
                  className="mt-1 w-full rounded-xl border border-[#FACC15]/25 bg-[#09090C] px-3 py-2 text-xs font-bold text-white outline-none focus:border-[#FFEA00]"
                >
                  {EWALLET_METHODS.map((m) => (
                    <option key={m} value={m} className="bg-[#09090C]">
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-zinc-300">
                  Nomor E-Wallet
                </label>
                <input
                  type="text"
                  value={editEwalletNumber}
                  onChange={(e) => setEditEwalletNumber(e.target.value)}
                  className="font-mono-num mt-1 w-full rounded-xl border border-[#FACC15]/25 bg-[#09090C] px-3 py-2 text-xs font-bold text-white outline-none focus:border-[#FFEA00]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[10.5px] font-bold text-zinc-300">
                  Nama Pemilik E-Wallet
                </label>
                <input
                  type="text"
                  value={editEwalletName}
                  onChange={(e) => setEditEwalletName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[#FACC15]/25 bg-[#09090C] px-3 py-2 text-xs font-bold text-white outline-none focus:border-[#FFEA00]"
                />
              </div>
              <div>
                <label className="block text-[10.5px] font-bold text-zinc-300">
                  PIN Keamanan (Opsional)
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={editPin}
                  onChange={(e) => setEditPin(e.target.value)}
                  placeholder="6 digit PIN"
                  className="mt-1 w-full rounded-xl border border-[#FACC15]/25 bg-[#09090C] px-3 py-2 text-xs font-bold text-white outline-none focus:border-[#FFEA00]"
                />
              </div>
            </div>

            {settingsSavedMsg && (
              <p className="text-xs font-bold text-[#FFEA00]">
                {settingsSavedMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={busyAction === 'profile'}
              className="w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-2.5 text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_14px_rgba(255,234,0,0.28)]"
            >
              {busyAction === 'profile'
                ? 'Menyimpan...'
                : 'Simpan Profil & Keamanan'}
            </button>
          </div>
        </form>

        {/* Section 2: SUARA & EFEK */}
        <div className="mt-4">
          <p className="px-1 text-[11px] font-extrabold uppercase tracking-wider text-[#FACC15]">
            SUARA &amp; EFEK
          </p>
          <div className="coinova-card mt-1.5 divide-y divide-white/10 overflow-hidden rounded-[20px]">
            {/* Efek Suara */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#FACC15]/25 bg-[#12110B] text-sm">
                  🔊
                </span>
                <span className="text-xs font-extrabold">Efek Suara</span>
              </div>
              <button
                type="button"
                onClick={() => setSoundEnabled((v) => !v)}
                className={`relative h-6 w-11 rounded-full transition ${
                  soundEnabled ? 'bg-[#FFEA00]' : 'bg-[#141418]'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#08080A] shadow transition-all ${
                    soundEnabled ? 'left-5.5' : 'left-0.5 bg-white/70'
                  }`}
                />
              </button>
            </div>

            {/* Musik Latar */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#FACC15]/25 bg-[#12110B] text-sm">
                  🎵
                </span>
                <span className="text-xs font-extrabold">Musik Latar</span>
              </div>
              <button
                type="button"
                onClick={() => setMusicEnabled((v) => !v)}
                className={`relative h-6 w-11 rounded-full transition ${
                  musicEnabled ? 'bg-[#FFEA00]' : 'bg-[#141418]'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#08080A] shadow transition-all ${
                    musicEnabled ? 'left-5.5' : 'left-0.5 bg-white/70'
                  }`}
                />
              </button>
            </div>

            {/* Getaran */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#FACC15]/25 bg-[#12110B] text-sm">
                  📳
                </span>
                <span className="text-xs font-extrabold">Getaran Haptic</span>
              </div>
              <button
                type="button"
                onClick={() => setVibrationEnabled((v) => !v)}
                className={`relative h-6 w-11 rounded-full transition ${
                  vibrationEnabled ? 'bg-[#FFEA00]' : 'bg-[#141418]'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#08080A] shadow transition-all ${
                    vibrationEnabled ? 'left-5.5' : 'left-0.5 bg-white/70'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Section 3: NOTIFIKASI & UMUM */}
        <div className="mt-4">
          <p className="px-1 text-[11px] font-extrabold uppercase tracking-wider text-[#FACC15]">
            NOTIFIKASI &amp; SISTEM
          </p>
          <div className="coinova-card mt-1.5 divide-y divide-white/10 overflow-hidden rounded-[20px]">
            {/* Notifikasi Push */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#FACC15]/25 bg-[#12110B] text-sm">
                  🔔
                </span>
                <span className="text-xs font-extrabold">Notifikasi Push</span>
              </div>
              <button
                type="button"
                onClick={() => setPushNotifEnabled((v) => !v)}
                className={`relative h-6 w-11 rounded-full transition ${
                  pushNotifEnabled ? 'bg-[#FFEA00]' : 'bg-[#141418]'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#08080A] shadow transition-all ${
                    pushNotifEnabled ? 'left-5.5' : 'left-0.5 bg-white/70'
                  }`}
                />
              </button>
            </div>

            {/* Info Promo & Event */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#FACC15]/25 bg-[#12110B] text-sm">
                  🏷️
                </span>
                <span className="text-xs font-extrabold">
                  Info Promo &amp; Event
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPromoNotifEnabled((v) => !v)}
                className={`relative h-6 w-11 rounded-full transition ${
                  promoNotifEnabled ? 'bg-[#FFEA00]' : 'bg-[#141418]'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#08080A] shadow transition-all ${
                    promoNotifEnabled ? 'left-5.5' : 'left-0.5 bg-white/70'
                  }`}
                />
              </button>
            </div>

            {/* Bersihkan Cache */}
            <button
              type="button"
              onClick={() => setCacheSizeText('0.0 MB')}
              className="flex w-full items-center justify-between px-4 py-3 text-left active:bg-white/5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#FACC15]/25 bg-[#12110B] text-sm">
                  🗑️
                </span>
                <span className="text-xs font-extrabold">Bersihkan Cache</span>
              </div>
              <div className="flex items-center gap-1 text-xs font-extrabold text-[#FACC15]">
                <span>{cacheSizeText}</span>
                <span>&gt;</span>
              </div>
            </button>
          </div>
        </div>

        {/* Footer Version Info */}
        <div className="mt-6 text-center text-xs font-semibold text-zinc-400">
          <p className="font-bold text-[#FACC15]">{APP_VERSION_STRING}</p>
          <p className="mt-0.5">© 2026 COINOVA. All rights reserved.</p>
        </div>
      </div>
    );
  }

  // ============================================================================
  // MAIN SCREEN: PROFIL COINOVA
  // ============================================================================
  return (
    <div className="coinova-hud-bg min-h-full w-full px-3.5 pt-3 pb-24 text-white select-none">
      {/* ====================================================================
          1. TOP HEADER BAR
         ==================================================================== */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateHome?.()}
            aria-label="Kembali"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#FFEA00]/45 bg-[#12110B] text-[#FFEA00] shadow active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path
                d="M15 19l-7-7 7-7"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-widest text-[#FACC15]">
              COINOVA ACCOUNT
            </span>
            <h1 className="text-lg font-extrabold text-white">Profil Saya</h1>
          </div>
        </div>

        {/* Right Currency Pills */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-full border border-[#FACC15]/35 bg-[#0B0C10] px-2.5 py-1">
            <NovaDiamondIcon className="h-3.5 w-3.5" />
            <span className="font-mono-num text-xs font-extrabold text-[#FDE047]">
              {wallet.fireBalance.toLocaleString('id-ID')}
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-[#FFEA00]/45 bg-[#0B0C10] px-2.5 py-1">
            <NovaCoinIcon className="h-3.5 w-3.5" />
            <span className="font-mono-num text-xs font-extrabold text-[#FFEA00]">
              {wallet.coinBalance.toLocaleString('id-ID')}
            </span>
          </div>
        </div>
      </div>

      {/* ====================================================================
          2. USER SUMMARY CARD (AVATAR, USERNAME, LEVEL, KOIN & DIAMOND)
         ==================================================================== */}
      <div
        className={`coinova-card-glow mt-3.5 overflow-hidden rounded-[22px] p-4 ${
          featureStatus?.isVip || user.isVip
            ? 'border-2 border-[#FFEA00]/80 bg-gradient-to-br from-[#19160A] via-[#0B0B0F] to-[#121008] shadow-[0_0_24px_rgba(255,234,0,0.25)]'
            : ''
        }`}
      >
        <div className="flex items-center gap-3.5">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-[#FFEA00] bg-[#0B0B0F] shadow-[0_0_16px_rgba(255,234,0,0.28)]">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.username}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <CoinovaAvatarSvg className="h-full w-full" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-lg font-extrabold text-white">
                {user.username}
              </span>
              <span className="rounded-md border border-[#FFEA00]/45 bg-[#FFEA00]/15 px-2 py-0.5 text-[10px] font-extrabold uppercase text-[#FFEA00]">
                {levelEconomy.titleBadge}
              </span>
              {(featureStatus?.isVip || user.isVip) && (
                <span className="rounded-md border border-[#FFEA00] bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-2 py-0.5 text-[10px] font-black uppercase text-[#08080A] shadow-[0_0_10px_rgba(255,234,0,0.45)]">
                  👑 VIP
                </span>
              )}
              <VerifiedBlueBadge className="h-4.5 w-4.5 shrink-0" />
            </div>

            <span className="font-mono-num mt-1.5 inline-block rounded-lg border border-[#FACC15]/35 bg-[#0B0B0F] px-2.5 py-0.5 text-[11px] font-extrabold text-[#FACC15]">
              ID COINOVA: {user.referralCode || 'F11B4A'}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="my-3.5 border-t border-[#FACC15]/20" />

        {/* 3 Totals Row: Level | Koin | Diamond */}
        <div className="grid grid-cols-3 divide-x divide-[#FACC15]/20 text-center">
          <div className="px-1">
            <p className="text-[10.5px] font-semibold uppercase text-zinc-400">
              Level
            </p>
            <p className="font-mono-num mt-0.5 text-xs font-extrabold text-white">
              Lv.{user.dragonLevel} ({levelEconomy.titleBadge})
            </p>
          </div>

          <div className="px-1">
            <p className="text-[10.5px] font-semibold uppercase text-zinc-400">
              Koin
            </p>
            <div className="font-mono-num mt-0.5 flex items-center justify-center gap-1 text-xs font-extrabold text-[#FFEA00]">
              <NovaCoinIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {wallet.coinBalance.toLocaleString('id-ID')}
              </span>
            </div>
          </div>

          <div className="px-1">
            <p className="text-[10.5px] font-semibold uppercase text-zinc-400">
              Diamond
            </p>
            <div className="font-mono-num mt-0.5 flex items-center justify-center gap-1 text-xs font-extrabold text-[#FDE047]">
              <NovaDiamondIcon className="h-3.5 w-3.5 shrink-0" />
              <span>{wallet.fireBalance.toLocaleString('id-ID')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ====================================================================
          3. INFORMASI LEVEL CARD
         ==================================================================== */}
      <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px]">
        <div className="flex items-center gap-2 border-b border-[#FACC15]/20 bg-[#12110B] px-4 py-2.5">
          <span className="text-sm text-[#FFEA00]">◈</span>
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
            Informasi Tier &amp; Level
          </h2>
        </div>

        <div className="space-y-2 p-4 text-xs text-white">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Tier Saat Ini</span>
            <span className="font-extrabold text-[#FFEA00]">
              {levelEconomy.name} (Lv.{user.dragonLevel})
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Multiplier Aktif</span>
            <span className="font-extrabold text-white">
              {levelEconomy.tapMultiplier}x Kecepatan Koin
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Koin Per Klik</span>
            <span className="font-mono-num font-extrabold text-[#FFEA00]">
              +{levelEconomy.coinsPerTap.toLocaleString('id-ID')} Koin
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Batas Aktivitas</span>
            <span className="font-mono-num font-extrabold text-[#FDE047]">
              {levelEconomy.maxEnergy.toLocaleString('id-ID')} Tap ({levelEconomy.dailyClaimsLimit}x/hari)
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-white/10 pt-2">
            <span className="text-zinc-400">Status COINOVA VIP</span>
            {featureStatus?.isVip || user.isVip ? (
              <span className="font-extrabold text-[#FFEA00]">
                👑 ACTIVE (s/d{' '}
                {formatIndoDate(featureStatus?.vipExpiresAt || user.vipExpiresAt)})
              </span>
            ) : (featureStatus?.vipStatus || user.vipStatus) === 'EXPIRED' ? (
              <span className="font-extrabold text-red-400">
                EXPIRED (
                {formatIndoDate(featureStatus?.vipExpiresAt || user.vipExpiresAt)})
              </span>
            ) : (featureStatus?.vipStatus || user.vipStatus) === 'PENDING' ? (
              <span className="font-extrabold text-[#FDE047]">
                MENUNGGU VERIFIKASI ADMIN
              </span>
            ) : (
              <span className="font-bold text-zinc-500">Belum Aktif</span>
            )}
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onOpenUpgrade}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-2.5 text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_16px_rgba(255,234,0,0.3)] active:scale-[0.99]"
            >
              <span>⚡</span>
              <span>Upgrade Level</span>
            </button>
            <button
              type="button"
              onClick={() => setShowVipModal(true)}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-[#FFEA00]/55 bg-[#1A180B] py-2.5 text-xs font-black uppercase tracking-wider text-[#FFEA00] active:scale-[0.99]"
            >
              <span>👑</span>
              <span>
                {featureStatus?.isVip || user.isVip ? 'Detail VIP' : 'VIP Pass'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ====================================================================
          4. MENU UTAMA & FITUR COINOVA (STREAMLINED & CLEAN + TELEGRAM CHANNEL)
         ==================================================================== */}
      <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px]">
        <div className="flex items-center gap-2 border-b border-[#FACC15]/20 bg-[#12110B] px-4 py-2.5">
          <span className="text-sm text-[#FFEA00]">❖</span>
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
            Menu &amp; Fitur COINOVA
          </h2>
        </div>

        <div className="space-y-2 p-3 text-white">
          {/* 1. Riwayat Transaksi */}
          <button
            type="button"
            onClick={() => setShowHistoryModal(true)}
            className="flex w-full items-center justify-between rounded-xl border border-[#FACC15]/20 bg-[#0B0B0F] px-3.5 py-3 text-left transition hover:border-[#FFEA00]/45 active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#FFEA00]/35 bg-[#18160C] text-sm">
                🕒
              </span>
              <div>
                <span className="block text-xs font-extrabold text-white">
                  Riwayat Transaksi
                </span>
                <span className="block text-[10px] text-zinc-400">
                  Catatan penarikan E-Wallet &amp; konversi Diamond
                </span>
              </div>
            </div>
            <span className="text-xs font-black text-[#FACC15]">&gt;</span>
          </button>

          {/* 2. Pengaturan & Keamanan */}
          <button
            type="button"
            onClick={() => setSubScreen('SETTINGS')}
            className="flex w-full items-center justify-between rounded-xl border border-[#FACC15]/20 bg-[#0B0B0F] px-3.5 py-3 text-left transition hover:border-[#FFEA00]/45 active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#FFEA00]/35 bg-[#18160C] text-sm">
                ⚙️
              </span>
              <div>
                <span className="block text-xs font-extrabold text-white">
                  Pengaturan &amp; Keamanan
                </span>
                <span className="block text-[10px] text-zinc-400">
                  Kelola akun, E-Wallet utama, PIN &amp; preferensi
                </span>
              </div>
            </div>
            <span className="text-xs font-black text-[#FACC15]">&gt;</span>
          </button>

          {/* 4. Join Channel Telegram COINOVA */}
          <a
            href={TELEGRAM_OFFICIAL_CHANNEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-between gap-2.5 rounded-xl border border-[#FFEA00]/45 bg-gradient-to-r from-[#1A180B] to-[#0B0B0F] px-3.5 py-3 text-left transition hover:border-[#FFEA00] shadow-[0_0_16px_rgba(255,234,0,0.12)] active:scale-[0.99]"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#FFEA00]/50 bg-[#221F0E] text-[#FFEA00] shadow-[0_0_12px_rgba(255,234,0,0.2)]">
                <TelegramChannelIcon className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <span className="block text-xs font-extrabold text-white">
                  Join Channel Telegram
                </span>
                <span className="block text-[10px] leading-snug text-zinc-300">
                  Dapatkan info, update, event, dan pengumuman COINOVA.
                </span>
              </div>
            </div>
            <span className="shrink-0 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_12px_rgba(255,234,0,0.28)]">
              JOIN CHANNEL
            </span>
          </a>

          {/* 5. AI UGC Affiliate (Product + Character + Video Reference Studio) */}
          <button
            type="button"
            onClick={() => setShowUgcModal(true)}
            className="flex w-full items-center justify-between gap-2.5 rounded-xl border border-[#FFEA00]/50 bg-gradient-to-r from-[#1F1C0C] to-[#0B0B0F] px-3.5 py-3 text-left transition hover:border-[#FFEA00] shadow-[0_0_16px_rgba(255,234,0,0.14)] active:scale-[0.99]"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#FFEA00]/50 bg-[#24200E] text-sm text-[#FFEA00]">
                🎬
              </span>
              <div className="min-w-0">
                <span className="block text-xs font-extrabold text-[#FFEA00]">
                  AI UGC Affiliate
                </span>
                <span className="block text-[10px] leading-snug text-zinc-300">
                  Generator Prompt UGC dari Produk, Karakter &amp; Video Reference
                </span>
              </div>
            </div>
            <span className="shrink-0 rounded-xl border border-[#FFEA00]/60 bg-[#FFEA00]/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#FFEA00]">
              BUKA STUDIO
            </span>
          </button>

          {/* 6. Laporkan Bug */}
          <button
            type="button"
            onClick={() => {
              setBugFeedback(null);
              setBugReportTime(
                new Date().toLocaleString('id-ID', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              );
              setSubScreen('BUG_REPORT');
            }}
            className="flex w-full items-center justify-between rounded-xl border border-[#FACC15]/30 bg-[#0B0B0F] px-3.5 py-3 text-left transition hover:border-[#FFEA00] active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#FFEA00]/40 bg-[#18160C] text-sm">
                🐛
              </span>
              <div>
                <span className="block text-xs font-extrabold text-[#FFEA00]">
                  🐛 Laporkan Bug
                </span>
                <span className="block text-[10px] text-zinc-400">
                  Kirim laporan kendala &amp; screenshot ke tim teknis
                </span>
              </div>
            </div>
            <span className="text-xs font-black text-[#FFEA00]">&gt;</span>
          </button>
        </div>
      </div>

      {/* ====================================================================
          5. LOGOUT BUTTON
         ==================================================================== */}
      <button
        type="button"
        onClick={onSignOut}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/15 py-3 text-xs font-black uppercase tracking-wider text-red-300 shadow active:scale-[0.99]"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4.5 w-4.5">
          <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
        </svg>
        <span>Logout</span>
      </button>

      {/* ====================================================================
          MODAL 1: RIWAYAT TRANSAKSI
         ==================================================================== */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="coinova-card-glow w-full max-w-[360px] overflow-hidden rounded-[24px] text-white">
            <div className="flex items-center justify-between border-b border-[#FACC15]/25 bg-[#12110B] px-4 py-3">
              <div className="flex items-center gap-2">
                <CoinovaLogoMark className="h-5 w-5" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#FFEA00]">
                  Riwayat Transaksi COINOVA
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3.5">
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#FACC15]/20 bg-[#09090C] p-1">
                <button
                  type="button"
                  onClick={() => setHistoryTab('WITHDRAW')}
                  className={`rounded-lg py-1.5 text-xs font-extrabold transition ${
                    historyTab === 'WITHDRAW'
                      ? 'bg-[#FFEA00] text-[#08080A] shadow'
                      : 'text-zinc-400'
                  }`}
                >
                  Penarikan
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryTab('CONVERT')}
                  className={`rounded-lg py-1.5 text-xs font-extrabold transition ${
                    historyTab === 'CONVERT'
                      ? 'bg-[#FFEA00] text-[#08080A] shadow'
                      : 'text-zinc-400'
                  }`}
                >
                  Konversi
                </button>
              </div>

              <div className="mt-3 max-h-[300px] space-y-2.5 overflow-y-auto no-scrollbar">
                {historyTab === 'WITHDRAW' ? (
                  myWithdrawals.length === 0 ? (
                    <div className="rounded-2xl border border-[#FACC15]/20 bg-[#0B0B0F] p-5 text-center text-xs text-zinc-400">
                      Belum ada riwayat penarikan.
                    </div>
                  ) : (
                    myWithdrawals.map((w) => (
                      <div
                        key={w.withdrawalId}
                        className="flex items-center justify-between rounded-2xl border border-[#FACC15]/20 bg-[#0B0B0F] px-3.5 py-3"
                      >
                        <div>
                          <p className="text-xs font-extrabold text-white">
                            Penarikan {w.method} •{' '}
                            {maskWithdrawalAccountNumber(w.accountNumber)}
                          </p>
                          <p className="font-mono-num mt-0.5 text-xs font-extrabold text-[#FFEA00]">
                            {(w.lockedCoins || w.amount).toLocaleString('id-ID')} Koin
                          </p>
                          <p className="mt-0.5 text-[10px] text-zinc-400">
                            {formatDateShort(w.createdAt)}
                          </p>
                        </div>

                        <span className="rounded-full border border-[#FFEA00]/45 bg-[#FFEA00]/15 px-3 py-1 text-[10.5px] font-extrabold text-[#FFEA00]">
                          {w.status === 'PAID'
                            ? 'Berhasil'
                            : w.status === 'PENDING' || w.status === 'PROCESSING'
                            ? 'Proses'
                            : 'Ditolak'}
                        </span>
                      </div>
                    ))
                  )
                ) : myConversions.length === 0 ? (
                  <div className="rounded-2xl border border-[#FACC15]/20 bg-[#0B0B0F] p-5 text-center text-xs text-zinc-400">
                    Belum ada riwayat konversi koin.
                  </div>
                ) : (
                  myConversions.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between rounded-2xl border border-[#FACC15]/20 bg-[#0B0B0F] px-3.5 py-3"
                    >
                      <div>
                        <p className="text-xs font-extrabold text-white">
                          {tx.description}
                        </p>
                        <p className="font-mono-num mt-0.5 text-xs font-extrabold text-[#FFEA00]">
                          {tx.amount.toLocaleString('id-ID')} {tx.currency}
                        </p>
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          {formatDateShort(tx.createdAt)}
                        </p>
                      </div>
                      <span className="rounded-full border border-[#FFEA00]/45 bg-[#FFEA00]/15 px-3 py-1 text-[10.5px] font-extrabold text-[#FFEA00]">
                        Berhasil
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 2: COINOVA VIP PASS
         ==================================================================== */}
      <CoinovaVipModal
        isOpen={showVipModal}
        onClose={() => setShowVipModal(false)}
        uid={user.uid}
        username={user.username}
        featureStatus={featureStatus}
        activeQrisImageUrl={activeQrisImageUrl}
        isLoadingQris={isLoadingQris}
        onRefreshFeatures={() => {
          void fetchFeatureStatus();
        }}
      />

      {/* ====================================================================
          MODAL 3: AI UGC AFFILIATE STUDIO (PRODUCT + CHARACTER + VIDEO REFERENCE)
         ==================================================================== */}
      <AiUgcAffiliateModal
        isOpen={showUgcModal}
        onClose={() => setShowUgcModal(false)}
        uid={user.uid}
        coinBalance={wallet.coinBalance}
        onDeductCoins={onDeductCoinsForUgc}
      />
    </div>
  );
};
