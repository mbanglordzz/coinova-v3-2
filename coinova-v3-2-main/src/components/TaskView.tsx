import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  GameTask,
  ReferralRecord,
  TaskClaim,
  UserAccount,
  UserWallet,
} from '../types/dragon';
import { DAILY_CHECKIN_REWARDS, DEFAULT_TASKS } from '../data/seedData';
import { getProgressiveInviteMissionState } from '../config/economy';
import { getTodayKey, isClaimedOnLocalToday } from '../services/dragonService';
import {
  GiftBoxTaskIcon,
  NovaCoinIcon,
  NovaDiamondIcon,
  TelegramChannelIcon,
  TreasureChestBlock,
} from './GameIllustrations';
import {
  CoinovaVipModal,
  formatRemainingCooldown,
  getRemainingCooldownMs,
  LuckySpinModal,
  MysteryBoxModal,
  ServerFeatureStatusData,
} from './CoinovaEventsAndVipModals';

const DEFAULT_TELEGRAM_CHANNEL_URL = 'https://t.me/CoinovaOfficiall';
const DEFAULT_APK_DOWNLOAD_URL =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_APK_DOWNLOAD_URL) ||
  'https://coinova.app/download/coinova-latest.apk';

export type ApkMissionStatus =
  | 'NOT_STARTED'
  | 'WAITING_VERIFICATION'
  | 'VERIFIED'
  | 'CLAIMED';

interface TaskViewProps {
  user: UserAccount;
  wallet: UserWallet;
  tasks: GameTask[];
  taskClaims: TaskClaim[];
  referrals: ReferralRecord[];
  shareCount: number;
  onClaimCheckIn: (rewardCoins: number, rewardFire: number) => Promise<void>;
  onClaimTask: (
    task: GameTask,
    extraPayload?: { telegramUserId?: string; telegramUsername?: string }
  ) => Promise<
    void | {
      ok: boolean;
      error?: string;
      rewardCoins?: number;
      message?: string;
    }
  >;
  onNavigateTab: (tab: 'HOME' | 'INVITE') => void;
  onOpenUpgrade: () => void;
  onSyncServerWalletAndVip?: (payload: {
    coinBalance?: number;
    fireBalance?: number;
    isVip?: boolean;
    vipStatus?: 'NONE' | 'PENDING' | 'ACTIVE' | 'EXPIRED';
    vipExpiresAt?: string | null;
  }) => void;
  busyAction: string | null;
}

