import React, { useEffect, useState } from 'react';
import {
  GameSettings,
  ReferralRecord,
  TaskClaim,
  UserAccount,
  UserWallet,
} from '../types/dragon';
import {
  calculateCoinsFromIdr,
  getProgressiveInviteMissionState,
} from '../config/economy';
import {
  CoinovaAvatarSvg,
  CoinovaLogoMark,
  NovaCoinIcon,
  NovaDiamondIcon,
} from './GameIllustrations';

interface InviteViewProps {
  user: UserAccount;
  wallet?: UserWallet;
  settings: GameSettings;
  referrals: ReferralRecord[];
  taskClaims?: TaskClaim[];
  onBindReferralCode: (code: string) => Promise<void>;
  onVerifyReferral?: (ref: ReferralRecord) => Promise<void>;
  onRecordShare: () => void;
  onNavigateTab?: (tab: 'HOME') => void;
  busyAction: string | null;
}

export const InviteView: React.FC<InviteViewProps> = ({
  user,
  wallet,
  settings,
  referrals,
  taskClaims = [],
  onBindReferralCode,
  onRecordShare,
  onNavigateTab,
  busyAction,
}) => {
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [activeRefTab, setActiveRefTab] = useState<'PENDING' | 'VERIFIED'>(
    'VERIFIED'
  );
  const [inviterCodeInput, setInviterCodeInput] = useState<string>('');
  const [bindFeedback, setBindFeedback] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://coinova.app';
  const referralCode = (user.referralCode || 'F11B4A').toUpperCase();
  const referralLink = `${origin}/?ref=${referralCode}`;

  // Auto-prefill referral code from URL ?ref=CODE if not yet bound
  useEffect(() => {
    if (typeof window === 'undefined' || user.referredByCode) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const refFromUrl = (params.get('ref') || '').trim().toUpperCase();
      if (
        refFromUrl &&
        /^[A-Z0-9_-]{4,16}$/.test(refFromUrl) &&
        refFromUrl !== referralCode
      ) {
        setInviterCodeInput(refFromUrl);
      }
    } catch {
      // ignore
    }
  }, [user.referredByCode, referralCode]);

  // Deduplicated referrals belonging to current inviter
  const myReferrals = referrals.filter((r) => r.inviterUid === user.uid);
  const pendingList = myReferrals.filter(
    (r) => r.status === 'PENDING' || r.status === 'ACTIVE' || r.status === 'REJECTED'
  );
  const verifiedList = myReferrals.filter((r) => r.status === 'VERIFIED');
  const activeFriendsList = myReferrals.filter(
    (r) => r.status === 'ACTIVE' || r.status === 'VERIFIED' || r.activeRewardClaimed
  );
  const totalFriends = myReferrals.length;

  const totalRewardCoins = verifiedList.reduce(
    (acc, r) => acc + (r.rewardCoin || perInviteCoins),
    0
  );
  const totalRewardFire = myReferrals.reduce((acc, r) => {
    if (r.status === 'VERIFIED' || r.topupRewardClaimed) {
      return acc + Math.max(2, r.rewardFire || 2);
    }
    if (r.status === 'ACTIVE' || r.activeRewardClaimed) {
      return acc + Math.max(2, r.rewardFire || 2);
    }
    return acc;
  }, 0);

  const perInviteCoins = Math.max(
    1000,
    Math.floor(
      Number(
        settings.referralRewardCoin ||
          calculateCoinsFromIdr(settings.referralRewardIdr, settings.coinToIdrRate) ||
          25000
      )
    )
  );

  const fireBalance = wallet?.fireBalance ?? 0;
  const coinBalance = wallet?.coinBalance ?? 0;

  const inviteMissionState = getProgressiveInviteMissionState(
    user.uid,
    referrals,
    taskClaims
  );
  const milestoneTarget = inviteMissionState.activeTarget;
  const milestoneProgressPct = inviteMissionState.progressPercent;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopiedCode(true);
      onRecordShare();
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopiedLink(true);
      onRecordShare();
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleShareInvite = async () => {
    onRecordShare();
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'COINOVA - Invite Teman & Dapatkan Koin + Diamond!',
          text: `Gabung di COINOVA pakai Kode Undangan ${referralCode} dan raih bonus ${perInviteCoins.toLocaleString('id-ID')} Koin + ${settings.referralRewardFire} Diamond!`,
          url: referralLink,
        });
        return;
      } catch {
        // fallback to copy
      }
    }
    await handleCopyLink();
  };

  const handleBindSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBindFeedback(null);
    const cleanCode = inviterCodeInput.trim().toUpperCase();

    if (!cleanCode) {
      setBindFeedback({
        type: 'error',
        text: 'Masukkan kode undangan terlebih dahulu.',
      });
      return;
    }

    if (!/^[A-Z0-9_-]{4,16}$/.test(cleanCode)) {
      setBindFeedback({
        type: 'error',
        text: 'Format kode undangan tidak valid (4-16 karakter huruf/angka).',
      });
      return;
    }

    if (cleanCode === referralCode) {
      setBindFeedback({
        type: 'error',
        text: 'Tidak dapat menggunakan kode undangan milik sendiri.',
      });
      return;
    }

    if (user.referredByCode) {
      setBindFeedback({
        type: 'error',
        text: `Akun Anda sudah terhubung dengan pengundang (${user.referredByCode}).`,
      });
      return;
    }

    if (busyAction === 'bind_ref') return;
    await onBindReferralCode(cleanCode);
    setInviterCodeInput('');
    setBindFeedback({
      type: 'success',
      text: `Kode undangan ${cleanCode} berhasil diikat (Status: Pending).`,
    });
  };

  const formatDate = (iso: string) => {
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

  const activeList = activeRefTab === 'VERIFIED' ? verifiedList : pendingList;

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
              COINOVA NETWORK
            </span>
            <h1 className="text-lg font-extrabold text-white">
              Invite &amp; Referral
            </h1>
          </div>
        </div>

        {/* Right Currency Pills */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-full border border-[#FACC15]/35 bg-[#0B0C10] px-2.5 py-1">
            <NovaDiamondIcon className="h-3.5 w-3.5" />
            <span className="font-mono-num text-xs font-extrabold text-[#FDE047]">
              {fireBalance.toLocaleString('id-ID')}
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-[#FFEA00]/45 bg-[#0B0C10] px-2.5 py-1">
            <NovaCoinIcon className="h-3.5 w-3.5" />
            <span className="font-mono-num text-xs font-extrabold text-[#FFEA00]">
              {coinBalance.toLocaleString('id-ID')}
            </span>
          </div>
        </div>
      </div>

      {/* ====================================================================
          2. HERO FUTURISTIC REFERRAL DASHBOARD CARD
         ==================================================================== */}
      <div className="coinova-card-glow mt-3.5 overflow-hidden rounded-[22px] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FFEA00]/45 bg-[#FFEA00]/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#FFEA00]">
              <span>⚡</span>
              <span>SISTEM KOMISI OTOMATIS</span>
            </span>
            <h2 className="mt-1.5 text-base font-extrabold leading-snug text-white">
              Invite Teman &amp; Dapatkan Diamond + Koin
            </h2>
            <p className="mt-0.5 text-xs text-zinc-300">
              Raih{' '}
              <span className="font-bold text-[#FDE047]">
                +{settings.referralRewardFire} Diamond
              </span>{' '}
              saat teman aktif &amp;{' '}
              <span className="font-bold text-[#FFEA00]">
                +{perInviteCoins.toLocaleString('id-ID')} Koin
              </span>{' '}
              saat teman melakukan Top-Up / Upgrade Level.
            </p>
          </div>
          <CoinovaLogoMark className="h-12 w-12 shrink-0" />
        </div>

        {/* 3 Referral Metrics Grid: Jumlah Teman | Komisi Koin | Diamond Referral */}
        <div className="mt-3.5 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-[#FACC15]/25 bg-[#0B0B0F] p-2.5 text-center">
            <p className="text-[10px] font-semibold uppercase text-zinc-400">
              Jumlah Teman
            </p>
            <p className="font-mono-num mt-0.5 text-sm font-extrabold text-white">
              {totalFriends} Teman
            </p>
            <p className="text-[9.5px] font-semibold text-[#FACC15]">
              {activeFriendsList.length} Aktif • {verifiedList.length} Top-Up
            </p>
          </div>

          <div className="rounded-xl border border-[#FFEA00]/30 bg-[#0B0B0F] p-2.5 text-center">
            <p className="text-[10px] font-semibold uppercase text-zinc-400">
              Komisi Koin
            </p>
            <p className="font-mono-num mt-0.5 text-sm font-extrabold text-[#FFEA00]">
              +{totalRewardCoins.toLocaleString('id-ID')}
            </p>
            <p className="font-mono-num text-[9.5px] font-semibold text-zinc-400">
              +{perInviteCoins.toLocaleString('id-ID')} Koin / Top-Up
            </p>
          </div>

          <div className="rounded-xl border border-[#FACC15]/25 bg-[#0B0B0F] p-2.5 text-center">
            <p className="text-[10px] font-semibold uppercase text-zinc-400">
              Diamond Aktif
            </p>
            <p className="font-mono-num mt-0.5 flex items-center justify-center gap-1 text-sm font-extrabold text-[#FDE047]">
              <span>+{totalRewardFire}</span>
              <NovaDiamondIcon className="h-3.5 w-3.5 shrink-0" />
            </p>
            <p className="mt-0.5 flex items-center justify-center gap-1 text-[9.5px] font-semibold text-[#FDE047]/80">
              <span>+{settings.referralRewardFire}</span>
              <NovaDiamondIcon className="h-3 w-3 shrink-0" />
              <span>/ Teman Aktif</span>
            </p>
          </div>
        </div>

        {/* Aturan Referral Otomatis */}
        <div className="mt-3 rounded-xl border border-[#FACC15]/25 bg-[#09090C] p-2.5 text-[11px] leading-relaxed text-zinc-300">
          <p className="font-extrabold uppercase tracking-wider text-[#FFEA00]">
            Aturan Reward Referral (Verifikasi Sistem / Admin):
          </p>
          <ul className="mt-1 space-y-0.5 text-[10.5px]">
            <li>
              • <strong className="text-white">Teman Gabung (Belum Aktif):</strong> Status Pending (0 Reward)
            </li>
            <li>
              • <strong className="text-white">Teman Aktif Bermain:</strong> Pengundang mendapat{' '}
              <span className="font-bold text-[#FDE047]">
                +{settings.referralRewardFire} Diamond
              </span>
            </li>
            <li>
              • <strong className="text-white">Teman Top-Up / Upgrade Level Valid:</strong> Pengundang mendapat{' '}
              <span className="font-bold text-[#FFEA00]">
                +{perInviteCoins.toLocaleString('id-ID')} Koin + {settings.referralRewardFire} Diamond
              </span>
            </li>
          </ul>
        </div>

        {/* Progress Referral Bar */}
        <div className="mt-3 rounded-xl border border-[#FACC15]/25 bg-[#0B0B0F] p-2.5">
          <div className="flex items-center justify-between text-[11px] font-bold">
            <span className="text-zinc-300">
              Progress Misi Undang Teman (Target: {milestoneTarget})
            </span>
            <span className="font-mono-num text-[#FFEA00]">
              {inviteMissionState.validInviteCount}/{milestoneTarget} ({milestoneProgressPct}%)
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#060608]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#EAB308] via-[#FACC15] to-[#FFEA00]"
              style={{ width: `${milestoneProgressPct}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-zinc-400">
            Target bertingkat otomatis: {milestoneTarget} → {inviteMissionState.nextTarget} teman valid.
          </p>
        </div>

        {/* Kode Undangan Anda */}
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
            Kode Undangan COINOVA Anda:
          </p>
          <div className="mt-1 flex items-center justify-between rounded-2xl border border-[#FFEA00]/45 bg-[#09090C] px-3.5 py-2.5">
            <span className="font-mono-num text-lg font-extrabold tracking-widest text-[#FFEA00]">
              {referralCode}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopyCode}
                className="rounded-xl border border-[#FFEA00]/50 bg-[#FFEA00]/15 px-3 py-1.5 text-[11px] font-extrabold text-[#FFEA00] active:scale-95"
              >
                {copiedCode ? 'Kode Tersalin!' : 'Salin Kode'}
              </button>
              <button
                type="button"
                onClick={handleCopyLink}
                className="rounded-xl border border-[#FACC15]/45 bg-[#FACC15]/15 px-3 py-1.5 text-[11px] font-extrabold text-[#FDE047] active:scale-95"
              >
                {copiedLink ? 'Link Tersalin!' : 'Salin Link'}
              </button>
            </div>
          </div>
          <p className="font-mono-num mt-1 truncate text-[10px] text-zinc-400">
            Link: {referralLink}
          </p>
        </div>

        {/* Bagikan Undangan CTA */}
        <button
          type="button"
          onClick={handleShareInvite}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-3 text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_20px_rgba(255,234,0,0.3)] active:scale-[0.99]"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4.5 w-4.5">
            <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" />
          </svg>
          <span>Bagikan Link Invite</span>
        </button>

        {/* Bound Status or Input Form */}
        {user.referredByCode ? (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-[#FFEA00]/35 bg-[#12110B] px-3.5 py-2 text-xs">
            <span className="font-semibold text-zinc-300">
              Terhubung dengan Pengundang:
            </span>
            <span className="font-mono-num rounded-lg border border-[#FFEA00]/45 bg-[#FFEA00]/15 px-2.5 py-0.5 font-extrabold text-[#FFEA00]">
              {user.referredByCode} ✓
            </span>
          </div>
        ) : (
          <div className="mt-3">
            <form onSubmit={handleBindSubmit} className="flex gap-2">
              <input
                type="text"
                value={inviterCodeInput}
                onChange={(e) => {
                  setInviterCodeInput(e.target.value.toUpperCase());
                  setBindFeedback(null);
                }}
                placeholder="Punya kode pengundang? Masukkan di sini"
                className="flex-1 rounded-xl border border-[#FACC15]/30 bg-[#09090C] px-3 py-2 text-xs font-bold uppercase text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
              />
              <button
                type="submit"
                disabled={busyAction === 'bind_ref'}
                className="rounded-xl border border-[#FFEA00]/45 bg-[#18160C] px-3.5 py-2 text-xs font-extrabold text-[#FFEA00] active:scale-95"
              >
                {busyAction === 'bind_ref' ? '...' : 'Ikat Kode'}
              </button>
            </form>
            {bindFeedback && (
              <p
                className={`mt-2 rounded-xl border px-3 py-1.5 text-center text-[11px] font-extrabold ${
                  bindFeedback.type === 'error'
                    ? 'border-red-400/40 bg-red-500/15 text-red-300'
                    : 'border-[#FFEA00]/45 bg-[#FFEA00]/15 text-[#FFEA00]'
                }`}
              >
                {bindFeedback.text}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ====================================================================
          3. DAFTAR JARINGAN REFERRAL (STATUS OTOMATIS TANPA TOMBOL VERIFIKASI USER)
         ==================================================================== */}
      <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px]">
        <div className="flex items-center justify-between border-b border-[#FACC15]/20 bg-[#12110B] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#FFEA00]">◈</span>
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Daftar Jaringan Referral
            </h2>
          </div>
          <span className="font-mono-num text-xs font-extrabold text-[#FFEA00]">
            Total: {totalFriends} Teman
          </span>
        </div>

        <div className="p-3">
          {/* 2-Tab Switcher: Pending/Aktif | Top-Up Terverifikasi */}
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#FACC15]/25 bg-[#09090C] p-1">
            <button
              type="button"
              onClick={() => setActiveRefTab('PENDING')}
              className={`rounded-lg py-1.5 text-xs font-extrabold transition ${
                activeRefTab === 'PENDING'
                  ? 'bg-[#FFEA00] text-[#08080A] shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Pending / Aktif ({pendingList.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveRefTab('VERIFIED')}
              className={`rounded-lg py-1.5 text-xs font-extrabold transition ${
                activeRefTab === 'VERIFIED'
                  ? 'bg-[#FFEA00] text-[#08080A] shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Top-Up Valid ({verifiedList.length})
            </button>
          </div>

          {/* Referral Rows — Strictly read-only status badges (NO user-side Verifikasi button) */}
          <div className="mt-2.5 space-y-2">
            {activeList.length === 0 ? (
              <p className="py-4 text-center text-xs text-zinc-400">
                {activeRefTab === 'PENDING'
                  ? 'Tidak ada undangan berstatus Pending / Aktif.'
                  : 'Belum ada teman yang menyelesaikan Top-Up terverifikasi.'}
              </p>
            ) : (
              activeList.map((ref) => {
                const isVerified = ref.status === 'VERIFIED';
                const isActiveOnly = ref.status === 'ACTIVE' || (!isVerified && ref.activeRewardClaimed);
                const isRejected = ref.status === 'REJECTED';

                return (
                  <div
                    key={ref.referralId}
                    className="flex items-center justify-between gap-2 rounded-2xl border border-[#FACC15]/20 bg-[#0B0B0F] px-3.5 py-2.5 text-white"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <CoinovaAvatarSvg className="h-9 w-9 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-mono-num truncate text-sm font-extrabold text-white">
                          ID: {ref.inviteeUsername}
                        </p>
                        <p className="flex flex-wrap items-center gap-1 text-[11px] text-zinc-400">
                          <span>Bergabung: {formatDate(ref.createdAt)} •</span>
                          {isVerified ? (
                            <span className="inline-flex items-center gap-1 text-[#FFEA00]">
                              +{(ref.rewardCoin || perInviteCoins).toLocaleString('id-ID')} Koin &amp; +{ref.rewardFire}
                              <NovaDiamondIcon className="h-3 w-3 shrink-0" />
                            </span>
                          ) : isActiveOnly ? (
                            <span className="inline-flex items-center gap-1 text-[#FDE047]">
                              +{ref.rewardFire}
                              <NovaDiamondIcon className="h-3 w-3 shrink-0" />
                              <span>Diterima (Menunggu Top-Up)</span>
                            </span>
                          ) : isRejected ? (
                            <span>Tidak memenuhi syarat</span>
                          ) : (
                            <span>Belum Aktif (0 Reward)</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {isVerified ? (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-[#FFEA00]/45 bg-[#FFEA00]/15 px-2.5 py-1 text-[10px] font-extrabold text-[#FFEA00]">
                        <span>✓</span>
                        <span>Top-Up Valid</span>
                      </span>
                    ) : isActiveOnly ? (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-[#FACC15]/40 bg-[#FACC15]/15 px-2.5 py-1 text-[10px] font-extrabold text-[#FDE047]">
                        <NovaDiamondIcon className="h-3 w-3 shrink-0" />
                        <span>Aktif (+{ref.rewardFire})</span>
                      </span>
                    ) : isRejected ? (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-red-400/40 bg-red-500/15 px-2.5 py-1 text-[10px] font-extrabold text-red-300">
                        <span>✕</span>
                        <span>Ditolak</span>
                      </span>
                    ) : (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-[#FACC15]/40 bg-[#FACC15]/15 px-2.5 py-1 text-[10px] font-extrabold text-[#FDE047]">
                        <span>⏳</span>
                        <span>Pending</span>
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
