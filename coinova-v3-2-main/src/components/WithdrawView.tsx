import React, { useEffect, useRef, useState } from 'react';
import {
  EWalletMethod,
  GameSettings,
  UserAccount,
  UserProfile,
  UserWallet,
  WalletTransaction,
  WithdrawalRecord,
} from '../types/dragon';
import {
  calculateIdrFromCoins,
  ECONOMY_CONSTANTS,
  isTierEligibleForConversion,
  VALID_WITHDRAW_COIN_TIERS,
  WITHDRAWAL_DIAMOND_MAP,
  WITHDRAWAL_TIERS,
} from '../config/economy';
import {
  CoinovaLogoMark,
  EWalletLogoSvg,
  NovaCoinIcon,
  NovaDiamondIcon,
} from './GameIllustrations';
import { CloseIcon } from './DragonIcons';

interface WithdrawViewProps {
  user: UserAccount;
  wallet: UserWallet;
  profile: UserProfile;
  settings: GameSettings;
  withdrawals: WithdrawalRecord[];
  transactions: WalletTransaction[];
  onConvertCoinToFire: (fireToObtain: number) => Promise<void>;
  onRequestWithdrawal: (
    method: EWalletMethod,
    accountNumber: string,
    accountName: string,
    amount: number
  ) => Promise<void>;
  onSaveEwalletMethod?: (
    method: EWalletMethod,
    accountNumber: string,
    accountName: string
  ) => Promise<void>;
  onOpenUpgrade: () => void;
  onNavigateTab?: (tab: 'HOME') => void;
  busyAction: string | null;
}

const EWALLET_METHODS: EWalletMethod[] = ['DANA', 'GoPay', 'OVO', 'ShopeePay'];

function normalizeIndoPhoneInput(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+62')) return '0' + digits.slice(3);
  if (digits.startsWith('62')) return '0' + digits.slice(2);
  return digits.replace(/\D/g, '');
}

function isValidIndoEwalletPhone(phone: string): boolean {
  return /^08\d{8,13}$/.test(phone);
}

export function maskWithdrawalAccountNumber(raw: string): string {
  const clean = String(raw || '').trim();
  if (!clean) return '-';
  if (clean.length >= 8) {
    return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
  }
  if (clean.length >= 4) {
    return `${clean.slice(0, 2)}****${clean.slice(-2)}`;
  }
  return '****';
}