export const TaskView: React.FC<TaskViewProps> = ({
  user,
  wallet,
  tasks,
  taskClaims,
  referrals,
  onClaimCheckIn,
  onClaimTask,
  onNavigateTab,
  onOpenUpgrade,
  onSyncServerWalletAndVip,
  busyAction,
}) => {
  const [localClaimedKeys, setLocalClaimedKeys] = useState<Record<string, boolean>>({});
  const [serverClaimedTaskIds, setServerClaimedTaskIds] = useState<string[]>([]);
  const inFlightClaimRef = useRef<Record<string, boolean>>({});

  // Server-backed Mission Status (APK + Telegram)
  const [apkDownloadUrl, setApkDownloadUrl] = useState<string>(
    DEFAULT_APK_DOWNLOAD_URL
  );
  const [apkMissionStatus, setApkMissionStatus] =
    useState<ApkMissionStatus>('NOT_STARTED');
  const [apkFeedback, setApkFeedback] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [isStartingApkDownload, setIsStartingApkDownload] =
    useState<boolean>(false);

  // Telegram Join Channel Verification State
  const [telegramChannelUrl, setTelegramChannelUrl] = useState<string>(
    DEFAULT_TELEGRAM_CHANNEL_URL
  );
  const [telegramUserIdInput, setTelegramUserIdInput] = useState<string>('');
  const [linkedTelegramUserId, setLinkedTelegramUserId] = useState<string>('');
  const [telegramUsernameInput, setTelegramUsernameInput] = useState<string>('');
  const [telegramVerified, setTelegramVerified] = useState<boolean>(false);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState<boolean>(false);
  const [isEditingTelegramId, setIsEditingTelegramId] = useState<boolean>(false);
  const [telegramFeedback, setTelegramFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Daily Event & VIP Status State
  const [featureStatus, setFeatureStatus] =
    useState<ServerFeatureStatusData | null>(null);
  const [showMysteryBoxModal, setShowMysteryBoxModal] =
    useState<boolean>(false);
  const [showLuckySpinModal, setShowLuckySpinModal] = useState<boolean>(false);
  const [showVipModal, setShowVipModal] = useState<boolean>(false);
  const [activeQrisImageUrl, setActiveQrisImageUrl] = useState<string | null>(
    null
  );
  const [isLoadingQris, setIsLoadingQris] = useState<boolean>(false);

  const fetchFeatureStatus = useCallback(async () => {
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
        onSyncServerWalletAndVip?.({
          coinBalance:
            typeof data.coinBalance === 'number' ? data.coinBalance : undefined,
          fireBalance:
            typeof data.fireBalance === 'number' ? data.fireBalance : undefined,
          isVip: Boolean(data.isVip),
          vipStatus: data.vipStatus,
          vipExpiresAt: data.vipExpiresAt || null,
        });
      }
    } catch {
      // ignore network error
    }
  }, [user.uid, onSyncServerWalletAndVip]);

  const fetchActiveQris = useCallback(async () => {
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

  const [cooldownTick, setCooldownTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const nextMb = featureStatus?.nextMysteryBoxAvailableAt
      ? new Date(featureStatus.nextMysteryBoxAvailableAt).getTime()
      : 0;
    const nextLs = featureStatus?.nextLuckySpinAvailableAt
      ? new Date(featureStatus.nextLuckySpinAvailableAt).getTime()
      : 0;
    if (nextMb <= Date.now() && nextLs <= Date.now()) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setCooldownTick(now);
      if (
        (nextMb > 0 &&
          now >= nextMb &&
          featureStatus?.mysteryBoxAvailable === false) ||
        (nextLs > 0 &&
          now >= nextLs &&
          featureStatus?.luckySpinAvailable === false)
      ) {
        void fetchFeatureStatus();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    featureStatus?.nextMysteryBoxAvailableAt,
    featureStatus?.nextLuckySpinAvailableAt,
    featureStatus?.mysteryBoxAvailable,
    featureStatus?.luckySpinAvailable,
    fetchFeatureStatus,
  ]);

  const isVipUser = Boolean(featureStatus?.isVip ?? user.isVip);
  const mbRemainingMs = getRemainingCooldownMs(
    featureStatus?.nextMysteryBoxAvailableAt,
    cooldownTick
  );
  const mysteryBoxReady = Boolean(
    featureStatus &&
      (featureStatus.mysteryBoxAvailable ||
        (Boolean(featureStatus.nextMysteryBoxAvailableAt) &&
          mbRemainingMs <= 0)) &&
      mbRemainingMs <= 0
  );

  const lsRemainingMs = getRemainingCooldownMs(
    featureStatus?.nextLuckySpinAvailableAt,
    cooldownTick
  );
  const luckySpinReady = Boolean(
    featureStatus &&
      (featureStatus.luckySpinAvailable ||
        (Boolean(featureStatus.nextLuckySpinAvailableAt) &&
          lsRemainingMs <= 0)) &&
      lsRemainingMs <= 0
  );

  const handleRefreshFeatures = useCallback(
    (updated?: Partial<ServerFeatureStatusData>) => {
      if (updated) {
        setFeatureStatus((prev) =>
          prev ? { ...prev, ...updated } : (updated as ServerFeatureStatusData)
        );
        if (
          typeof updated.coinBalance === 'number' ||
          typeof updated.fireBalance === 'number' ||
          typeof updated.isVip === 'boolean'
        ) {
          onSyncServerWalletAndVip?.({
            coinBalance: updated.coinBalance,
            fireBalance: updated.fireBalance,
            isVip: updated.isVip,
            vipStatus: updated.vipStatus,
            vipExpiresAt: updated.vipExpiresAt,
          });
        }
      }
      void fetchFeatureStatus();
    },
    [fetchFeatureStatus, onSyncServerWalletAndVip]
  );

  const fetchServerMissionStatus = useCallback(async () => {
    if (!user.uid) return;
    try {
      const res = await fetch(
        `/api/game/missions/status/${encodeURIComponent(user.uid)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.ok) return;

      if (data.apkDownloadUrl) {
        setApkDownloadUrl(String(data.apkDownloadUrl));
      }
      if (data.telegramChannelUrl) {
        setTelegramChannelUrl(String(data.telegramChannelUrl));
      }
      if (data.apkMissionStatus) {
        setApkMissionStatus(data.apkMissionStatus as ApkMissionStatus);
      }
      if (data.telegramUserId) {
        const cleanTgId = String(data.telegramUserId);
        setLinkedTelegramUserId(cleanTgId);
        setTelegramUserIdInput((prev) => prev || cleanTgId);
      }
      if (data.telegramUsername) {
        setTelegramUsernameInput((prev) => prev || String(data.telegramUsername));
      }
      if (data.telegramChannelVerified) {
        setTelegramVerified(true);
      }
      if (Array.isArray(data.claimedTaskIds)) {
        setServerClaimedTaskIds(data.claimedTaskIds);
      }
    } catch {
      // ignore offline status check
    }
  }, [user.uid]);

  useEffect(() => {
    void fetchServerMissionStatus();
  }, [fetchServerMissionStatus]);

  // Support deep-link callback verification if app is opened from native APK with ?apk_install_token=...&device_id=...
  useEffect(() => {
    if (typeof window === 'undefined' || !user.uid) return;
    const params = new URLSearchParams(window.location.search);
    const callbackToken =
      params.get('apk_install_token') || params.get('install_token') || '';
    const deviceId = params.get('device_id') || '';
    if (!callbackToken || !deviceId) return;

    fetch('/api/game/apk/verify-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: user.uid,
        installToken: callbackToken,
        deviceId,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ok && data.apkMissionStatus) {
          setApkMissionStatus(data.apkMissionStatus as ApkMissionStatus);
          setApkFeedback({
            type: 'success',
            text: 'Instalasi APK COINOVA terverifikasi! Silakan klaim hadiah +5.000 Koin.',
          });
        }
      })
      .catch(() => {});
  }, [user.uid]);

  const today = getTodayKey();
  const hasCheckedInToday = user.lastCheckInDate === today;
  const streakDays = Math.max(0, Number(user.dailyStreak || 0));

  const nextStreakDay = hasCheckedInToday
    ? Math.max(1, ((streakDays - 1 + 7) % 7) + 1)
    : (streakDays % 7) + 1;
  const todayCheckInReward =
    DAILY_CHECKIN_REWARDS.find((d) => d.day === nextStreakDay) ||
    DAILY_CHECKIN_REWARDS[0];

  // Merge persisted taskClaims, serverClaimedTaskIds, and localClaimedKeys
  const mergedTaskClaims: TaskClaim[] = [
    ...taskClaims,
    ...serverClaimedTaskIds.map((id) => ({
      claimId: `srv_${user.uid}_${id}`,
      uid: user.uid,
      taskId: id,
      taskTitle: id,
      coinReward: 0,
      fireReward: 0,
      idrReward: 0,
      claimedAt: new Date().toISOString(),
    })),
    ...Object.keys(localClaimedKeys)
      .filter((k) => localClaimedKeys[k])
      .map((k) => ({
        claimId: `local_${user.uid}_${k}`,
        uid: user.uid,
        taskId: k,
        taskTitle: k,
        coinReward: 0,
        fireReward: 0,
        idrReward: 0,
        claimedAt: new Date().toISOString(),
      })),
  ];

  const inviteMissionState = getProgressiveInviteMissionState(
    user.uid,
    referrals,
    mergedTaskClaims
  );

  const isTaskClaimed = (task: GameTask): boolean => {
    // Progressive Undang Teman advances to the next tier target automatically
    if (task.taskId === 'vp_invite_5') {
      return false;
    }
    const claimKey =
      task.category === 'DAILY' ? `${task.taskId}_${today}` : task.taskId;
    if (localClaimedKeys[claimKey]) return true;
    if (serverClaimedTaskIds.includes(task.taskId)) return true;
    if (task.taskId === 'vp_install_apk' && apkMissionStatus === 'CLAIMED') {
      return true;
    }
    if (task.category === 'DAILY') {
      return taskClaims.some(
        (c) =>
          c.uid === user.uid &&
          c.taskId === task.taskId &&
          (c.claimId.endsWith(`_${today}`) || isClaimedOnLocalToday(c.claimedAt))
      );
    }
    return taskClaims.some(
      (c) => c.uid === user.uid && c.taskId === task.taskId
    );
  };

  const getTaskProgress = (task: GameTask): number => {
    if (task.taskId === 'vp_join_channel') {
      return isTaskClaimed(task) || telegramVerified ? 1 : 0;
    }
    if (task.taskId === 'vp_install_apk') {
      if (isTaskClaimed(task) || apkMissionStatus === 'VERIFIED') return 1;
      return 0;
    }
    if (task.taskId === 'vp_level_bonus') {
      return user.dragonLevel >= 2 ? task.targetCount : user.dragonLevel;
    }
    if (task.taskId === 'vp_invite_5') {
      return inviteMissionState.validInviteCount;
    }
    if (task.taskId === 'vp_claims_2500') {
      return Math.max(
        user.dailyClaimsUsed ?? 0,
        Math.floor(user.totalTaps / 10)
      );
    }
    return 0;
  };

  const openExternalUrlSafely = (url: string) => {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      window.location.href = url;
    }
  };

  const handleInstallApkClick = async () => {
    if (isStartingApkDownload) return;
    setIsStartingApkDownload(true);
    setApkFeedback(null);
    try {
      const resp = await fetch('/api/game/apk/start-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid }),
      });
      const data = await resp.json().catch(() => null);
      const targetUrl =
        data?.downloadUrlWithCallback || data?.apkDownloadUrl || apkDownloadUrl;
      if (data?.apkMissionStatus) {
        setApkMissionStatus(data.apkMissionStatus as ApkMissionStatus);
      } else if (apkMissionStatus === 'NOT_STARTED') {
        setApkMissionStatus('WAITING_VERIFICATION');
      }
      openExternalUrlSafely(targetUrl);
      setApkFeedback({
        type: 'info',
        text: 'Status Misi: Menunggu Verifikasi. Silakan install dan buka aplikasi APK COINOVA untuk memverifikasi instalasi. Reward +5.000 Koin hanya diberikan 1x setelah instalasi terverifikasi.',
      });
    } catch {
      openExternalUrlSafely(apkDownloadUrl);
      setApkMissionStatus('WAITING_VERIFICATION');
      setApkFeedback({
        type: 'info',
        text: 'Status Misi: Menunggu Verifikasi instalasi dari aplikasi APK COINOVA.',
      });
    } finally {
      setIsStartingApkDownload(false);
    }
  };

  const handleCheckApkVerification = async (task: GameTask) => {
    setApkFeedback(null);
    try {
      const res = await fetch(
        `/api/game/missions/status/${encodeURIComponent(user.uid)}`
      );
      const data = await res.json().catch(() => null);
      if (data?.ok && data.apkMissionStatus) {
        setApkMissionStatus(data.apkMissionStatus as ApkMissionStatus);
        if (data.apkMissionStatus === 'VERIFIED') {
          await handleClaimClick(task);
          setApkFeedback({
            type: 'success',
            text: '✅ Instalasi APK terverifikasi! Reward +5.000 Koin berhasil diklaim.',
          });
          return;
        }
        if (data.apkMissionStatus === 'CLAIMED') {
          setServerClaimedTaskIds((prev) =>
            prev.includes('vp_install_apk') ? prev : [...prev, 'vp_install_apk']
          );
          return;
        }
      }
      setApkFeedback({
        type: 'info',
        text: 'Status masih Menunggu Verifikasi. Pastikan Anda telah meng-install dan membuka aplikasi APK COINOVA.',
      });
    } catch {
      setApkFeedback({
        type: 'error',
        text: 'Gagal memeriksa status verifikasi APK dari server.',
      });
    }
  };

  const handleLinkTelegramAccount = async (): Promise<string | null> => {
    const cleanId = telegramUserIdInput.trim().replace(/[^\d]/g, '');
    const cleanUsername = telegramUsernameInput
      .trim()
      .replace(/^@+/, '')
      .slice(0, 64);

    if (!/^\d{4,20}$/.test(cleanId)) {
      setTelegramFeedback({
        type: 'error',
        text: 'Masukkan Telegram User ID berupa angka (contoh: 123456789). Cek ID Telegram Anda melalui @userinfobot di Telegram.',
      });
      return null;
    }

    setIsLinkingTelegram(true);
    setTelegramFeedback(null);
    try {
      const resp = await fetch('/api/game/telegram/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          telegramUserId: cleanId,
          telegramUsername: cleanUsername,
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.ok) {
        setTelegramFeedback({
          type: 'error',
          text: data?.error || 'Gagal menghubungkan akun Telegram.',
        });
        return null;
      }
      setLinkedTelegramUserId(cleanId);
      setTelegramUserIdInput(cleanId);
      setIsEditingTelegramId(false);
      setTelegramFeedback({
        type: 'info',
        text: `Akun Telegram ID #${cleanId} terhubung. Pastikan sudah join channel lalu tekan tombol Claim / Verifikasi.`,
      });
      return cleanId;
    } catch {
      setTelegramFeedback({
        type: 'error',
        text: 'Gagal menghubungi server untuk menyimpan ID Telegram.',
      });
      return null;
    } finally {
      setIsLinkingTelegram(false);
    }
  };

  const handleVerifyAndClaimTelegram = async (task: GameTask) => {
    const claimKey = task.taskId;
    if (inFlightClaimRef.current[claimKey] || isTaskClaimed(task)) return;

    setTelegramFeedback(null);
    let activeTgId = linkedTelegramUserId;
    const candidateInputId = telegramUserIdInput.trim().replace(/[^\d]/g, '');

    if (candidateInputId && candidateInputId !== linkedTelegramUserId) {
      const linked = await handleLinkTelegramAccount();
      if (!linked) return;
      activeTgId = linked;
    }

    if (!/^\d{4,20}$/.test(activeTgId)) {
      setTelegramFeedback({
        type: 'error',
        text: 'Hubungkan akun Telegram Anda terlebih dahulu (masukkan angka Telegram User ID) sebelum menekan Claim / Verifikasi.',
      });
      return;
    }

    inFlightClaimRef.current[claimKey] = true;
    try {
      const res = await onClaimTask(task, {
        telegramUserId: activeTgId,
        telegramUsername: telegramUsernameInput.trim().replace(/^@+/, ''),
      });
      if (res && res.ok === false) {
        setTelegramFeedback({
          type: 'error',
          text:
            res.error ||
            '❌ Kamu belum bergabung ke channel Telegram. Bergabung terlebih dahulu lalu tekan Verifikasi.',
        });
        return;
      }
      setTelegramVerified(true);
      setLocalClaimedKeys((prev) => ({ ...prev, [claimKey]: true }));
      setServerClaimedTaskIds((prev) =>
        prev.includes(claimKey) ? prev : [...prev, claimKey]
      );
      setTelegramFeedback({
        type: 'success',
        text: '✅ Keanggotaan Telegram terverifikasi.',
      });
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : '❌ Kamu belum bergabung ke channel Telegram. Bergabung terlebih dahulu lalu tekan Verifikasi.';
      setTelegramFeedback({
        type: 'error',
        text: msg,
      });
    } finally {
      inFlightClaimRef.current[claimKey] = false;
    }
  };

  const handleClaimClick = async (task: GameTask) => {
    if (task.taskId === 'vp_join_channel') {
      await handleVerifyAndClaimTelegram(task);
      return;
    }

    if (task.taskId === 'vp_invite_5') {
      const tierClaimTaskId = inviteMissionState.claimTaskId;
      if (
        inFlightClaimRef.current[tierClaimTaskId] ||
        localClaimedKeys[tierClaimTaskId] ||
        serverClaimedTaskIds.includes(tierClaimTaskId) ||
        !inviteMissionState.canClaim
      ) {
        return;
      }
      inFlightClaimRef.current[tierClaimTaskId] = true;
      try {
        const res = await onClaimTask({
          ...task,
          taskId: tierClaimTaskId,
          title: `Undang Teman (${inviteMissionState.activeTarget}/${inviteMissionState.activeTarget})`,
          targetCount: inviteMissionState.activeTarget,
        });
        if (res && res.ok === false) {
          return;
        }
        setLocalClaimedKeys((prev) => ({ ...prev, [tierClaimTaskId]: true }));
        setServerClaimedTaskIds((prev) =>
          prev.includes(tierClaimTaskId) ? prev : [...prev, tierClaimTaskId]
        );
      } finally {
        inFlightClaimRef.current[tierClaimTaskId] = false;
      }
      return;
    }

    const claimKey =
      task.category === 'DAILY' ? `${task.taskId}_${today}` : task.taskId;
    if (inFlightClaimRef.current[claimKey] || isTaskClaimed(task)) return;
    inFlightClaimRef.current[claimKey] = true;
    try {
      const res = await onClaimTask(task);
      if (res && res.ok === false) {
        if (task.taskId === 'vp_install_apk' && res.error) {
          setApkFeedback({
            type: 'error',
            text: res.error,
          });
        }
        return;
      }
      setLocalClaimedKeys((prev) => ({ ...prev, [claimKey]: true }));
      setServerClaimedTaskIds((prev) =>
        prev.includes(task.taskId) ? prev : [...prev, task.taskId]
      );
      if (task.taskId === 'vp_install_apk') {
        setApkMissionStatus('CLAIMED');
      }
    } finally {
      inFlightClaimRef.current[claimKey] = false;
    }
  };

  // Ensure all required missions (including vp_install_apk) are present in the ordered list
  const orderedTaskIds = [
    'vp_join_channel',
    'vp_install_apk',
    'vp_level_bonus',
    'vp_invite_5',
    'vp_claims_2500',
  ];

  const beginnerTasks: GameTask[] = orderedTaskIds
    .map(
      (id) =>
        tasks.find((t) => t.taskId === id) ||
        DEFAULT_TASKS.find((t) => t.taskId === id)
    )
    .filter((t): t is GameTask => Boolean(t));

  return (
    <div className="coinova-hud-bg min-h-full w-full px-3.5 pt-3 pb-24 text-white select-none">
      {/* ====================================================================
          1. TOP HEADER BAR
         ==================================================================== */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateTab('HOME')}
            aria-label="Kembali ke Home"
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
              COINOVA MISSIONS
            </span>
            <h1 className="text-lg font-extrabold text-white">Task &amp; Misi</h1>
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

      {/* ====================================================================
          2. CHECK-IN HARIAN CARD (7 HARI FUTURISTIC GRID)
         ==================================================================== */}
      <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px]">
        <div className="flex items-center justify-between border-b border-[#FACC15]/20 bg-[#12110B] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#FFEA00]">◈</span>
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Check-In Harian
            </h2>
          </div>
          <p className="text-[11px] font-bold text-zinc-400">
            Telah Check-In:{' '}
            <span className="font-extrabold text-[#FFEA00]">
              {streakDays} Hari
            </span>
          </p>
        </div>

        <div className="p-3">
          <div className="grid grid-cols-4 gap-2">
            {DAILY_CHECKIN_REWARDS.slice(0, 6).map((item) => {
              const isChecked = item.day <= streakDays;
              const isNextClaimable =
                !hasCheckedInToday && item.day === streakDays + 1;
              const isDiamondReward = item.fire > 0 && item.coins === 0;
              const rewardText =
                item.day === 1
                  ? '+500'
                  : item.day === 2
                  ? '+1K'
                  : item.day === 3
                  ? '+2K'
                  : item.day === 4
                  ? '+2'
                  : item.day === 5
                  ? '+4K'
                  : '+5';

              return (
                <button
                  key={item.day}
                  type="button"
                  disabled={hasCheckedInToday || busyAction === 'checkin'}
                  onClick={() =>
                    onClaimCheckIn(
                      todayCheckInReward.coins,
                      todayCheckInReward.fire
                    )
                  }
                  className={`relative flex flex-col items-center justify-between rounded-2xl border p-2 transition ${
                    isChecked
                      ? 'border-[#FFEA00]/45 bg-[#18160C]'
                      : isNextClaimable
                      ? 'border-[#FFEA00] bg-[#221F0E] shadow-[0_0_14px_rgba(255,234,0,0.22)]'
                      : 'border-white/10 bg-[#0B0B0F]'
                  }`}
                >
                  <span className="text-[10.5px] font-bold text-zinc-300">
                    Hari {item.day}
                  </span>

                  <div className="relative my-1.5 flex h-7 w-7 items-center justify-center">
                    {isDiamondReward ? (
                      <NovaDiamondIcon className="h-6 w-6" />
                    ) : (
                      <NovaCoinIcon className="h-6 w-6" />
                    )}

                    {isChecked && (
                      <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                        <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[#FFEA00] text-[10px] font-black text-[#08080A]">
                          ✓
                        </span>
                      </span>
                    )}
                  </div>

                  <span className="font-mono-num text-[11px] font-extrabold text-[#FACC15]">
                    {rewardText}
                  </span>
                </button>
              );
            })}

            {/* Day 7 Wide Cyber Vault Card */}
            <button
              type="button"
              disabled={hasCheckedInToday || busyAction === 'checkin'}
              onClick={() =>
                onClaimCheckIn(
                  todayCheckInReward.coins,
                  todayCheckInReward.fire
                )
              }
              className="col-span-2 flex items-center justify-between rounded-2xl border border-[#FFEA00]/40 bg-gradient-to-r from-[#1A180C] to-[#0C0C10] px-3.5 py-2 text-left transition active:scale-[0.99]"
            >
              <div>
                <p className="text-[11px] font-bold text-zinc-300">Hari 7</p>
                <p className="font-mono-num mt-1 text-base font-extrabold text-[#FFEA00]">
                  +10K Koin
                </p>
              </div>
              <TreasureChestBlock className="h-12 w-12" />
            </button>
          </div>
        </div>
      </div>

      {/* ====================================================================
          2B. DAILY REWARD (MYSTERY BOX & LUCKY SPIN — SERVER COOLDOWN)
         ==================================================================== */}
      <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px]">
        <div className="flex items-center justify-between border-b border-[#FACC15]/20 bg-[#12110B] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#FFEA00]">🎁</span>
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Reward Harian
            </h2>
          </div>
          <span className="font-mono-num text-[10.5px] font-bold text-[#FFEA00]">
            {isVipUser ? '👑 Cooldown VIP: 18 Jam' : 'Cooldown Free: 24 Jam'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 p-3">
          {/* Mystery Box Card */}
          <div className="flex flex-col justify-between rounded-2xl border border-[#FACC15]/25 bg-[#0B0B0F] p-3">
            <div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-xl">🎁</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${
                    !featureStatus
                      ? 'border-white/15 bg-white/5 text-zinc-400'
                      : mysteryBoxReady
                      ? 'border-[#FFEA00]/50 bg-[#FFEA00]/15 text-[#FFEA00]'
                      : 'border-white/15 bg-white/5 text-zinc-400'
                  }`}
                >
                  {!featureStatus
                    ? 'Memuat'
                    : mysteryBoxReady
                    ? 'Tersedia'
                    : 'Cooldown'}
                </span>
              </div>
              <p className="mt-1.5 text-xs font-extrabold text-white">
                Mystery Box
              </p>
              <p className="mt-0.5 text-[10px] text-zinc-400">
                1x setiap {isVipUser ? '18 jam (VIP)' : '24 jam (Free)'}
              </p>
            </div>
            <button
              type="button"
              disabled={!featureStatus || !mysteryBoxReady}
              onClick={() => {
                if (!mysteryBoxReady) return;
                setShowMysteryBoxModal(true);
              }}
              className={`mt-2.5 w-full rounded-xl py-1.5 text-[10.5px] font-black uppercase tracking-wider transition ${
                mysteryBoxReady
                  ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A] shadow-[0_0_12px_rgba(255,234,0,0.28)] active:scale-95'
                  : 'cursor-not-allowed border border-white/10 bg-[#141418] text-zinc-400'
              }`}
            >
              {!featureStatus
                ? 'Memuat...'
                : mysteryBoxReady
                ? 'Buka Gratis'
                : `⏳ ${formatRemainingCooldown(
                    featureStatus.nextMysteryBoxAvailableAt,
                    cooldownTick
                  )}`}
            </button>
          </div>

          {/* Lucky Spin Card */}
          <div className="flex flex-col justify-between rounded-2xl border border-[#FACC15]/25 bg-[#0B0B0F] p-3">
            <div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-xl">🎡</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${
                    !featureStatus
                      ? 'border-white/15 bg-white/5 text-zinc-400'
                      : luckySpinReady
                      ? 'border-[#FFEA00]/50 bg-[#FFEA00]/15 text-[#FFEA00]'
                      : 'border-white/15 bg-white/5 text-zinc-400'
                  }`}
                >
                  {!featureStatus
                    ? 'Memuat'
                    : luckySpinReady
                    ? 'Tersedia'
                    : 'Cooldown'}
                </span>
              </div>
              <p className="mt-1.5 text-xs font-extrabold text-white">
                Lucky Spin
              </p>
              <p className="mt-0.5 text-[10px] text-zinc-400">
                1x setiap {isVipUser ? '18 jam (VIP)' : '24 jam (Free)'}
              </p>
            </div>
            <button
              type="button"
              disabled={!featureStatus || !luckySpinReady}
              onClick={() => {
                if (!luckySpinReady) return;
                setShowLuckySpinModal(true);
              }}
              className={`mt-2.5 w-full rounded-xl py-1.5 text-[10.5px] font-black uppercase tracking-wider transition ${
                luckySpinReady
                  ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A] shadow-[0_0_12px_rgba(255,234,0,0.28)] active:scale-95'
                  : 'cursor-not-allowed border border-white/10 bg-[#141418] text-zinc-400'
              }`}
            >
              {!featureStatus
                ? 'Memuat...'
                : luckySpinReady
                ? 'Spin Gratis'
                : `⏳ ${formatRemainingCooldown(
                    featureStatus.nextLuckySpinAvailableAt,
                    cooldownTick
                  )}`}
            </button>
          </div>
        </div>
      </div>

      {/* ====================================================================
          2C. SINGLE CONCISE & PREMIUM COINOVA VIP PASS CARD
         ==================================================================== */}
      <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px] border border-[#FFEA00]/45 bg-gradient-to-br from-[#17150A] via-[#0D0C08] to-[#09090C] p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm">👑</span>
              <h2 className="text-xs font-black uppercase tracking-wider text-[#FFEA00]">
                COINOVA VIP PASS
              </h2>
              {isVipUser ? (
                <span className="rounded bg-[#FFEA00] px-1.5 py-0.5 text-[9px] font-black uppercase text-[#08080A]">
                  ACTIVE
                </span>
              ) : (
                <span className="font-mono-num rounded border border-[#FFEA00]/40 bg-[#FFEA00]/10 px-1.5 py-0.5 text-[9.5px] font-extrabold text-[#FDE047]">
                  Rp100.000 / 30 Hari
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowVipModal(true)}
            className="shrink-0 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-3 py-1.5 text-[10.5px] font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_14px_rgba(255,234,0,0.3)] active:scale-95"
          >
            {isVipUser ? 'Detail VIP' : 'Upgrade VIP'}
          </button>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[10.5px] font-bold text-zinc-200">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0B0F]/90 px-2.5 py-1.5">
            <span>👑</span>
            <span className="truncate">VIP Badge &amp; Profil Eksklusif</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0B0F]/90 px-2.5 py-1.5">
            <span>⚡</span>
            <span className="truncate text-[#FFEA00]">+10% Bonus Coin Tap</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0B0F]/90 px-2.5 py-1.5">
            <span>💎</span>
            <span className="truncate text-[#FDE047]">+50 Diamond Bulanan</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0B0F]/90 px-2.5 py-1.5">
            <span>🚀</span>
            <span className="truncate">Prioritas Withdrawal</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0B0F]/90 px-2.5 py-1.5">
            <span>⏱️</span>
            <span className="truncate text-[#FDE047]">Cooldown Cepat: 18 Jam</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0B0B0F]/90 px-2.5 py-1.5">
            <span>🔥</span>
            <span className="truncate text-[#FFEA00]">+10% Reward Misi</span>
          </div>
        </div>
      </div>

      {/* ====================================================================
          3. TUGAS & MISI LIST (DARK FUTURISTIC CARDS + NEON PROGRESS BAR)
         ==================================================================== */}
      <div className="coinova-card mt-3.5 overflow-hidden rounded-[22px]">
        <div className="flex items-center justify-between border-b border-[#FACC15]/20 bg-[#12110B] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#FFEA00]">❖</span>
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Daftar Misi COINOVA
            </h2>
          </div>
          <span className="text-[10.5px] font-bold text-[#FACC15]">
            Aktif
          </span>
        </div>

        <div className="space-y-2.5 p-3">
          {beginnerTasks.map((task) => {
            const isInviteMission = task.taskId === 'vp_invite_5';
            const isTelegramMission = task.taskId === 'vp_join_channel';
            const isApkMission = task.taskId === 'vp_install_apk';

            const claimed = isTaskClaimed(task);
            const progress = getTaskProgress(task);
            const effectiveTarget = isInviteMission
              ? inviteMissionState.activeTarget
              : task.targetCount;
            const completed = isInviteMission
              ? inviteMissionState.canClaim
              : isTelegramMission
              ? claimed
              : isApkMission
              ? apkMissionStatus === 'VERIFIED'
              : progress >= effectiveTarget;
            const pct = isInviteMission
              ? inviteMissionState.progressPercent
              : Math.min(
                  100,
                  Math.max(
                    0,
                    Math.round((progress / Math.max(1, effectiveTarget)) * 100)
                  )
                );

            let displayTitle = task.title;
            if (isTelegramMission) {
              displayTitle = 'Bergabung Saluran COINOVA';
            } else if (isApkMission) {
              displayTitle = 'Install APK';
            } else if (task.taskId === 'vp_level_bonus') {
              displayTitle = 'Bonus Level (Pro)';
            } else if (isInviteMission) {
              displayTitle = 'UNDANG TEMAN';
            } else if (task.taskId === 'vp_claims_2500') {
              displayTitle = `Klaim 2500 Kali (${progress}/2500)`;
            }

            const isBusy =
              busyAction === `task_${task.taskId}` ||
              (isInviteMission &&
                busyAction === `task_${inviteMissionState.claimTaskId}`);

            return (
              <div
                key={task.taskId}
                className={`rounded-2xl border p-3 transition ${
                  claimed
                    ? 'border-[#FFEA00]/40 bg-[#15140B]'
                    : 'border-[#FACC15]/20 bg-[#0B0B0F]'
                }`}
              >
                <div className="flex items-center justify-between gap-2.5">
                  <GiftBoxTaskIcon className="h-11 w-11 shrink-0" />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-extrabold text-white">
                        {displayTitle}
                      </p>
                      {isInviteMission && (
                        <span className="shrink-0 rounded-md border border-[#FFEA00]/40 bg-[#FFEA00]/10 px-1.5 py-0.5 text-[9.5px] font-extrabold text-[#FFEA00]">
                          Target Bertingkat #{inviteMissionState.stepIndex + 1}
                        </span>
                      )}
                      {isApkMission && !claimed && (
                        <span
                          className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9.5px] font-extrabold ${
                            apkMissionStatus === 'VERIFIED'
                              ? 'border-[#FFEA00]/50 bg-[#FFEA00]/15 text-[#FFEA00]'
                              : apkMissionStatus === 'WAITING_VERIFICATION'
                              ? 'border-[#FACC15]/40 bg-[#FACC15]/10 text-[#FDE047]'
                              : 'border-white/15 bg-white/5 text-zinc-400'
                          }`}
                        >
                          {apkMissionStatus === 'VERIFIED'
                            ? 'Terverifikasi'
                            : apkMissionStatus === 'WAITING_VERIFICATION'
                            ? 'Menunggu Verifikasi'
                            : 'Aplikasi Android'}
                        </span>
                      )}
                    </div>

                    {isInviteMission && (
                      <p className="font-mono-num mt-0.5 text-[11.5px] font-extrabold text-zinc-200">
                        Progress:{' '}
                        <span className="text-[#FFEA00]">
                          {progress} / {effectiveTarget}
                        </span>
                        <span className="ml-2 text-[10px] font-semibold text-zinc-400">
                          (Berikutnya: {inviteMissionState.nextTarget})
                        </span>
                      </p>
                    )}

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {isInviteMission && (
                        <span className="text-[10.5px] font-bold text-zinc-400">
                          Reward:
                        </span>
                      )}
                      {task.coinReward > 0 && (
                        <span className="font-mono-num inline-flex items-center gap-1 rounded-full border border-[#FACC15]/30 bg-[#14130B] px-2.5 py-0.5 text-[10.5px] font-extrabold text-[#FACC15]">
                          <NovaCoinIcon className="h-3 w-3" />
                          +{task.coinReward.toLocaleString('id-ID')} Koin
                        </span>
                      )}
                      {task.fireReward > 0 && (
                        <span className="font-mono-num inline-flex items-center gap-1 rounded-full border border-[#FFEA00]/35 bg-[#14130B] px-2.5 py-0.5 text-[10.5px] font-extrabold text-[#FDE047]">
                          <NovaDiamondIcon className="h-3 w-3" />
                          +{task.fireReward} Diamond
                        </span>
                      )}
                      {(featureStatus?.isVip || user.isVip) && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#FFEA00]/45 bg-[#FFEA00]/15 px-2 py-0.5 text-[9.5px] font-black text-[#FFEA00]">
                          👑 +10% VIP
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status / Action Button */}
                  <div className="shrink-0">
                    {claimed ? (
                      <div className="flex items-center gap-1 rounded-full border border-[#FFEA00]/45 bg-[#FFEA00]/15 px-2.5 py-1 text-[11px] font-extrabold text-[#FFEA00]">
                        <span>✓</span>
                        <span>Selesai</span>
                      </div>
                    ) : isTelegramMission ? (
                      <button
                        type="button"
                        onClick={() => handleVerifyAndClaimTelegram(task)}
                        disabled={isBusy}
                        className="rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-3.5 py-1.5 text-[11px] font-black uppercase text-[#08080A] shadow-[0_0_14px_rgba(255,234,0,0.3)] active:scale-95 disabled:opacity-50"
                      >
                        {isBusy ? 'Verifikasi...' : 'Claim'}
                      </button>
                    ) : isApkMission ? (
                      apkMissionStatus === 'VERIFIED' ? (
                        <button
                          type="button"
                          onClick={() => handleClaimClick(task)}
                          disabled={isBusy}
                          className="rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-3.5 py-1.5 text-[11px] font-black uppercase text-[#08080A] shadow-[0_0_14px_rgba(255,234,0,0.3)] active:scale-95"
                        >
                          {isBusy ? 'Proses...' : 'Klaim'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleInstallApkClick}
                          disabled={isStartingApkDownload}
                          className="rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-3 py-1.5 text-[10.5px] font-black uppercase tracking-wide text-[#08080A] shadow-[0_0_14px_rgba(255,234,0,0.3)] active:scale-95"
                        >
                          {isStartingApkDownload ? 'Membuka...' : 'INSTALL APK'}
                        </button>
                      )
                    ) : completed ? (
                      <button
                        type="button"
                        onClick={() => handleClaimClick(task)}
                        disabled={isBusy}
                        className="rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-3.5 py-1.5 text-[11px] font-black uppercase text-[#08080A] shadow-[0_0_14px_rgba(255,234,0,0.3)] active:scale-95"
                      >
                        {isBusy ? 'Proses...' : 'Klaim'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (task.taskId === 'vp_invite_5') {
                            onNavigateTab('INVITE');
                          } else if (task.taskId === 'vp_level_bonus') {
                            onOpenUpgrade();
                          } else {
                            onNavigateTab('HOME');
                          }
                        }}
                        className="rounded-xl border border-[#FFEA00]/50 bg-[#18160C] px-3.5 py-1.5 text-[11px] font-extrabold text-[#FFEA00] active:scale-95"
                      >
                        {task.taskId === 'vp_invite_5'
                          ? 'Undang'
                          : 'Belum Selesai'}
                      </button>
                    )}
                  </div>
                </div>

                {/* ==============================================================
                    TELEGRAM CHANNEL JOIN + BOT API SERVER VERIFICATION PANEL
                   ============================================================== */}
                {isTelegramMission && !claimed && (
                  <div className="mt-2.5 space-y-2 rounded-xl border border-[#FACC15]/25 bg-[#07070A] p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <a
                        href={telegramChannelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#FFEA00]/45 bg-[#16140A] px-2.5 py-1.5 text-[11px] font-extrabold text-[#FFEA00] hover:bg-[#221F0E]"
                      >
                        <TelegramChannelIcon className="h-3.5 w-3.5" />
                        <span>1. Gabung @CoinovaOfficiall</span>
                      </a>

                      <a
                        href="https://t.me/userinfobot"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-bold text-zinc-400 underline hover:text-[#FFEA00]"
                      >
                        Cek ID Telegram (@userinfobot)
                      </a>
                    </div>

                    {linkedTelegramUserId && !isEditingTelegramId ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#0D0D12] px-2.5 py-1.5 text-[11px]">
                        <span className="font-mono-num text-zinc-300">
                          ID Telegram Terhubung:{' '}
                          <strong className="text-[#FFEA00]">
                            {linkedTelegramUserId}
                          </strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsEditingTelegramId(true)}
                          className="text-[10px] font-extrabold text-[#FACC15] underline"
                        >
                          Ubah ID
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={telegramUserIdInput}
                          onChange={(e) => {
                            setTelegramUserIdInput(
                              e.target.value.replace(/[^\d]/g, '')
                            );
                            setTelegramFeedback(null);
                          }}
                          placeholder="2. Masukkan User ID Telegram (contoh: 123456789)"
                          className="font-mono-num flex-1 rounded-lg border border-[#FACC15]/30 bg-[#0B0B0F] px-2.5 py-1.5 text-[11px] font-bold text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
                        />
                        <button
                          type="button"
                          onClick={() => void handleLinkTelegramAccount()}
                          disabled={isLinkingTelegram}
                          className="shrink-0 rounded-lg border border-[#FFEA00]/50 bg-[#18160C] px-2.5 py-1.5 text-[10.5px] font-extrabold text-[#FFEA00] active:scale-95"
                        >
                          {isLinkingTelegram ? '...' : 'Simpan ID'}
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="text-[10px] text-zinc-400">
                        Wajib bergabung ke channel sebelum menekan Verifikasi / Claim.
                      </span>
                      <button
                        type="button"
                        onClick={() => handleVerifyAndClaimTelegram(task)}
                        disabled={isBusy}
                        className="shrink-0 rounded-lg border border-[#FFEA00]/55 bg-[#FFEA00]/15 px-2.5 py-1 text-[10.5px] font-extrabold text-[#FFEA00] hover:bg-[#FFEA00]/25 active:scale-95"
                      >
                        {isBusy ? 'Memeriksa...' : 'Verifikasi'}
                      </button>
                    </div>

                    {telegramFeedback && (
                      <p
                        className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-extrabold ${
                          telegramFeedback.type === 'error'
                            ? 'border-red-400/45 bg-red-500/15 text-red-200'
                            : telegramFeedback.type === 'success'
                            ? 'border-[#FFEA00]/50 bg-[#FFEA00]/15 text-[#FFEA00]'
                            : 'border-[#FACC15]/35 bg-[#16140A] text-[#FDE047]'
                        }`}
                      >
                        {telegramFeedback.text}
                      </p>
                    )}
                  </div>
                )}

                {isTelegramMission && claimed && telegramFeedback?.type === 'success' && (
                  <p className="mt-2 rounded-lg border border-[#FFEA00]/50 bg-[#FFEA00]/15 px-2.5 py-1.5 text-[11px] font-extrabold text-[#FFEA00]">
                    {telegramFeedback.text}
                  </p>
                )}

                {/* ==============================================================
                    INSTALL APK STATUS & VERIFICATION PANEL
                   ============================================================== */}
                {isApkMission && !claimed && (
                  <div className="mt-2.5 space-y-2 rounded-xl border border-[#FACC15]/20 bg-[#07070A] p-2.5">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-zinc-300">
                        Status Misi:{' '}
                        <strong
                          className={
                            apkMissionStatus === 'VERIFIED'
                              ? 'text-[#FFEA00]'
                              : apkMissionStatus === 'WAITING_VERIFICATION'
                              ? 'text-[#FDE047]'
                              : 'text-zinc-400'
                          }
                        >
                          {apkMissionStatus === 'VERIFIED'
                            ? 'Terverifikasi (Siap Klaim)'
                            : apkMissionStatus === 'WAITING_VERIFICATION'
                            ? 'Menunggu Verifikasi'
                            : 'Belum Diunduh'}
                        </strong>
                      </span>

                      {apkMissionStatus === 'WAITING_VERIFICATION' && (
                        <button
                          type="button"
                          onClick={() => void handleCheckApkVerification(task)}
                          className="rounded-lg border border-[#FFEA00]/45 bg-[#16140A] px-2.5 py-1 text-[10px] font-extrabold text-[#FFEA00] active:scale-95"
                        >
                          Cek Verifikasi
                        </button>
                      )}
                    </div>

                    {apkFeedback && (
                      <p
                        className={`rounded-lg border px-2.5 py-1.5 text-[10.5px] font-bold ${
                          apkFeedback.type === 'error'
                            ? 'border-red-400/45 bg-red-500/15 text-red-200'
                            : apkFeedback.type === 'success'
                            ? 'border-[#FFEA00]/50 bg-[#FFEA00]/15 text-[#FFEA00]'
                            : 'border-[#FACC15]/35 bg-[#16140A] text-[#FDE047]'
                        }`}
                      >
                        {apkFeedback.text}
                      </p>
                    )}
                  </div>
                )}

                {/* Neon Highlighter Yellow Progress Bar */}
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#060608]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#EAB308] via-[#FACC15] to-[#FFEA00]"
                      style={{ width: `${claimed ? 100 : pct}%` }}
                    />
                  </div>
                  <span className="font-mono-num text-[10px] font-bold text-zinc-400">
                    {isInviteMission
                      ? `${progress}/${effectiveTarget} (${pct}%)`
                      : claimed
                      ? '100%'
                      : `${pct}%`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <CoinovaVipModal
        isOpen={showVipModal}
        onClose={() => setShowVipModal(false)}
        uid={user.uid}
        username={user.username}
        featureStatus={featureStatus}
        activeQrisImageUrl={activeQrisImageUrl}
        isLoadingQris={isLoadingQris}
        onRefreshFeatures={handleRefreshFeatures}
      />

      <MysteryBoxModal
        isOpen={showMysteryBoxModal}
        onClose={() => setShowMysteryBoxModal(false)}
        uid={user.uid}
        featureStatus={featureStatus}
        onRefreshFeatures={handleRefreshFeatures}
      />

      <LuckySpinModal
        isOpen={showLuckySpinModal}
        onClose={() => setShowLuckySpinModal(false)}
        uid={user.uid}
        featureStatus={featureStatus}
        onRefreshFeatures={handleRefreshFeatures}
      />
    </div>
  );
};
