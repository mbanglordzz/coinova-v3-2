import React, { useEffect, useRef, useState } from 'react';
import {
  AdminBroadcastRecord,
  NotificationItem,
  VipOrderRecord,
} from '../types/dragon';
import { ECONOMY_CONFIG } from '../config/economy';
import {
  CoinovaLogoMark,
  NovaDiamondIcon,
} from './GameIllustrations';
import {
  CheckCircleNeonIcon,
  ClockNeonIcon,
  CloseIcon,
  OfficialQRISCodeDisplay,
  UploadNeonIcon,
} from './DragonIcons';

export interface ServerFeatureStatusData {
  uid: string;
  mysteryBoxAvailable: boolean;
  lastMysteryBoxClaimAt: string | null;
  nextMysteryBoxAvailableAt: string | null;
  luckySpinAvailable: boolean;
  lastLuckySpinAt: string | null;
  nextLuckySpinAvailableAt: string | null;
  isVip: boolean;
  vipStatus: 'NONE' | 'PENDING' | 'ACTIVE' | 'EXPIRED';
  vipStartedAt: string | null;
  vipExpiresAt: string | null;
  pendingVipOrder: VipOrderRecord | null;
  activeBroadcasts: AdminBroadcastRecord[];
  notifications: NotificationItem[];
  coinBalance?: number;
  fireBalance?: number;
}

function compressVipProofImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak didukung.'));
      img.onload = () => {
        const maxDim = 720;
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
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export function getRemainingCooldownMs(
  nextIso: string | null | undefined,
  nowMs: number = Date.now()
): number {
  if (!nextIso) return 0;
  const targetMs = new Date(nextIso).getTime();
  if (!Number.isFinite(targetMs)) return 0;
  return Math.max(0, targetMs - nowMs);
}

export function formatRemainingCooldown(
  nextIso: string | null | undefined,
  nowMs: number = Date.now()
): string {
  const diffMs = getRemainingCooldownMs(nextIso, nowMs);
  if (diffMs <= 0) return 'Tersedia Sekarang';
  const totalSeconds = Math.ceil(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatIndoDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ============================================================================
// 1. COINOVA VIP PASS MODAL (Rp100.000 / 30 HARI)
// ============================================================================
interface CoinovaVipModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
  username: string;
  featureStatus: ServerFeatureStatusData | null;
  activeQrisImageUrl: string | null;
  isLoadingQris: boolean;
  onRefreshFeatures: (updated?: Partial<ServerFeatureStatusData>) => void;
}

export const CoinovaVipModal: React.FC<CoinovaVipModalProps> = ({
  isOpen,
  onClose,
  uid,
  username,
  featureStatus,
  activeQrisImageUrl,
  isLoadingQris,
  onRefreshFeatures,
}) => {
  const [proofDataUrl, setProofDataUrl] = useState<string>('');
  const [proofFileName, setProofFileName] = useState<string>('');
  const [paymentRef, setPaymentRef] = useState<string>('');
  const [showCheckoutForm, setShowCheckoutForm] = useState<boolean>(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isVip = Boolean(featureStatus?.isVip);
  const vipStatus = featureStatus?.vipStatus || 'NONE';
  const vipExpiresAt = featureStatus?.vipExpiresAt || null;
  const pendingOrder = featureStatus?.pendingVipOrder || null;

  const handleSelectProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFeedback(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFeedback({
        type: 'error',
        text: 'File bukti pembayaran VIP harus berupa gambar (PNG/JPG/WebP).',
      });
      return;
    }
    try {
      const compressed = await compressVipProofImage(file);
      setProofDataUrl(compressed);
      setProofFileName(file.name);
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Gagal memproses gambar bukti pembayaran.',
      });
    }
  };

  const handleSubmitVipOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!proofDataUrl) {
      setFeedback({
        type: 'error',
        text: 'Silakan upload screenshot bukti pembayaran QRIS Rp100.000 terlebih dahulu.',
      });
      return;
    }

    setBusy('order');
    setFeedback(null);
    try {
      const res = await fetch('/api/game/vip/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid,
          username,
          paymentMethod: 'QRIS',
          paymentReference:
            paymentRef.trim() || `VIP-${Date.now().toString().slice(-6)}`,
          paymentProofDataUrl: proofDataUrl,
          paymentProofFileName: proofFileName || 'bukti_vip_qris.jpg',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({
          type: 'error',
          text: data.error || 'Gagal mengirim bukti pembayaran VIP.',
        });
        return;
      }
      setFeedback({
        type: 'success',
        text:
          data.message ||
          'Bukti pembayaran VIP terkirim! Menunggu verifikasi Admin.',
      });
      setShowCheckoutForm(false);
      onRefreshFeatures(data);
    } catch {
      setFeedback({
        type: 'error',
        text: 'Gagal terhubung ke server. Silakan coba lagi.',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3.5 backdrop-blur-md"
    >
      <div className="coinova-card-glow flex max-h-[90dvh] w-full max-w-[400px] flex-col overflow-hidden rounded-[24px] border border-[#FFEA00]/50 bg-[#09090C] text-white">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#FACC15]/25 bg-[#12110B] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#FFEA00]/60 bg-[#FFEA00]/15 text-base shadow-[0_0_12px_rgba(255,234,0,0.25)]">
              👑
            </span>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-[#FFEA00]">
                COINOVA VIP PASS
              </h3>
              <p className="text-[10.5px] font-bold text-zinc-300">
                Rp 100.000 / 30 Hari • Keanggotaan Eksklusif
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white hover:border-[#FFEA00]"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto no-scrollbar p-4">
          {/* Status Banner */}
          <div className="rounded-2xl border border-[#FACC15]/35 bg-gradient-to-br from-[#17150B] to-[#0D0C08] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                Status Keanggotaan
              </span>
              {isVip ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#FFEA00]/60 bg-[#FFEA00]/20 px-2.5 py-0.5 text-[10px] font-black uppercase text-[#FFEA00]">
                  <CheckCircleNeonIcon className="h-3.5 w-3.5" />
                  VIP ACTIVE
                </span>
              ) : vipStatus === 'PENDING' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#FACC15]/50 bg-[#FACC15]/15 px-2.5 py-0.5 text-[10px] font-black uppercase text-[#FDE047]">
                  <ClockNeonIcon className="h-3.5 w-3.5" />
                  MENUNGGU VERIFIKASI
                </span>
              ) : vipStatus === 'EXPIRED' ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-400/50 bg-red-500/15 px-2.5 py-0.5 text-[10px] font-black uppercase text-red-300">
                  EXPIRED
                </span>
              ) : (
                <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[10px] font-bold uppercase text-zinc-400">
                  AKUN FREE
                </span>
              )}
            </div>

            {vipExpiresAt && (
              <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-xs">
                <span className="text-zinc-400">
                  {isVip ? 'Masa Aktif Hingga:' : 'Berakhir Pada:'}
                </span>
                <span className="font-mono-num font-extrabold text-[#FFEA00]">
                  {formatIndoDate(vipExpiresAt)}
                </span>
              </div>
            )}

            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-xs">
              <span className="text-zinc-400">Harga Berlangganan</span>
              <span className="font-mono-num text-sm font-black text-[#FFEA00]">
                Rp 100.000 / 30 Hari
              </span>
            </div>
          </div>

          {/* Single Concise & Premium VIP Benefits List (No Duplicate Comparison Box) */}
          <div className="rounded-2xl border border-[#FFEA00]/35 bg-[#0C0C10] p-3.5">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <p className="text-[11px] font-black uppercase tracking-wider text-[#FFEA00]">
                Benefit VIP Pass (30 Hari)
              </p>
              <span className="rounded-md border border-[#FFEA00]/40 bg-[#FFEA00]/15 px-2 py-0.5 text-[9.5px] font-black uppercase text-[#FFEA00]">
                EKSKLUSIF
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-1 gap-2 text-xs">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-[#111116] px-3 py-2">
                <span className="font-semibold text-zinc-200">
                  👑 VIP Badge eksklusif
                </span>
                <span className="text-[10.5px] font-extrabold text-[#FFEA00]">
                  Aktif
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-[#111116] px-3 py-2">
                <span className="font-semibold text-zinc-200">
                  ⚡ Bonus Coin dari tap
                </span>
                <span className="font-mono-num text-[11px] font-extrabold text-[#FFEA00]">
                  +10% / Tap
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-[#111116] px-3 py-2">
                <span className="font-semibold text-zinc-200">
                  💎 Diamond bonus bulanan
                </span>
                <span className="font-mono-num inline-flex items-center gap-1 text-[11px] font-extrabold text-[#FDE047]">
                  <NovaDiamondIcon className="h-3.5 w-3.5" />
                  <span>+50 Diamond</span>
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-[#111116] px-3 py-2">
                <span className="font-semibold text-zinc-200">
                  🚀 Prioritas proses withdrawal
                </span>
                <span className="text-[10.5px] font-extrabold text-[#FFEA00]">
                  Jalur Cepat
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-[#111116] px-3 py-2">
                <span className="font-semibold text-zinc-200">
                  ⏱️ Cooldown Mystery Box &amp; Lucky Spin
                </span>
                <span className="font-mono-num text-[11px] font-extrabold text-[#FDE047]">
                  18 Jam (Free: 24j)
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-[#111116] px-3 py-2">
                <span className="font-semibold text-zinc-200">
                  🔥 Bonus reward misi eligible
                </span>
                <span className="font-mono-num text-[11px] font-extrabold text-[#FFEA00]">
                  +10% Koin
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-[#111116] px-3 py-2">
                <span className="font-semibold text-zinc-200">
                  ✨ Tampilan / profil VIP eksklusif
                </span>
                <span className="text-[10.5px] font-extrabold text-[#FFEA00]">
                  Gold Frame
                </span>
              </div>
            </div>
          </div>

          {isVip && (
            <div className="rounded-2xl border border-[#FFEA00]/45 bg-[#14130B] px-3 py-2.5 text-center text-xs font-extrabold text-[#FFEA00]">
              👑 Keanggotaan VIP Anda Aktif Otomatis di Server
            </div>
          )}

          {/* Pending Order Notice */}
          {pendingOrder && !isVip && (
            <div className="rounded-2xl border border-[#FACC15]/40 bg-[#16140A] p-3.5 text-xs">
              <p className="font-extrabold text-[#FFEA00]">
                ⏳ Menunggu Verifikasi Admin
              </p>
              <p className="mt-1 text-zinc-300">
                Order ID:{' '}
                <span className="font-mono-num font-bold text-white">
                  {pendingOrder.orderId}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-zinc-400">
                VIP akan langsung aktif beserta bonus +50 Diamond setelah bukti pembayaran Rp100.000 Anda diverifikasi oleh Admin.
              </p>
            </div>
          )}

          {feedback && (
            <div
              className={`rounded-xl border px-3 py-2 text-center text-xs font-extrabold ${
                feedback.type === 'success'
                  ? 'border-[#FFEA00]/50 bg-[#FFEA00]/15 text-[#FFEA00]'
                  : 'border-red-400/50 bg-red-500/15 text-red-300'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {/* Activate / Renew VIP via QRIS */}
          {!isVip && !pendingOrder && (
            <>
              {!showCheckoutForm ? (
                <button
                  type="button"
                  onClick={() => setShowCheckoutForm(true)}
                  className="w-full rounded-2xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-3 text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(255,234,0,0.35)] active:scale-[0.99]"
                >
                  {vipStatus === 'EXPIRED'
                    ? 'Perpanjang VIP Pass (Rp 100.000 / 30 Hari)'
                    : 'Aktifkan VIP Pass (Rp 100.000 / 30 Hari)'}
                </button>
              ) : (
                <form onSubmit={handleSubmitVipOrder} className="space-y-3">
                  <OfficialQRISCodeDisplay
                    amountIdr={100000}
                    orderId=""
                    merchantName={ECONOMY_CONFIG.QRIS_MERCHANT_NAME}
                    nmid={ECONOMY_CONFIG.QRIS_NMID}
                    qrisImageUrl={activeQrisImageUrl}
                    isLoadingQris={isLoadingQris}
                  />

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleSelectProof}
                    className="hidden"
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#FFEA00]/60 bg-[#0C0C10] py-3 text-xs font-bold text-[#FACC15]"
                  >
                    <UploadNeonIcon className="h-4 w-4 text-[#FFEA00]" />
                    <span>
                      {proofFileName
                        ? `Bukti dipilih: ${proofFileName}`
                        : 'Upload Bukti Pembayaran VIP (Rp 100.000)'}
                    </span>
                  </button>

                  {proofDataUrl && (
                    <img
                      src={proofDataUrl}
                      alt="Preview Bukti VIP"
                      className="mx-auto max-h-32 rounded-xl border border-[#FACC15]/30 object-contain"
                    />
                  )}

                  <input
                    type="text"
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder="Catatan / No. Referensi QRIS (Opsional)"
                    className="w-full rounded-xl border border-[#FACC15]/25 bg-[#0C0C10] px-3 py-2 text-xs font-bold text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCheckoutForm(false)}
                      className="h-10 rounded-xl border border-white/15 bg-white/5 text-xs font-bold text-white"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      disabled={busy === 'order'}
                      className="h-10 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black text-[#08080A]"
                    >
                      {busy === 'order' ? 'Mengirim...' : 'Kirim Bukti VIP'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 2. MYSTERY BOX — DAILY EVENT MODAL (1x / 24 JAM, COOLDOWN SERVER-VALIDATED)
// ============================================================================
interface MysteryBoxModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
  featureStatus: ServerFeatureStatusData | null;
  onRefreshFeatures: (updated?: Partial<ServerFeatureStatusData>) => void;
}

export const MysteryBoxModal: React.FC<MysteryBoxModalProps> = ({
  isOpen,
  onClose,
  uid,
  featureStatus,
  onRefreshFeatures,
}) => {
  const [opening, setOpening] = useState<boolean>(false);
  const inFlightBoxRef = useRef<boolean>(false);
  const [wonReward, setWonReward] = useState<{
    type: string;
    amount: number;
    label: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isOpen) return;
    setWonReward(null);
    setErrorMsg(null);
    setNowTickMs(Date.now());
    const timer = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  const nextAvailableAt = featureStatus?.nextMysteryBoxAvailableAt || null;
  const remainingMs = getRemainingCooldownMs(nextAvailableAt, nowTickMs);
  const isAvailable = Boolean(
    featureStatus &&
      (featureStatus.mysteryBoxAvailable ||
        (Boolean(nextAvailableAt) && remainingMs <= 0)) &&
      remainingMs <= 0
  );
  const isVip = Boolean(featureStatus?.isVip);

  const handleOpenBox = async () => {
    if (inFlightBoxRef.current || opening || !isAvailable) return;
    inFlightBoxRef.current = true;
    setOpening(true);
    setErrorMsg(null);
    setWonReward(null);
    try {
      const res = await fetch('/api/game/daily-event/mystery-box', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || 'Gagal membuka Mystery Box.');
        if (data.nextMysteryBoxAvailableAt) {
          onRefreshFeatures({
            mysteryBoxAvailable: false,
            nextMysteryBoxAvailableAt: data.nextMysteryBoxAvailableAt,
          });
        }
        return;
      }
      setWonReward(data.reward);
      onRefreshFeatures(data);
    } catch {
      setErrorMsg('Gagal menghubungi server. Coba lagi.');
    } finally {
      setOpening(false);
      inFlightBoxRef.current = false;
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
    >
      <div className="coinova-card-glow w-full max-w-[370px] overflow-hidden rounded-[24px] border border-[#FFEA00]/50 bg-[#09090C] text-white">
        <div className="flex items-center justify-between border-b border-[#FACC15]/25 bg-[#12110B] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-base">🎁</span>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-[#FFEA00]">
                DAILY EVENT — MYSTERY BOX
              </h3>
              <p className="text-[10px] font-semibold text-zinc-400">
                {isVip
                  ? '👑 Cooldown Cepat VIP (18 Jam) • Server-Validated'
                  : '1x Setiap 24 Jam • Server-Validated'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white hover:border-[#FFEA00]"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3.5 p-4 text-center">
          {/* Mystery Box Visual */}
          <div className="relative mx-auto flex h-32 w-32 items-center justify-center rounded-3xl border-2 border-[#FFEA00]/60 bg-gradient-to-b from-[#231F0D] to-[#0D0C08] shadow-[0_0_28px_rgba(255,234,0,0.22)]">
            <span
              className={`text-6xl transition-transform duration-300 ${
                opening ? 'scale-110 animate-bounce' : ''
              }`}
            >
              🎁
            </span>
          </div>

          <p className="text-xs leading-relaxed text-zinc-300">
            Buka Mystery Box harian gratis untuk mendapatkan hadiah acak berupa{' '}
            <span className="font-bold text-[#FFEA00]">Koin</span> atau{' '}
            <span className="font-bold text-[#FDE047]">Diamond</span>!
          </p>

          {/* Reward Pool Preview (Koin & Diamond Only) */}
          <div className="grid grid-cols-2 gap-2 text-[11px] font-extrabold">
            <div className="rounded-xl border border-white/10 bg-[#0C0C10] py-2 text-[#FFEA00]">
              🪙 +250 – 1.000 Koin
            </div>
            <div className="rounded-xl border border-white/10 bg-[#0C0C10] py-2 text-[#FDE047]">
              💎 +1 – 2 Diamond
            </div>
          </div>

          {!isAvailable && nextAvailableAt && (
            <div className="rounded-2xl border border-[#FACC15]/35 bg-[#14130B] px-3.5 py-2.5 text-xs">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">
                Bisa Digunakan Kembali Dalam
              </p>
              <p className="font-mono-num mt-0.5 text-base font-black tracking-widest text-[#FFEA00]">
                ⏳ {formatRemainingCooldown(nextAvailableAt, nowTickMs)}
              </p>
            </div>
          )}

          {wonReward && (
            <div className="rounded-2xl border border-[#FFEA00] bg-[#FFEA00]/15 p-3 text-xs font-extrabold text-[#FFEA00]">
              🎉 Selamat! Kamu mendapatkan: {wonReward.label}
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl border border-red-400/50 bg-red-500/15 p-2.5 text-xs font-extrabold text-red-300">
              {errorMsg}
            </div>
          )}

          <button
            type="button"
            onClick={handleOpenBox}
            disabled={opening || !isAvailable}
            className={`w-full rounded-2xl py-3 text-xs font-black uppercase tracking-wider transition ${
              isAvailable
                ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A] shadow-[0_0_20px_rgba(255,234,0,0.35)] active:scale-95'
                : 'cursor-not-allowed border border-white/10 bg-[#121216] text-zinc-400'
            }`}
          >
            {opening
              ? 'MEMBUKA MYSTERY BOX...'
              : isAvailable
              ? 'BUKA MYSTERY BOX GRATIS'
              : `Cooldown • ${formatRemainingCooldown(nextAvailableAt, nowTickMs)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3. LUCKY SPIN — DAILY EVENT MODAL (1x / 24 JAM, COOLDOWN SERVER-VALIDATED)
// ============================================================================
const WHEEL_ITEMS = [
  '200 Koin',
  '1 💎',
  '500 Koin',
  '300 Koin',
  '1.000 Koin',
  '2 💎',
  '350 Koin',
  '750 Koin',
];

interface LuckySpinModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
  featureStatus: ServerFeatureStatusData | null;
  onRefreshFeatures: (updated?: Partial<ServerFeatureStatusData>) => void;
}

export const LuckySpinModal: React.FC<LuckySpinModalProps> = ({
  isOpen,
  onClose,
  uid,
  featureStatus,
  onRefreshFeatures,
}) => {
  const [spinning, setSpinning] = useState<boolean>(false);
  const inFlightSpinRef = useRef<boolean>(false);
  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [wonReward, setWonReward] = useState<{
    type: string;
    amount: number;
    label: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!isOpen) return;
    setWonReward(null);
    setErrorMsg(null);
    setNowTickMs(Date.now());
    const timer = window.setInterval(() => {
      setNowTickMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  const nextAvailableAt = featureStatus?.nextLuckySpinAvailableAt || null;
  const remainingMs = getRemainingCooldownMs(nextAvailableAt, nowTickMs);
  const isAvailable = Boolean(
    featureStatus &&
      (featureStatus.luckySpinAvailable ||
        (Boolean(nextAvailableAt) && remainingMs <= 0)) &&
      remainingMs <= 0
  );
  const isVip = Boolean(featureStatus?.isVip);

  const handleSpin = async () => {
    if (inFlightSpinRef.current || spinning || !isAvailable) return;
    inFlightSpinRef.current = true;
    setSpinning(true);
    setErrorMsg(null);
    setWonReward(null);

    try {
      const res = await fetch('/api/game/daily-event/lucky-spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSpinning(false);
        inFlightSpinRef.current = false;
        setErrorMsg(data.error || 'Gagal memutar Lucky Spin.');
        if (data.nextLuckySpinAvailableAt) {
          onRefreshFeatures({
            luckySpinAvailable: false,
            nextLuckySpinAvailableAt: data.nextLuckySpinAvailableAt,
          });
        }
        return;
      }

      // Immediately sync cooldown timestamp to parent state before spin animation finishes
      onRefreshFeatures({
        luckySpinAvailable: false,
        lastLuckySpinAt: data.lastLuckySpinAt,
        nextLuckySpinAvailableAt: data.nextLuckySpinAvailableAt,
      });

      const segIdx = Number(data.segmentIndex || 0);
      const segAngle = 360 / WHEEL_ITEMS.length; // 45 deg per segment
      const targetRotation =
        rotationDeg + 360 * 5 + (360 - segIdx * segAngle);
      setRotationDeg(targetRotation);

      window.setTimeout(() => {
        setSpinning(false);
        inFlightSpinRef.current = false;
        setWonReward(data.reward);
        onRefreshFeatures(data);
      }, 2200);
    } catch {
      setSpinning(false);
      inFlightSpinRef.current = false;
      setErrorMsg('Gagal menghubungi server. Coba lagi.');
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
    >
      <div className="coinova-card-glow w-full max-w-[375px] overflow-hidden rounded-[24px] border border-[#FFEA00]/50 bg-[#09090C] text-white">
        <div className="flex items-center justify-between border-b border-[#FACC15]/25 bg-[#12110B] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-base">🎡</span>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-[#FFEA00]">
                DAILY EVENT — LUCKY SPIN
              </h3>
              <p className="text-[10px] font-semibold text-zinc-400">
                {isVip
                  ? '👑 Cooldown Cepat VIP (18 Jam) • Server-Side RNG'
                  : '1x Setiap 24 Jam • Server-Side RNG'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={spinning}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white hover:border-[#FFEA00]"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3.5 p-4 text-center">
          {/* Wheel Container */}
          <div className="relative mx-auto flex h-52 w-52 items-center justify-center">
            {/* Top Pointer */}
            <div className="absolute -top-2 left-1/2 z-20 -translate-x-1/2 text-xl text-[#FFEA00] drop-shadow-[0_0_8px_rgba(255,234,0,0.8)]">
              ▼
            </div>

            {/* Rotating Wheel */}
            <div
              style={{
                transform: `rotate(${rotationDeg}deg)`,
                transition: spinning
                  ? 'transform 2.15s cubic-bezier(0.16, 1, 0.3, 1)'
                  : 'none',
              }}
              className="relative flex h-48 w-48 items-center justify-center rounded-full border-4 border-[#FFEA00] bg-gradient-to-br from-[#1E1B0B] via-[#0B0B0F] to-[#1A1708] shadow-[0_0_28px_rgba(255,234,0,0.28)]"
            >
              {WHEEL_ITEMS.map((label, idx) => {
                const angle = idx * (360 / WHEEL_ITEMS.length);
                return (
                  <div
                    key={label}
                    style={{
                      transform: `rotate(${angle}deg) translateY(-66px)`,
                    }}
                    className="absolute text-[9.5px] font-black uppercase tracking-tight text-[#FFEA00]"
                  >
                    {label}
                  </div>
                );
              })}

              <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#FFEA00] bg-[#09090C] shadow">
                <CoinovaLogoMark className="h-7 w-7" />
              </div>
            </div>
          </div>

          {!isAvailable && nextAvailableAt && !spinning && (
            <div className="rounded-2xl border border-[#FACC15]/35 bg-[#14130B] px-3.5 py-2.5 text-xs">
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">
                Bisa Diputar Kembali Dalam
              </p>
              <p className="font-mono-num mt-0.5 text-base font-black tracking-widest text-[#FFEA00]">
                ⏳ {formatRemainingCooldown(nextAvailableAt, nowTickMs)}
              </p>
            </div>
          )}

          {wonReward && (
            <div className="rounded-2xl border border-[#FFEA00] bg-[#FFEA00]/15 p-3 text-xs font-extrabold text-[#FFEA00]">
              🎉 Selamat! Kamu memenangkan: {wonReward.label}
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl border border-red-400/50 bg-red-500/15 p-2.5 text-xs font-extrabold text-red-300">
              {errorMsg}
            </div>
          )}

          <button
            type="button"
            onClick={handleSpin}
            disabled={spinning || !isAvailable}
            className={`w-full rounded-2xl py-3 text-xs font-black uppercase tracking-wider transition ${
              isAvailable && !spinning
                ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A] shadow-[0_0_20px_rgba(255,234,0,0.35)] active:scale-95'
                : 'cursor-not-allowed border border-white/10 bg-[#121216] text-zinc-400'
            }`}
          >
            {spinning
              ? 'MEMUTAR RODA KEBERUNTUNGAN...'
              : isAvailable
              ? 'PUTAR LUCKY SPIN GRATIS'
              : `Cooldown • ${formatRemainingCooldown(nextAvailableAt, nowTickMs)}`}
          </button>
        </div>
      </div>
    </div>
  );
};