export const WithdrawView: React.FC<WithdrawViewProps> = ({
  user,
  wallet,
  profile,
  settings,
  withdrawals,
  onConvertCoinToFire,
  onRequestWithdrawal,
  onSaveEwalletMethod,
  onOpenUpgrade,
  onNavigateTab,
  busyAction,
}) => {
  const [method, setMethod] = useState<EWalletMethod>(
    profile.defaultEwallet || 'DANA'
  );
  const [accountNumber, setAccountNumber] = useState<string>(
    profile.ewalletNumber || profile.phone || ''
  );
  const [accountName, setAccountName] = useState<string>(
    profile.ewalletAccountName || profile.fullName || ''
  );
  const [selectedPreset, setSelectedPreset] = useState<number>(
    WITHDRAWAL_TIERS[0]?.amountCoins || 20000
  );
  const [localFeedback, setLocalFeedback] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);
  const [ewalletSaveNotice, setEwalletSaveNotice] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  // Konversi Modal (Koin -> Diamond)
  const [showConvertModal, setShowConvertModal] = useState<boolean>(false);
  const [fireAmountToBuy, setFireAmountToBuy] = useState<number>(1);
  const [convertMsg, setConvertMsg] = useState<string | null>(null);

  // Konfirmasi Penarikan Modal State
  const [pendingConfirmWithdraw, setPendingConfirmWithdraw] = useState<{
    method: EWalletMethod;
    accountNumber: string;
    accountName: string;
    targetCoins: number;
    targetFire: number;
  } | null>(null);

  const isWithdrawingRef = useRef<boolean>(false);

  useEffect(() => {
    if (profile.defaultEwallet) setMethod(profile.defaultEwallet);
    if (profile.ewalletNumber) setAccountNumber(profile.ewalletNumber);
    if (profile.ewalletAccountName) setAccountName(profile.ewalletAccountName);
  }, [profile.defaultEwallet, profile.ewalletNumber, profile.ewalletAccountName]);

  const selectedTier =
    WITHDRAWAL_TIERS.find((t) => t.amountIdr === selectedPreset) ||
    WITHDRAWAL_TIERS[0];

  const myWithdrawals = withdrawals.filter((w) => w.uid === user.uid);

  const validateEwalletFields = (): {
    valid: boolean;
    cleanPhone: string;
    cleanName: string;
    error?: string;
  } => {
    const cleanPhone = normalizeIndoPhoneInput(accountNumber.trim());
    const cleanName = accountName.trim();

    if (!cleanPhone || !isValidIndoEwalletPhone(cleanPhone)) {
      return {
        valid: false,
        cleanPhone,
        cleanName,
        error: `Nomor akun ${method} tidak valid. Gunakan nomor HP aktif diawali 08 (10-15 digit).`,
      };
    }
    if (cleanName.length < 2 || cleanName.length > 80) {
      return {
        valid: false,
        cleanPhone,
        cleanName,
        error: 'Nama pemilik akun E-Wallet wajib diisi minimal 2 karakter.',
      };
    }
    return { valid: true, cleanPhone, cleanName };
  };

  const handleSaveEwalletClick = async () => {
    setEwalletSaveNotice(null);
    const check = validateEwalletFields();
    if (!check.valid) {
      setEwalletSaveNotice({
        type: 'error',
        text: check.error || 'Data E-Wallet belum valid.',
      });
      return;
    }
    setAccountNumber(check.cleanPhone);
    setAccountName(check.cleanName);

    if (onSaveEwalletMethod) {
      await onSaveEwalletMethod(method, check.cleanPhone, check.cleanName);
    }
    setEwalletSaveNotice({
      type: 'success',
      text: `Metode ${method} (${check.cleanPhone} a/n ${check.cleanName}) berhasil disimpan.`,
    });
  };

  const handleWithdrawClick = async () => {
    if (isWithdrawingRef.current || busyAction === 'withdraw') return;
    setLocalFeedback(null);
    setEwalletSaveNotice(null);

    const check = validateEwalletFields();
    if (!check.valid) {
      setLocalFeedback({
        type: 'error',
        text:
          check.error ||
          'Mohon lengkapi Nomor Akun dan Nama Pemilik Akun E-Wallet dengan benar.',
      });
      return;
    }

    setAccountNumber(check.cleanPhone);
    setAccountName(check.cleanName);

    const targetCoins = selectedTier.requiredCoins;
    const targetFire =
      WITHDRAWAL_DIAMOND_MAP[targetCoins] ?? selectedTier.requiredFire;

    if (!VALID_WITHDRAW_COIN_TIERS.includes(targetCoins) || !targetFire) {
      setLocalFeedback({
        type: 'error',
        text: 'Nominal penarikan harus salah satu paket resmi: 20.000, 50.000, 100.000, 200.000, 500.000, atau 1.000.000 Koin.',
      });
      return;
    }

    if (wallet.coinBalance < targetCoins) {
      setLocalFeedback({
        type: 'error',
        text: `Koin belum cukup untuk penarikan ${targetCoins.toLocaleString(
          'id-ID'
        )} Koin (Saldo Koin Anda: ${wallet.coinBalance.toLocaleString('id-ID')} Koin).`,
      });
      return;
    }

    if (wallet.fireBalance < targetFire) {
      setLocalFeedback({
        type: 'error',
        text: `Diamond belum cukup (${wallet.fireBalance.toLocaleString('id-ID')}/${targetFire.toLocaleString('id-ID')} Diamond). Penarikan ${targetCoins.toLocaleString('id-ID')} Koin membutuhkan ${targetFire.toLocaleString('id-ID')} Diamond.`,
      });
      return;
    }

    // Open Konfirmasi Penarikan popup before submitting
    setPendingConfirmWithdraw({
      method,
      accountNumber: check.cleanPhone,
      accountName: check.cleanName,
      targetCoins,
      targetFire,
    });
  };

  const handleExecuteConfirmedWithdraw = async () => {
    if (
      !pendingConfirmWithdraw ||
      isWithdrawingRef.current ||
      busyAction === 'withdraw'
    ) {
      return;
    }
    const {
      method: confirmedMethod,
      accountNumber: confirmedPhone,
      accountName: confirmedName,
      targetCoins,
      targetFire,
    } = pendingConfirmWithdraw;

    isWithdrawingRef.current = true;
    try {
      await onRequestWithdrawal(
        confirmedMethod,
        confirmedPhone,
        confirmedName,
        targetCoins
      );
      setPendingConfirmWithdraw(null);
      setLocalFeedback({
        type: 'success',
        text: `Permintaan penarikan ${targetCoins.toLocaleString(
          'id-ID'
        )} Koin (Syarat ${targetFire.toLocaleString('id-ID')} Diamond) ke ${confirmedMethod} (${maskWithdrawalAccountNumber(confirmedPhone)}) berhasil diajukan!${user.isVip ? ' [Prioritas Antrean VIP Aktif]' : ''} Proses penarikan maksimal 3x24 jam.`,
      });
    } catch (err) {
      setPendingConfirmWithdraw(null);
      setLocalFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal mengajukan penarikan. Silakan coba lagi.',
      });
    } finally {
      isWithdrawingRef.current = false;
    }
  };

  const canConvertCoins = isTierEligibleForConversion(user.dragonLevel);
  const dailyConvertedUsed = Math.max(0, Math.floor(Number(user.dailyConvertedFire || 0)));
  const remainingDailyConvert = Math.max(
    0,
    ECONOMY_CONSTANTS.MAX_DAILY_FIRE_CONVERT - dailyConvertedUsed
  );

  const handleConfirmConvert = async () => {
    setConvertMsg(null);
    if (!canConvertCoins) {
      setConvertMsg(
        'Fitur Konversi Koin ke Diamond hanya tersedia untuk 2 Tier Tertinggi (Tier Pro Lv.4 & Tier Ultimate Lv.5).'
      );
      return;
    }
    if (remainingDailyConvert < fireAmountToBuy) {
      setConvertMsg(
        `Batas konversi harian tercapai (Sisa kuota hari ini: ${remainingDailyConvert}/${ECONOMY_CONSTANTS.MAX_DAILY_FIRE_CONVERT} Diamond).`
      );
      return;
    }
    const neededCoins =
      fireAmountToBuy * ECONOMY_CONSTANTS.COINS_PER_ONE_FIRE_CONVERT;
    if (wallet.coinBalance < neededCoins) {
      setConvertMsg('Koin tidak mencukupi untuk konversi.');
      return;
    }
    await onConvertCoinToFire(fireAmountToBuy);
    setConvertMsg(`Permintaan tukar koin (+${fireAmountToBuy} Diamond) telah diproses.`);
  };

  const formatShortCoin = (coins: number) => {
    if (coins >= 1000000) return `${coins / 1000000}JT`;
    if (coins >= 1000) return `${coins / 1000}K`;
    return String(coins);
  };

  const formatShortFire = (fire: number) => {
    if (fire >= 1000) return `${fire.toLocaleString('id-ID')}`;
    return String(fire);
  };

  const formatDateShort = (iso: string) => {
    try {
      const d = new Date(iso);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    } catch {
      return '26/09/2026';
    }
  };

  const getStatusBadgeConfig = (status: WithdrawalRecord['status']) => {
    switch (status) {
      case 'PAID':
        return {
          label: 'Paid • Berhasil',
          className:
            'border-[#FFEA00]/45 bg-[#FFEA00]/15 text-[#FFEA00]',
        };
      case 'PROCESSING':
        return {
          label: 'Processing • Diproses',
          className:
            'border-[#FACC15]/45 bg-[#FACC15]/15 text-[#FDE047]',
        };
      case 'REJECTED':
        return {
          label: 'Rejected • Ditolak',
          className:
            'border-red-400/45 bg-red-500/15 text-red-300',
        };
      case 'PENDING':
      default:
        return {
          label: 'Pending • Menunggu',
          className:
            'border-[#FACC15]/45 bg-[#FACC15]/15 text-[#FDE047]',
        };
    }
  };

  return (
    <div className="coinova-hud-bg min-h-full w-full px-3.5 pt-3 pb-24 text-white select-none">
      {/* ====================================================================
          1. TOP HEADER BAR
         ==================================================================== */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateTab?.('HOME')}
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
              COINOVA WALLET
            </span>
            <h1 className="text-lg font-extrabold text-white">
              Penarikan Saldo
            </h1>
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
          2. KOIN SAYA CARD + TOMBOL KONVERSI
         ==================================================================== */}
      <div className="coinova-card-glow mt-3.5 flex items-center justify-between gap-3 overflow-hidden rounded-[22px] p-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-300">
            KOIN SAYA
          </p>
          <p className="font-mono-num mt-0.5 text-[24px] font-extrabold leading-tight text-[#FFEA00]">
            {wallet.coinBalance.toLocaleString('id-ID')} Koin
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono-num inline-flex items-center gap-1 rounded-full border border-[#FACC15]/35 bg-[#0B0B0F] px-2.5 py-0.5 text-[11px] font-extrabold text-[#FDE047]">
              <NovaDiamondIcon className="h-3.5 w-3.5" />
              {wallet.fireBalance.toLocaleString('id-ID')} Diamond
            </span>
            {wallet.lockedIdrBalance > 0 && (
              <span className="font-mono-num inline-flex items-center gap-1 rounded-full border border-[#FACC15]/30 bg-[#FACC15]/10 px-2.5 py-0.5 text-[10px] font-extrabold text-[#FDE047]">
                Ditahan: {wallet.lockedIdrBalance.toLocaleString('id-ID')} Koin
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setConvertMsg(null);
            setShowConvertModal(true);
          }}
          className="shrink-0 flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_16px_rgba(255,234,0,0.3)] active:scale-95"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z" />
          </svg>
          <span>Konversi</span>
        </button>
      </div>

      {/* ====================================================================
          3. METODE PENARIKAN CARD (DANA, GoPay, OVO, ShopeePay)
         ==================================================================== */}
      <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px]">
        <div className="flex items-center justify-between border-b border-[#FACC15]/20 bg-[#12110B] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#FFEA00]">◈</span>
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Metode Penarikan E-Wallet
            </h2>
          </div>
          <span className="text-[10px] font-bold text-[#FACC15]">
            Aktif: {method}
          </span>
        </div>

        <div className="space-y-3 p-3.5">
          {/* 4 Official E-Wallet Method Cards */}
          <div className="grid grid-cols-4 gap-2">
            {EWALLET_METHODS.map((item) => {
              const isSelected = method === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setMethod(item);
                    setEwalletSaveNotice(null);
                  }}
                  className={`relative flex flex-col items-center justify-center rounded-xl border py-2.5 px-1.5 transition ${
                    isSelected
                      ? 'border-[#FFEA00] bg-[#1C190C] shadow-[0_0_14px_rgba(255,234,0,0.2)]'
                      : 'border-white/10 bg-[#0B0B0F] opacity-85 hover:opacity-100'
                  }`}
                >
                  {isSelected && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#FFEA00] text-[9px] font-black text-[#08080A]">
                      ✓
                    </span>
                  )}
                  <EWalletLogoSvg method={item} className="h-6 w-full" />
                  <span className="mt-1.5 text-[9.5px] font-extrabold uppercase text-zinc-200">
                    {item}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Nomor Akun Input */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300">
              Nomor Akun ({method})
            </label>
            <input
              type="tel"
              inputMode="numeric"
              value={accountNumber}
              onChange={(e) => {
                setAccountNumber(e.target.value);
                setEwalletSaveNotice(null);
              }}
              placeholder="Contoh: 085647799104"
              className="font-mono-num mt-1 w-full rounded-xl border border-[#FACC15]/25 bg-[#09090C] px-3.5 py-2.5 text-xs font-extrabold text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
            />
          </div>

          {/* Nama Akun Input */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300">
              Nama Pemilik Akun ({method})
            </label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => {
                setAccountName(e.target.value);
                setEwalletSaveNotice(null);
              }}
              placeholder="Masukkan nama lengkap pemilik akun"
              className="mt-1 w-full rounded-xl border border-[#FACC15]/25 bg-[#09090C] px-3.5 py-2.5 text-xs font-extrabold text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
            />
          </div>

          {ewalletSaveNotice && (
            <p
              className={`rounded-xl border px-3 py-2 text-center text-[11px] font-extrabold ${
                ewalletSaveNotice.type === 'error'
                  ? 'border-red-400/40 bg-red-500/15 text-red-300'
                  : 'border-[#FFEA00]/45 bg-[#FFEA00]/15 text-[#FFEA00]'
              }`}
            >
              {ewalletSaveNotice.text}
            </p>
          )}

          {/* Simpan Metode E-Wallet Button */}
          <button
            type="button"
            onClick={handleSaveEwalletClick}
            disabled={busyAction === 'profile'}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#FFEA00]/45 bg-[#16150C] py-2 text-[11px] font-extrabold uppercase tracking-wider text-[#FFEA00] transition hover:bg-[#211E0F] active:scale-[0.99]"
          >
            <span>✓</span>
            <span>
              {busyAction === 'profile'
                ? 'Menyimpan...'
                : `Simpan Metode ${method}`}
            </span>
          </button>
        </div>
      </div>

      {/* ====================================================================
          4. NOMINAL WITHDRAWAL & TARIK SEKARANG
         ==================================================================== */}
      <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px]">
        <div className="flex items-center justify-between border-b border-[#FACC15]/20 bg-[#12110B] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#FFEA00]">❖</span>
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Nominal Withdrawal
            </h2>
          </div>
          <span className="font-mono-num inline-flex items-center gap-1 rounded-full border border-[#FACC15]/35 bg-[#09090C] px-2.5 py-0.5 text-[11px] font-extrabold text-[#FDE047]">
            <NovaDiamondIcon className="h-3.5 w-3.5 shrink-0" />
            <span>{wallet.fireBalance.toLocaleString('id-ID')}</span>
          </span>
        </div>

        <div className="p-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            {WITHDRAWAL_TIERS.map((tier) => {
              const isSelected = selectedPreset === tier.amountIdr;
              const hasEnoughFire = wallet.fireBalance >= tier.requiredFire;
              return (
                <button
                  key={tier.amountIdr}
                  type="button"
                  onClick={() => setSelectedPreset(tier.amountIdr)}
                  className={`relative flex flex-col items-start justify-between rounded-2xl border p-3 text-left transition ${
                    isSelected
                      ? 'border-[#FFEA00] bg-[#1C190C] shadow-[0_0_16px_rgba(255,234,0,0.18)]'
                      : 'border-white/10 bg-[#0B0B0F]'
                  }`}
                >
                  {isSelected && (
                    <span className="absolute right-2 top-2 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[#FFEA00] text-[10px] font-black text-[#08080A]">
                      ✓
                    </span>
                  )}

                  <p className="font-mono-num text-[14px] font-extrabold text-white">
                    {tier.requiredCoins.toLocaleString('id-ID')} Koin
                  </p>

                  <p className="mt-1 flex items-center gap-1 text-[10.5px] font-bold text-zinc-300">
                    <span>Syarat Diamond:</span>
                    <NovaDiamondIcon className="h-3 w-3 shrink-0" />
                    <span className="font-mono-num font-extrabold text-[#FDE047]">
                      {tier.requiredFire.toLocaleString('id-ID')}
                    </span>
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono-num inline-flex items-center gap-1 rounded-full border border-[#FACC15]/30 bg-[#09090C] px-2 py-0.5 text-[10px] font-extrabold text-[#FACC15]">
                      <NovaCoinIcon className="h-3 w-3" />
                      {formatShortCoin(tier.requiredCoins)}
                    </span>
                    <span
                      className={`font-mono-num inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${
                        hasEnoughFire
                          ? 'border-[#FFEA00]/45 bg-[#FFEA00]/15 text-[#FFEA00]'
                          : 'border-[#FACC15]/30 bg-[#09090C] text-[#FDE047]'
                      }`}
                      title={`Diamond Anda: ${wallet.fireBalance.toLocaleString('id-ID')} / Syarat: ${tier.requiredFire.toLocaleString('id-ID')}`}
                    >
                      <NovaDiamondIcon className="h-3 w-3" />
                      <span>
                        {wallet.fireBalance.toLocaleString('id-ID')} /{' '}
                        {formatShortFire(tier.requiredFire)}
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {localFeedback && (
            <p
              className={`mt-3 rounded-xl border px-3 py-2 text-center text-xs font-extrabold ${
                localFeedback.type === 'error'
                  ? 'border-red-400/40 bg-red-500/15 text-red-300'
                  : 'border-[#FFEA00]/45 bg-[#FFEA00]/15 text-[#FFEA00]'
              }`}
            >
              {localFeedback.text}
            </p>
          )}

          {/* Tarik Sekarang Button */}
          <button
            type="button"
            onClick={handleWithdrawClick}
            disabled={busyAction === 'withdraw'}
            className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-3 text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(255,234,0,0.3)] active:scale-[0.99]"
          >
            <span>⚡</span>
            <span>
              {busyAction === 'withdraw' ? 'Memproses...' : 'Tarik Sekarang'}
            </span>
          </button>
        </div>
      </div>

      {/* ====================================================================
          5. RIWAYAT PENARIKAN CARD (PENDING / PROCESSING / PAID / REJECTED)
         ==================================================================== */}
      <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px]">
        <div className="flex items-center justify-between border-b border-[#FACC15]/20 bg-[#12110B] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#FFEA00]">🕒</span>
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Riwayat Penarikan
            </h2>
          </div>
          <span className="font-mono-num text-[11px] font-bold text-[#FACC15]">
            {myWithdrawals.length} Transaksi
          </span>
        </div>

        <div className="space-y-2 p-3.5">
          {myWithdrawals.length === 0 ? (
            <p className="py-3 text-center text-xs text-zinc-400">
              Belum ada riwayat penarikan.
            </p>
          ) : (
            myWithdrawals.map((w) => {
              const badge = getStatusBadgeConfig(w.status);
              return (
                <div
                  key={w.withdrawalId}
                  className="rounded-xl border border-[#FACC15]/20 bg-[#0B0B0F] px-3.5 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-xs font-extrabold text-white">
                          {w.method} • {maskWithdrawalAccountNumber(w.accountNumber)}
                        </p>
                        {w.isVipPriority && (
                          <span className="shrink-0 rounded-md border border-[#FFEA00]/50 bg-[#FFEA00]/15 px-1.5 py-0.5 text-[9px] font-black uppercase text-[#FFEA00]">
                            👑 VIP Priority
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[10.5px] font-semibold text-zinc-400">
                        a/n {w.accountName}
                      </p>
                      <p className="font-mono-num mt-0.5 text-xs font-extrabold text-[#FFEA00]">
                        {(w.lockedCoins || w.coinDeducted || w.coinsSpent || w.amount).toLocaleString('id-ID')} Koin
                      </p>
                      <p className="font-mono-num mt-0.5 flex items-center gap-1 text-[10px] font-bold text-[#FDE047]">
                        <NovaDiamondIcon className="h-3 w-3 shrink-0" />
                        <span>
                          Syarat Diamond:{' '}
                          {(
                            w.fireDeducted ??
                            w.fireSpent ??
                            WITHDRAWAL_DIAMOND_MAP[w.lockedCoins || w.amount] ??
                            Math.max(1, Math.floor((w.lockedCoins || w.amount) / 100))
                          ).toLocaleString('id-ID')}{' '}
                          Diamond
                        </span>
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                      <span className="font-mono-num text-[10px] text-zinc-400">
                        {formatDateShort(w.createdAt)}
                      </span>
                    </div>
                  </div>

                  {w.paymentReference && w.paymentReference !== '-' && (
                    <p className="font-mono-num mt-1.5 border-t border-white/5 pt-1 text-[10px] text-[#FDE047]">
                      Ref Transfer: {w.paymentReference}
                    </p>
                  )}
                  {(w.status === 'PENDING' || w.status === 'PROCESSING') && (
                    <p className="mt-1 text-[10px] font-semibold text-zinc-400">
                      Estimasi proses penarikan maksimal 3x24 jam.
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ====================================================================
          6. ATURAN PENARIKAN CARD
         ==================================================================== */}
      <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px]">
        <div className="flex items-center gap-2 border-b border-[#FACC15]/20 bg-[#12110B] px-4 py-2.5">
          <span className="text-sm text-[#FFEA00]">ℹ️</span>
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
            Aturan Penarikan COINOVA
          </h2>
        </div>

        <ul className="space-y-1.5 p-4 text-xs text-zinc-300">
          <li className="flex items-start gap-2">
            <span className="font-black text-[#FFEA00]">•</span>
            <span>Pastikan nomor dan nama pemilik akun E-Wallet sudah benar.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-black text-[#FFEA00]">•</span>
            <span>
              Proses pencairan dana membutuhkan waktu maksimal 3x24 jam.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-black text-[#FFEA00]">•</span>
            <span>
              Penarikan memerlukan Koin dan Diamond sesuai nominal yang dipilih.
            </span>
          </li>
        </ul>
      </div>

      {/* ====================================================================
          MODAL KONFIRMASI PENARIKAN (CHECK ACCOUNT BEFORE SUBMITTING)
         ==================================================================== */}
      {pendingConfirmWithdraw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
          <div className="coinova-card-glow w-full max-w-[375px] overflow-hidden rounded-[24px] border border-[#FFEA00]/50 bg-[#09090C] text-white shadow-[0_0_28px_rgba(255,234,0,0.22)]">
            <div className="flex items-center justify-between border-b border-[#FACC15]/25 bg-[#12110B] px-4 py-3.5">
              <div className="flex items-center gap-2">
                <CoinovaLogoMark className="h-5 w-5" />
                <h3 className="text-sm font-black uppercase tracking-wider text-[#FFEA00]">
                  Konfirmasi Penarikan
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingConfirmWithdraw(null)}
                disabled={busyAction === 'withdraw'}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white hover:border-[#FFEA00]"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3.5 p-4">
              <p className="text-xs leading-relaxed text-zinc-300">
                Mohon periksa kembali detail akun tujuan di bawah ini sebelum mengirim permintaan penarikan:
              </p>

              <div className="space-y-2.5 rounded-2xl border border-[#FACC15]/30 bg-[#11100A] p-3.5 text-xs">
                <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                  <span className="text-zinc-400">Metode E-Wallet</span>
                  <span className="font-extrabold text-[#FFEA00]">
                    {pendingConfirmWithdraw.method}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                  <span className="text-zinc-400">Nama Pemilik</span>
                  <span className="font-extrabold text-white">
                    {pendingConfirmWithdraw.accountName}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                  <span className="text-zinc-400">Nomor Akun Lengkap</span>
                  <span className="font-mono-num text-sm font-black tracking-wider text-[#FFEA00]">
                    {pendingConfirmWithdraw.accountNumber}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                  <span className="text-zinc-400">Nominal Penarikan</span>
                  <span className="font-mono-num font-extrabold text-white">
                    {pendingConfirmWithdraw.targetCoins.toLocaleString('id-ID')} Koin
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-400">Syarat Diamond</span>
                  <span className="font-mono-num inline-flex items-center gap-1 font-extrabold text-[#FDE047]">
                    <NovaDiamondIcon className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {pendingConfirmWithdraw.targetFire.toLocaleString('id-ID')} Diamond
                    </span>
                  </span>
                </div>
                {user.isVip && (
                  <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">
                    <span className="text-zinc-400">Antrean VIP</span>
                    <span className="font-extrabold text-[#FFEA00]">
                      👑 Prioritas Antrean Aktif
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleExecuteConfirmedWithdraw}
                  disabled={busyAction === 'withdraw'}
                  className="w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-3 text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_18px_rgba(255,234,0,0.35)] active:scale-[0.99] disabled:opacity-50"
                >
                  {busyAction === 'withdraw'
                    ? 'Memproses Penarikan...'
                    : 'Ya, Nomor Sudah Benar — Tarik'}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingConfirmWithdraw(null)}
                  disabled={busyAction === 'withdraw'}
                  className="w-full rounded-xl border border-white/15 bg-white/5 py-2.5 text-xs font-bold text-zinc-200 hover:border-white/30"
                >
                  Batal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL KONVERSI KOIN KE DIAMOND
         ==================================================================== */}
      {showConvertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="coinova-card-glow w-full max-w-[365px] overflow-hidden rounded-[24px] text-white">
            <div className="flex items-center justify-between border-b border-[#FACC15]/25 bg-[#12110B] px-4 py-3">
              <div className="flex items-center gap-2">
                <CoinovaLogoMark className="h-5 w-5" />
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#FFEA00]">
                  Konversi Koin ke Diamond
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowConvertModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-4">
              {!canConvertCoins ? (
                <div className="space-y-3 rounded-2xl border border-[#FACC15]/35 bg-[#16140A] p-3.5 text-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FACC15]/40 bg-[#FACC15]/20 px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#FDE047]">
                    🔒 Fitur Terkunci (Level {user.dragonLevel})
                  </span>
                  <p className="text-xs font-semibold leading-relaxed text-zinc-200">
                    Fitur <strong>Konversi Koin ke Diamond</strong> hanya tersedia eksklusif untuk{' '}
                    <span className="font-extrabold text-[#FFEA00]">
                      2 Tier Tertinggi (Tier Pro Lv.4 &amp; Tier Ultimate Lv.5)
                    </span>
                    .
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setShowConvertModal(false);
                      onOpenUpgrade();
                    }}
                    className="w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-2.5 text-xs font-black uppercase text-[#08080A] shadow-[0_0_16px_rgba(255,234,0,0.3)]"
                  >
                    Naikkan ke Tier Pro / Ultimate
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-xl border border-[#FACC15]/25 bg-[#0B0B0F] px-3 py-2 text-[11px]">
                    <span className="text-zinc-300">Kuota Konversi Hari Ini:</span>
                    <span className="font-mono-num font-extrabold text-[#FFEA00]">
                      {dailyConvertedUsed}/{ECONOMY_CONSTANTS.MAX_DAILY_FIRE_CONVERT} Diamond
                    </span>
                  </div>

                  <p className="text-xs text-zinc-300">
                    Tukarkan Koin Anda menjadi Diamond untuk memenuhi syarat penarikan saldo (1.000 Koin = 1 Diamond):
                  </p>

                  <div className="grid grid-cols-3 gap-2">
                    {[1, 5, 10].map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        onClick={() => setFireAmountToBuy(qty)}
                        className={`rounded-xl border py-2 text-center text-xs font-extrabold ${
                          fireAmountToBuy === qty
                            ? 'border-[#FFEA00] bg-[#1F1C0D] text-[#FFEA00]'
                            : 'border-white/10 bg-[#0B0B0F] text-white'
                        }`}
                      >
                        <span className="inline-flex items-center justify-center gap-1">
                          <span>+{qty}</span>
                          <NovaDiamondIcon className="h-3.5 w-3.5 shrink-0" />
                        </span>
                        <span className="block text-[10px] text-zinc-400">
                          {(qty * 1000).toLocaleString('id-ID')} Koin
                        </span>
                      </button>
                    ))}
                  </div>

                  {convertMsg && (
                    <p className="text-center text-xs font-extrabold text-[#FFEA00]">
                      {convertMsg}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleConfirmConvert}
                    disabled={
                      busyAction === 'convert' ||
                      busyAction === 'convert_fire' ||
                      remainingDailyConvert < fireAmountToBuy
                    }
                    className="w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-2.5 text-xs font-black uppercase text-[#08080A] shadow-[0_0_16px_rgba(255,234,0,0.3)] disabled:opacity-40"
                  >
                    {busyAction === 'convert' || busyAction === 'convert_fire'
                      ? 'Memproses...'
                      : `Tukar ${(
                          fireAmountToBuy * 1000
                        ).toLocaleString('id-ID')} Koin -> +${fireAmountToBuy} Diamond`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
