import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from './lib/firebase';
import {
  AdminAuditLog,
  CreatorPlatform,
  CreatorStatus,
  CreatorSubmission,
  CurrencyType,
  DragonLevelConfig,
  EWalletMethod,
  GameSettings,
  GameTask,
  LevelUpgradeOrder,
  NavTab,
  NotificationItem,
  ReferralRecord,
  RewardCode,
  RewardCodeClaim,
  TaskClaim,
  UpgradePaymentMethod,
  UserAccount,
  UserProfile,
  UserWallet,
  WalletTransaction,
  WithdrawalRecord,
  WithdrawalStatus,
} from './types/dragon';
import {
  calculateCoinsFromIdr,
  calculateIdrFromCoins,
  calculateRequiredFireForWithdrawal,
  ECONOMY_CONFIG,
  getLevelEconomy,
  isTierEligibleForConversion,
  synchronizeWalletEconomy,
  VALID_WITHDRAW_COIN_TIERS,
  WITHDRAWAL_DIAMOND_MAP,
} from './config/economy';
import {
  createCleanUserSandboxState,
  createInitialSandboxState,
  DEFAULT_DRAGON_LEVELS,
  DEFAULT_GAME_SETTINGS,
  DEFAULT_TASKS,
  SandboxState,
} from './data/seedData';
import {
  adminAdjustWalletFirestore,
  adminProcessReferralFirestore,
  adminProcessWithdrawalFirestore,
  adminReviewCreatorSubmissionFirestore,
  adminReviewUpgradeOrderFirestore,
  adminSaveDragonLevelFirestore,
  adminSaveGameSettingsFirestore,
  adminSaveRewardCodeFirestore,
  adminSaveTaskFirestore,
  bindReferralCodeFirestore,
  bootstrapAuthenticatedUser,
  claimDailyCheckInFirestore,
  claimTaskRewardFirestore,
  commitTapBatchFirestore,
  confirmLevelUpgradePaymentFirestore,
  convertCoinToFireFirestore,
  createLevelUpgradeOrderFirestore,
  ensureGlobalCatalogSeeded,
  getTodayKey,
  isClaimedOnLocalToday,
  markNotificationReadFirestore,
  redeemRewardCodeFirestore,
  requestManualWithdrawalFirestore,
  submitCreatorContentFirestore,
  toIsoString,
  updateUserProfileFirestore,
  verifyAndClaimReferralFirestore,
} from './services/dragonService';
import { soundEngine } from './utils/sound';
import {
  BottomNavHomeIcon,
  BottomNavInviteIcon,
  BottomNavProfileIcon,
  BottomNavTaskIcon,
  BottomNavWithdrawIcon,
  CoinovaLogoMark,
  NovaDiamondIcon,
} from './components/GameIllustrations';
import { HomeView } from './components/HomeView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { TaskView } from './components/TaskView';
import { InviteView } from './components/InviteView';
import { WithdrawView } from './components/WithdrawView';
import { BugReportItem, ProfileView } from './components/ProfileView';
import { AdminDashboard, AdminSessionInfo } from './components/AdminDashboard';

const SANDBOX_STORAGE_KEY = 'coinova_sandbox_v13_prelaunch_reset';
const SHARE_COUNT_STORAGE_KEY = 'coinova_share_count_v2_prelaunch_reset';
const ADMIN_TOKEN_STORAGE_KEY = 'coinova_admin_session_v1';
const USER_SESSION_STORAGE_KEY = 'coinova_user_session_v2_prelaunch_reset';

function getSandboxStorageKeyForUser(uid?: string): string {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid || cleanUid === 'user_new_0') {
    return SANDBOX_STORAGE_KEY;
  }
  return `${SANDBOX_STORAGE_KEY}_${cleanUid}`;
}

function checkIsAdminUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const search = new URLSearchParams(window.location.search);
  return (
    path === '/admin' ||
    path.startsWith('/admin/') ||
    hash === '#admin' ||
    hash === '#/admin' ||
    search.get('portal') === 'admin'
  );
}

function loadPersistedSandbox(_targetUid?: string): SandboxState {
  // Production game state must always come from the authenticated server.
  // Do not restore coin/energy/reward state from localStorage.
  return createInitialSandboxState();
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('HOME');
  const [openUpgradeSignal, setOpenUpgradeSignal] = useState<number>(0);
  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => checkIsAdminUrl());
  const [adminSession, setAdminSession] = useState<AdminSessionInfo | null>(null);
  const [userSessionToken, setUserSessionToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem(USER_SESSION_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [isUserAuthenticated, setIsUserAuthenticated] = useState<boolean>(() => {
    try {
      return Boolean(sessionStorage.getItem(USER_SESSION_STORAGE_KEY));
    } catch {
      return false;
    }
  });
  // Existing sessions must hydrate from the server before the game dashboard can render.
  // This prevents a refresh from ever presenting the clean default (0 Coin/full Energy) as real state.
  const [isRestoringServerSession, setIsRestoringServerSession] = useState<boolean>(() => {
    try {
      return Boolean(sessionStorage.getItem(USER_SESSION_STORAGE_KEY));
    } catch {
      return false;
    }
  });
  const [serverSessionRestoreError, setServerSessionRestoreError] = useState<boolean>(false);
  const [authTab, setAuthTab] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [loginUsernameInput, setLoginUsernameInput] = useState<string>('');
  const [loginPasswordInput, setLoginPasswordInput] = useState<string>('');
  const [loginConfirmPasswordInput, setLoginConfirmPasswordInput] = useState<string>('');
  const [loginReferralInput, setLoginReferralInput] = useState<string>('');
  const [loginErrorText, setLoginErrorText] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState<boolean>(false);
  const [soundEnabled] = useState<boolean>(true);
  const [shareCount, setShareCount] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(SHARE_COUNT_STORAGE_KEY) || '0') || 0;
    } catch {
      return 0;
    }
  });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Firebase Auth & Sandbox State
  const [fbUser, setFbUser] = useState<User | null>(null);
  const [isSandboxMode, setIsSandboxMode] = useState<boolean>(true);
  const [sandbox, setSandbox] = useState<SandboxState>(() => loadPersistedSandbox());

  // Live Firestore State when authenticated
  const [cloudUser, setCloudUser] = useState<UserAccount | null>(null);
  const [cloudProfile, setCloudProfile] = useState<UserProfile | null>(null);
  const [cloudWallet, setCloudWallet] = useState<UserWallet | null>(null);
  const [cloudTasks, setCloudTasks] = useState<GameTask[]>([]);
  const [cloudClaims, setCloudClaims] = useState<TaskClaim[]>([]);
  const [cloudCodes, setCloudCodes] = useState<RewardCode[]>([]);
  const [cloudCodeClaims, setCloudCodeClaims] = useState<RewardCodeClaim[]>([]);
  const [cloudReferrals, setCloudReferrals] = useState<ReferralRecord[]>([]);
  const [cloudSubmissions, setCloudSubmissions] = useState<CreatorSubmission[]>([]);
  const [cloudWithdrawals, setCloudWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [cloudUpgradeOrders, setCloudUpgradeOrders] = useState<LevelUpgradeOrder[]>([]);
  const [cloudTransactions, setCloudTransactions] = useState<WalletTransaction[]>([]);
  const [cloudNotifications, setCloudNotifications] = useState<NotificationItem[]>([]);
  const [cloudLevels, setCloudLevels] = useState<DragonLevelConfig[]>([]);
  const [cloudSettings, setCloudSettings] = useState<GameSettings | null>(null);
  const [cloudAuditLogs] = useState<AdminAuditLog[]>([]);
  const [cloudAllUsers] = useState<
    { user: UserAccount; wallet: UserWallet; profile: UserProfile }[]
  >([]);

  // Tap batching buffer for Firestore rate-limiting
  const tapBufferRef = useRef<{
    taps: number;
    coins: number;
    fire: number;
    energy: number;
  }>({ taps: 0, coins: 0, fire: 0, energy: 0 });

  // Uncommitted local tap delta ref so App.tsx never re-renders on every individual tap
  const uncommittedTapRef = useRef<{
    taps: number;
    coins: number;
    energy: number;
  }>({
    taps: 0,
    coins: 0,
    energy: 0,
  });

  // Server /api/game/tap batched optimistic sync queue (prevents per-tap network lag)
  const pendingServerTapRef = useRef<{
    tapCount: number;
    optimisticCoinsAdded: number;
    optimisticEnergySpent: number;
    tapIntervals: number[];
  }>({
    tapCount: 0,
    optimisticCoinsAdded: 0,
    optimisticEnergySpent: 0,
    tapIntervals: [],
  });
  const tapSyncTimerRef = useRef<number | null>(null);
  const tapSyncInFlightRef = useRef<boolean>(false);
  const lastTapClientMsRef = useRef<number>(0);
  const liveEnergyRef = useRef<number>(sandbox.wallet.energy);
  const pendingChallengeResolversRef = useRef<
    Array<
      (
        challenge: {
          challengeId: string;
          question: string;
          rewardFire: number;
          expectedAnswer?: number;
        } | null
      ) => void
    >
  >([]);
  const latestSandboxRef = useRef<SandboxState>(sandbox);
  latestSandboxRef.current = sandbox;
  const sandboxPersistTimerRef = useRef<number | null>(null);

  // Anti double-execution locks
  const inFlightLocksRef = useRef<Record<string, boolean>>({});

  // Listen to URL changes for separate `/admin` or `#admin` portal access + APK callback token
  useEffect(() => {
    const syncRoute = () => {
      setIsAdminRoute(checkIsAdminUrl());
    };
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  // Automatic APK installation callback / deep-link verification (`?apk_verify_token=...`)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const token =
        params.get('apk_verify_token') ||
        params.get('installToken') ||
        params.get('apk_token') ||
        '';
      if (!token) return;
      const uid = (!isSandboxMode && cloudUser ? cloudUser.uid : sandbox.user.uid) || '';
      if (!uid) return;
      fetch('/api/game/apk/confirm-install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid,
          installToken: token,
          packageName: params.get('pkg') || 'id.coinova.app',
          appVersion: params.get('ver') || '1.0.0',
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.ok && data?.apkInstallVerified) {
            showNotice(
              'Instalasi APK COINOVA terverifikasi! Silakan klaim +5.000 Koin di menu Misi.',
              'success'
            );
            const cleanUrl = window.location.pathname + window.location.hash;
            window.history.replaceState({}, '', cleanUrl);
          }
        })
        .catch(() => {});
    } catch {
      // ignore URL parse errors
    }
  }, [isSandboxMode, cloudUser, sandbox.user.uid]);

  // Verify existing Admin Session Token with backend `/api/admin/session`
  useEffect(() => {
    const raw = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as AdminSessionInfo;
      if (!parsed?.token) return;
      fetch('/api/admin/session', {
        headers: { Authorization: `Bearer ${parsed.token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.ok && data?.admin?.role === 'ADMIN') {
            setAdminSession({
              uid: data.admin.uid,
              username: data.admin.username,
              role: 'ADMIN',
              token: parsed.token,
            });
          } else {
            sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
            setAdminSession(null);
          }
        })
        .catch(() => {
          sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
          setAdminSession(null);
        });
    } catch {
      sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    }
  }, []);

  // Wallet/energy/reward state is server-authoritative. Never persist it to localStorage.
  // localStorage remains reserved for non-authoritative UI preferences such as share count.

  const showNotice = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ text, type });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 3400);
  };

  const verifyAdminActionServerSide = async (actionName: string): Promise<boolean> => {
    if (!adminSession?.token || adminSession.role !== 'ADMIN') {
      showNotice('Akses ditolak: Sesi Admin tidak valid.', 'error');
      return false;
    }
    try {
      const resp = await fetch('/api/admin/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSession.token}`,
        },
        body: JSON.stringify({ action: actionName }),
      });
      if (!resp.ok) {
        sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
        setAdminSession(null);
        showNotice('Sesi Admin telah berakhir. Silakan login kembali.', 'error');
        return false;
      }
      return true;
    } catch {
      showNotice('Gagal memverifikasi otorisasi Admin ke server.', 'error');
      return false;
    }
  };

  const commitUncommittedTapsToState = useCallback(() => {
    const delta = uncommittedTapRef.current;
    if (delta.taps <= 0 && delta.coins <= 0 && delta.energy <= 0) return;
    uncommittedTapRef.current = { taps: 0, coins: 0, energy: 0 };
    const nowIso = new Date().toISOString();

    if (isSandboxMode) {
      setSandbox((prev) => {
        const nextCoins = prev.wallet.coinBalance + delta.coins;
        const nextEnergy = Math.max(0, prev.wallet.energy - delta.energy);
        const nextState: SandboxState = {
          ...prev,
          user: {
            ...prev.user,
            totalTaps: prev.user.totalTaps + delta.taps,
            updatedAt: nowIso,
          },
          wallet: {
            ...prev.wallet,
            coinBalance: nextCoins,
            idrBalance: calculateIdrFromCoins(nextCoins),
            energy: nextEnergy,
            totalEarnedCoins: prev.wallet.totalEarnedCoins + delta.coins,
            updatedAt: nowIso,
          },
        };
        latestSandboxRef.current = nextState;
        return nextState;
      });
    } else if (fbUser) {
      setCloudUser((prev) =>
        prev
          ? {
              ...prev,
              totalTaps: prev.totalTaps + delta.taps,
              updatedAt: nowIso,
            }
          : prev
      );
      setCloudWallet((prev) => {
        if (!prev) return prev;
        const nextCoins = prev.coinBalance + delta.coins;
        return {
          ...prev,
          coinBalance: nextCoins,
          idrBalance: calculateIdrFromCoins(nextCoins),
          energy: Math.max(0, prev.energy - delta.energy),
          totalEarnedCoins: prev.totalEarnedCoins + delta.coins,
          updatedAt: nowIso,
        };
      });
    }
  }, [isSandboxMode, fbUser]);

  const flushCloudTapBuffer = () => {
    commitUncommittedTapsToState();
    if (isSandboxMode || !fbUser) return;
    if (tapBufferRef.current.taps <= 0) return;
    const payload = { ...tapBufferRef.current };
    tapBufferRef.current = { taps: 0, coins: 0, fire: 0, energy: 0 };
    commitTapBatchFirestore(
      fbUser.uid,
      payload.taps,
      payload.coins,
      payload.fire,
      payload.energy
    ).catch((err) => console.error('Tap sync error:', err));
  };

  const handleOpenUpgradePage = useCallback(() => {
    commitUncommittedTapsToState();
    setActiveTab('HOME');
    setOpenUpgradeSignal((prev) => prev + 1);
  }, [commitUncommittedTapsToState]);

  const handleRecordShare = () => {
    setShareCount((prev) => {
      const next = prev + 1;
      try {
        localStorage.setItem(SHARE_COUNT_STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Active state selectors (Cloud vs Sandbox)
  const currentUser = !isSandboxMode && cloudUser ? cloudUser : sandbox.user;
  const currentProfile = !isSandboxMode && cloudProfile ? cloudProfile : sandbox.profile;
  const currentWallet = !isSandboxMode && cloudWallet ? cloudWallet : sandbox.wallet;
  useEffect(() => {
    liveEnergyRef.current = Math.max(
      0,
      currentWallet.energy - uncommittedTapRef.current.energy
    );
  }, [currentWallet.energy]);
  const currentSettings = !isSandboxMode && cloudSettings ? cloudSettings : sandbox.settings;
  const currentLevels = useMemo(
    () =>
      !isSandboxMode && cloudLevels.length > 0
        ? [...cloudLevels].sort((a, b) => a.level - b.level)
        : sandbox.levels,
    [isSandboxMode, cloudLevels, sandbox.levels]
  );
  const currentTasks = !isSandboxMode && cloudTasks.length > 0 ? cloudTasks : sandbox.tasks;
  const currentClaims = !isSandboxMode ? cloudClaims : sandbox.taskClaims;
  const currentCodes = !isSandboxMode && cloudCodes.length > 0 ? cloudCodes : sandbox.rewardCodes;
  const currentReferrals = !isSandboxMode ? cloudReferrals : sandbox.referrals;
  const currentSubmissions = !isSandboxMode ? cloudSubmissions : sandbox.creatorSubmissions;
  const currentWithdrawals = !isSandboxMode ? cloudWithdrawals : sandbox.withdrawals;
  const currentUpgradeOrders = !isSandboxMode ? cloudUpgradeOrders : sandbox.upgradeOrders;
  const currentTransactions = !isSandboxMode ? cloudTransactions : sandbox.transactions;
  const currentNotifications = !isSandboxMode ? cloudNotifications : sandbox.notifications;
  const currentAuditLogs = !isSandboxMode ? cloudAuditLogs : sandbox.auditLogs;

  const currentRewardCodeClaims: RewardCodeClaim[] = useMemo(
    () =>
      !isSandboxMode
        ? cloudCodeClaims
        : sandbox.claimedCodes.map((code) => ({
            claimId: `rc_${currentUser.uid}_${code}`,
            uid: currentUser.uid,
            code,
            coinReward: 0,
            fireReward: 0,
            idrReward: 0,
            claimedAt: '2026-01-01T00:00:00.000Z',
          })),
    [isSandboxMode, cloudCodeClaims, sandbox.claimedCodes, currentUser.uid]
  );

  // Verify existing User Session Token with backend `/api/auth/session`
  useEffect(() => {
    if (!userSessionToken) {
      setIsRestoringServerSession(false);
      setServerSessionRestoreError(false);
      return;
    }

    let cancelled = false;
    setIsRestoringServerSession(true);
    setServerSessionRestoreError(false);

    fetch('/api/auth/session', {
      headers: { Authorization: `Bearer ${userSessionToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ok && data?.user?.uid) {
          setIsUserAuthenticated(true);
          const persisted = loadPersistedSandbox(data.user.uid);
          setSandbox((prev) => {
            const base =
              prev.user.uid === data.user.uid
                ? prev
                : persisted.user.uid === data.user.uid
                ? persisted
                : createCleanUserSandboxState({
                    uid: data.user.uid,
                    username: data.user.username,
                    referralCode: data.user.referralCode,
                  });
            const srvCoins =
              typeof data.user.coinBalance === 'number'
                ? data.user.coinBalance
                : base.wallet.coinBalance;
            const srvEnergy =
              typeof data.user.energy === 'number'
                ? data.user.energy
                : base.wallet.energy;
            liveEnergyRef.current = srvEnergy;
            return {
              ...base,
              user: {
                ...base.user,
                uid: data.user.uid,
                username: data.user.username || base.user.username,
                referralCode: data.user.referralCode || base.user.referralCode,
                dragonLevel: Number(data.user.dragonLevel || base.user.dragonLevel || 1),
              },
              profile: {
                ...base.profile,
                uid: data.user.uid,
                fullName: base.profile.fullName || data.user.username || '',
              },
              wallet: {
                ...base.wallet,
                uid: data.user.uid,
                coinBalance: srvCoins,
                idrBalance: calculateIdrFromCoins(srvCoins),
                fireBalance:
                  typeof data.user.fireBalance === 'number'
                    ? data.user.fireBalance
                    : base.wallet.fireBalance,
                energy: srvEnergy,
                maxEnergy:
                  typeof data.user.maxEnergy === 'number'
                    ? data.user.maxEnergy
                    : base.wallet.maxEnergy,
              },
            };
          });
          if (!cancelled) {
            setServerSessionRestoreError(false);
            setIsRestoringServerSession(false);
          }
        } else if (data && data.ok === false) {
          sessionStorage.removeItem(USER_SESSION_STORAGE_KEY);
          setUserSessionToken('');
          setIsUserAuthenticated(false);
          if (!cancelled) setIsRestoringServerSession(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setServerSessionRestoreError(true);
          setIsRestoringServerSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userSessionToken]);

  // Full Authoritative User State Sync
  const syncAuthoritativeUserState = useCallback(async () => {
    if (
      tapSyncInFlightRef.current ||
      pendingServerTapRef.current.tapCount > 0 ||
      uncommittedTapRef.current.taps > 0 ||
      Date.now() - lastTapClientMsRef.current < 3000
    ) {
      return;
    }
    const targetUid = sandbox.user.uid;
    if (!targetUid || targetUid === 'user_new_0') return;
    try {
      const resp = await fetch(
        `/api/game/state?uid=${encodeURIComponent(targetUid)}&t=${Date.now()}`,
        {
          headers: userSessionToken
            ? { Authorization: `Bearer ${userSessionToken}` }
            : {},
          cache: 'no-store',
        }
      );
      if (!resp.ok) return;
      const data = await resp.json();
      if (
        tapSyncInFlightRef.current ||
        pendingServerTapRef.current.tapCount > 0 ||
        uncommittedTapRef.current.taps > 0 ||
        Date.now() - lastTapClientMsRef.current < 3000
      ) {
        return;
      }
      if (data?.ok && typeof data.energy === 'number') {
        setSandbox((prev) => {
          const srvUser = data.user || {};
          const srvWallet = data.wallet || {};
          const srvProfile = data.profile || {};

          const nextLevel = Math.max(
            1,
            Number(srvUser.dragonLevel || prev.user.dragonLevel || 1)
          );
          const nextClaims =
            typeof data.dailyClaimsUsed === 'number'
              ? data.dailyClaimsUsed
              : prev.user.dailyClaimsUsed;
          const nextMaxEnergy = Number(
            srvWallet.maxEnergy || data.maxEnergy || prev.wallet.maxEnergy
          );
          const nextVipStatus =
            srvUser.vipStatus || data.vipStatus || prev.user.vipStatus;
          const nextIsVip =
            typeof srvUser.isVip === 'boolean'
              ? srvUser.isVip
              : typeof data.isVip === 'boolean'
              ? data.isVip
              : prev.user.isVip;
          const nextVipExpiresAt =
            srvUser.vipExpiresAt !== undefined
              ? srvUser.vipExpiresAt
              : data.vipExpiresAt !== undefined
              ? data.vipExpiresAt
              : prev.user.vipExpiresAt;

          const nextCoinBalance =
            typeof srvWallet.coinBalance === 'number'
              ? srvWallet.coinBalance
              : prev.wallet.coinBalance;
          const nextFireBalance =
            typeof srvWallet.fireBalance === 'number'
              ? srvWallet.fireBalance
              : prev.wallet.fireBalance;
          const nextLockedIdr =
            typeof srvWallet.lockedIdrBalance === 'number'
              ? srvWallet.lockedIdrBalance
              : prev.wallet.lockedIdrBalance;
          const nextTotalWithdrawn =
            typeof srvWallet.totalWithdrawnIdr === 'number'
              ? srvWallet.totalWithdrawnIdr
              : prev.wallet.totalWithdrawnIdr;

          liveEnergyRef.current = data.energy;

          // Merge withdrawals from server so status changes (PENDING -> PROCESSING / PAID / REJECTED) appear immediately
          let nextWithdrawals = prev.withdrawals;
          if (Array.isArray(data.withdrawals)) {
            const wdMap = new Map<string, WithdrawalRecord>();
            prev.withdrawals.forEach((w) => {
              if (w?.withdrawalId) wdMap.set(w.withdrawalId, w);
            });
            data.withdrawals.forEach((sw: WithdrawalRecord) => {
              if (sw?.withdrawalId) wdMap.set(sw.withdrawalId, sw);
            });
            nextWithdrawals = Array.from(wdMap.values()).sort((a, b) =>
              String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
            );
          }

          let nextUpgradeOrders = prev.upgradeOrders;
          if (Array.isArray(data.upgradeOrders)) {
            const ordMap = new Map<string, LevelUpgradeOrder>();
            prev.upgradeOrders.forEach((o) => {
              if (o?.orderId) ordMap.set(o.orderId, o);
            });
            data.upgradeOrders.forEach((so: LevelUpgradeOrder) => {
              if (so?.orderId) ordMap.set(so.orderId, so);
            });
            nextUpgradeOrders = Array.from(ordMap.values()).sort((a, b) =>
              String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
            );
          }

          let nextReferrals = prev.referrals;
          if (Array.isArray(data.referrals)) {
            const refMap = new Map<string, ReferralRecord>();
            prev.referrals.forEach((r) => {
              if (r?.referralId) refMap.set(r.referralId, r);
            });
            data.referrals.forEach((sr: ReferralRecord) => {
              if (sr?.referralId) refMap.set(sr.referralId, sr);
            });
            nextReferrals = Array.from(refMap.values()).sort((a, b) =>
              String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
            );
          }

          let nextCreatorSubmissions = prev.creatorSubmissions;
          if (Array.isArray(data.creatorSubmissions)) {
            const subMap = new Map<string, CreatorSubmission>();
            prev.creatorSubmissions.forEach((s) => {
              if (s?.submissionId) subMap.set(s.submissionId, s);
            });
            data.creatorSubmissions.forEach((ss: CreatorSubmission) => {
              if (ss?.submissionId) subMap.set(ss.submissionId, ss);
            });
            nextCreatorSubmissions = Array.from(subMap.values()).sort((a, b) =>
              String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
            );
          }

          let nextTransactions = prev.transactions;
          if (Array.isArray(data.transactions) && data.transactions.length > 0) {
            const txMap = new Map<string, WalletTransaction>();
            prev.transactions.forEach((t) => {
              if (t?.id) txMap.set(t.id, t);
            });
            data.transactions.forEach((st: WalletTransaction) => {
              if (st?.id) txMap.set(st.id, st);
            });
            nextTransactions = Array.from(txMap.values())
              .sort((a, b) =>
                String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
              )
              .slice(0, 120);
          }

          return {
            ...prev,
            user: {
              ...prev.user,
              username: srvUser.username || prev.user.username,
              referralCode: srvUser.referralCode || prev.user.referralCode,
              referredByUid: srvUser.referredByUid ?? prev.user.referredByUid,
              dragonLevel: nextLevel,
              status: srvUser.status || prev.user.status,
              dailyStreak:
                typeof srvUser.dailyStreak === 'number'
                  ? srvUser.dailyStreak
                  : prev.user.dailyStreak,
              lastCheckInDate:
                srvUser.lastCheckInDate || prev.user.lastCheckInDate,
              dailyClaimsUsed: nextClaims,
              isVip: nextIsVip,
              vipStatus: nextVipStatus,
              vipStartedAt:
                srvUser.vipStartedAt || data.vipStartedAt || prev.user.vipStartedAt,
              vipExpiresAt: nextVipExpiresAt,
            },
            profile: {
              ...prev.profile,
              fullName: srvProfile.fullName || prev.profile.fullName,
              phone: srvProfile.phone || prev.profile.phone,
              defaultEwallet:
                srvProfile.defaultEwallet || prev.profile.defaultEwallet,
              ewalletNumber:
                srvProfile.ewalletNumber || prev.profile.ewalletNumber,
              ewalletAccountName:
                srvProfile.ewalletAccountName || prev.profile.ewalletAccountName,
            },
            wallet: {
              ...prev.wallet,
              coinBalance: nextCoinBalance,
              idrBalance: calculateIdrFromCoins(nextCoinBalance),
              fireBalance: nextFireBalance,
              lockedIdrBalance: nextLockedIdr,
              totalWithdrawnIdr: nextTotalWithdrawn,
              energy: data.energy,
              maxEnergy: nextMaxEnergy,
            },
            withdrawals: nextWithdrawals,
            upgradeOrders: nextUpgradeOrders,
            referrals: nextReferrals,
            creatorSubmissions: nextCreatorSubmissions,
            transactions: nextTransactions,
            levels:
              Array.isArray(data.levels) && data.levels.length > 0
                ? data.levels
                : prev.levels,
            tasks:
              Array.isArray(data.tasks) && data.tasks.length > 0
                ? data.tasks
                : prev.tasks,
            rewardCodes:
              Array.isArray(data.rewardCodes) && data.rewardCodes.length > 0
                ? data.rewardCodes
                : prev.rewardCodes,
            taskClaims: Array.isArray(data.state?.claimedTaskIds)
              ? (() => {
                  const claimMap = new Map<string, TaskClaim>();
                  prev.taskClaims.forEach((tc) => {
                    if (tc?.claimId) claimMap.set(tc.claimId, tc);
                  });
                  data.state.claimedTaskIds.forEach((rawId: string) => {
                    const cleanKey = String(rawId || '').trim();
                    if (!cleanKey) return;
                    const fullClaimId = cleanKey.startsWith('claim_')
                      ? cleanKey
                      : `claim_${prev.user.uid}_${cleanKey}`;
                    if (!claimMap.has(fullClaimId)) {
                      const baseTaskId = cleanKey.replace(/_\d{4}-\d{2}-\d{2}$/, '');
                      claimMap.set(fullClaimId, {
                        claimId: fullClaimId,
                        uid: prev.user.uid,
                        taskId: baseTaskId,
                        taskTitle: baseTaskId,
                        coinReward: 0,
                        fireReward: 0,
                        idrReward: 0,
                        claimedAt: srvUser.updatedAt || new Date().toISOString(),
                      });
                    }
                  });
                  return Array.from(claimMap.values());
                })()
              : prev.taskClaims,
            claimedCodes: Array.isArray(data.state?.claimedPromoCodes)
              ? Array.from(
                  new Set([
                    ...prev.claimedCodes,
                    ...data.state.claimedPromoCodes,
                  ])
                )
              : prev.claimedCodes,
            settings: data.settings
              ? { ...prev.settings, ...data.settings }
              : prev.settings,
          };
        });
      }
    } catch {
      // fallback passive tick if offline
    }
  }, [sandbox.user.uid, sandbox.user.dragonLevel, userSessionToken]);

  useEffect(() => {
    if (!isUserAuthenticated || !sandbox.user.uid || sandbox.user.uid === 'user_new_0') {
      return;
    }
    void syncAuthoritativeUserState();
    const interval = window.setInterval(() => {
      void syncAuthoritativeUserState();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [syncAuthoritativeUserState, activeTab, isUserAuthenticated, sandbox.user.uid]);

  // Auth listener: never create phantom "Member" accounts for anonymous sessions
  // and always use authoritative server state sync to prevent client Firestore 429 rate limits
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (u && u.isAnonymous) {
        await signOut(auth).catch(() => {});
        setFbUser(null);
        setIsSandboxMode(true);
        return;
      }
      setFbUser(null);
      setIsSandboxMode(true);
    });
    return () => unsubAuth();
  }, []);

  // Live Firestore Listeners when in Cloud mode
  useEffect(() => {
    if (isSandboxMode || !fbUser) return;
    const uid = fbUser.uid;
    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          if (!snap.exists()) return;
          const d = snap.data();
          setCloudUser({
            uid: d.uid,
            username: d.username,
            avatarUrl: d.avatarUrl || '',
            referralCode: d.referralCode,
            referredByUid: d.referredByUid,
            referredByCode: d.referredByCode,
            dragonLevel: d.dragonLevel,
            totalTaps: d.totalTaps,
            dailyStreak: d.dailyStreak,
            lastCheckInDate: d.lastCheckInDate,
            lastConvertDate: d.lastConvertDate || 'none',
            dailyConvertedFire: d.dailyConvertedFire || 0,
            cycleProgress: d.cycleProgress || 0,
            dailyClaimsUsed: d.dailyClaimsUsed || 0,
            lastClaimDate: d.lastClaimDate || getTodayKey(),
            role: d.role,
            status: d.status,
            createdAt: toIsoString(d.createdAt),
            updatedAt: toIsoString(d.updatedAt),
          });
        },
        (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`)
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'wallets', uid),
        (snap) => {
          if (!snap.exists()) return;
          const d = snap.data();
          const coins = Number(d.coinBalance || 0);
          setCloudWallet({
            uid: d.uid,
            coinBalance: coins,
            fireBalance: Number(d.fireBalance || 0),
            idrBalance: calculateIdrFromCoins(coins),
            lockedIdrBalance: Number(d.lockedIdrBalance || 0),
            energy: Number(d.energy || 0),
            maxEnergy: Number(d.maxEnergy || 100),
            totalEarnedCoins: Number(d.totalEarnedCoins || 0),
            totalEarnedFire: Number(d.totalEarnedFire || 0),
            totalWithdrawnIdr: Number(d.totalWithdrawnIdr || 0),
            updatedAt: toIsoString(d.updatedAt),
          });
        },
        (err) => handleFirestoreError(err, OperationType.GET, `wallets/${uid}`)
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'profiles', uid),
        (snap) => {
          if (!snap.exists()) return;
          const d = snap.data();
          setCloudProfile({
            uid: d.uid,
            email: d.email,
            fullName: d.fullName,
            phone: d.phone,
            defaultEwallet: d.defaultEwallet,
            ewalletNumber: d.ewalletNumber,
            ewalletAccountName: d.ewalletAccountName,
            pinHash: d.pinHash,
            notificationsEnabled: d.notificationsEnabled,
            updatedAt: toIsoString(d.updatedAt),
          });
        },
        (err) => handleFirestoreError(err, OperationType.GET, `profiles/${uid}`)
      )
    );

    unsubs.push(
      onSnapshot(collection(db, 'tasks'), (snap) => {
        const list: GameTask[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            taskId: d.taskId,
            title: d.title,
            description: d.description,
            category: d.category,
            targetCount: d.targetCount,
            metricType: d.metricType,
            coinReward: d.coinReward,
            fireReward: d.fireReward,
            idrReward: d.idrReward,
            isActive: d.isActive,
            updatedAt: toIsoString(d.updatedAt),
          };
        });
        if (list.length > 0) setCloudTasks(list);
      })
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'task_claims'), where('uid', '==', uid)),
        (snap) => {
          const list: TaskClaim[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              claimId: d.claimId,
              uid: d.uid,
              taskId: d.taskId,
              taskTitle: d.taskTitle,
              coinReward: d.coinReward,
              fireReward: d.fireReward,
              idrReward: d.idrReward,
              claimedAt: toIsoString(d.claimedAt),
            };
          });
          setCloudClaims(list);
        }
      )
    );

    unsubs.push(
      onSnapshot(collection(db, 'reward_codes'), (snap) => {
        const list: RewardCode[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            code: d.code,
            description: d.description,
            coinReward: d.coinReward,
            fireReward: d.fireReward,
            idrReward: d.idrReward,
            maxClaims: d.maxClaims,
            claimedCount: d.claimedCount,
            isActive: d.isActive,
            updatedAt: toIsoString(d.updatedAt),
          };
        });
        if (list.length > 0) setCloudCodes(list);
      })
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'reward_code_claims'), where('uid', '==', uid)),
        (snap) => {
          const list: RewardCodeClaim[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              claimId: d.claimId,
              uid: d.uid,
              code: d.code,
              coinReward: d.coinReward,
              fireReward: d.fireReward,
              idrReward: d.idrReward,
              claimedAt: toIsoString(d.claimedAt),
            };
          });
          setCloudCodeClaims(list);
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'referrals'), where('inviterUid', '==', uid)),
        (snap) => {
          const list: ReferralRecord[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              referralId: d.referralId,
              inviterUid: d.inviterUid,
              inviteeUid: d.inviteeUid,
              inviteeUsername: d.inviteeUsername,
              status: d.status,
              rewardCoin: d.rewardCoin,
              rewardFire: d.rewardFire,
              rewardIdr: d.rewardIdr,
              createdAt: toIsoString(d.createdAt),
              updatedAt: toIsoString(d.updatedAt),
            };
          });
          setCloudReferrals(list);
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'creator_submissions'), where('uid', '==', uid)),
        (snap) => {
          const list: CreatorSubmission[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              submissionId: d.submissionId,
              uid: d.uid,
              username: d.username,
              platform: d.platform,
              contentUrl: d.contentUrl,
              caption: d.caption,
              status: d.status,
              rewardCoin: d.rewardCoin,
              rewardFire: d.rewardFire,
              rewardIdr: d.rewardIdr,
              adminNote: d.adminNote || '',
              createdAt: toIsoString(d.createdAt),
              updatedAt: toIsoString(d.updatedAt),
            };
          });
          setCloudSubmissions(list);
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'withdrawals'), where('uid', '==', uid), limit(50)),
        (snap) => {
          const list: WithdrawalRecord[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              withdrawalId: d.withdrawalId,
              uid: d.uid,
              username: d.username,
              method: d.method,
              accountNumber: d.accountNumber,
              accountName: d.accountName,
              amount: d.amount,
              coinDeducted: d.coinDeducted || calculateCoinsFromIdr(d.amount),
              fireDeducted: d.fireDeducted || calculateRequiredFireForWithdrawal(d.amount),
              status: d.status,
              paymentReference: d.paymentReference || '',
              adminNote: d.adminNote || '',
              createdAt: toIsoString(d.createdAt),
              updatedAt: toIsoString(d.updatedAt),
            };
          });
          setCloudWithdrawals(
            list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          );
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'upgrade_orders'), where('uid', '==', uid), limit(40)),
        (snap) => {
          const list: LevelUpgradeOrder[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              orderId: d.orderId,
              uid: d.uid,
              username: d.username,
              targetLevel: d.targetLevel,
              levelName: d.levelName,
              priceIdr: d.priceIdr,
              paymentMethod: d.paymentMethod,
              paymentReference: d.paymentReference || '-',
              paymentProofDataUrl: d.paymentProofDataUrl || '',
              paymentProofFileName: d.paymentProofFileName || '',
              paidSubmittedAt: d.paidSubmittedAt ? toIsoString(d.paidSubmittedAt) : '',
              status: d.status,
              adminNote: d.adminNote || '',
              createdAt: toIsoString(d.createdAt),
              updatedAt: toIsoString(d.updatedAt),
            };
          });
          setCloudUpgradeOrders(
            list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          );
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'wallet_transactions'), where('uid', '==', uid), limit(80)),
        (snap) => {
          const list: WalletTransaction[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              uid: d.uid,
              category: d.category,
              direction: d.direction,
              currency: d.currency,
              amount: d.amount,
              description: d.description,
              referenceId: d.referenceId,
              createdAt: toIsoString(d.createdAt),
            };
          });
          setCloudTransactions(
            list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          );
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('uid', '==', uid), limit(40)),
        (snap) => {
          const list: NotificationItem[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              uid: d.uid,
              title: d.title,
              message: d.message,
              type: d.type,
              isRead: d.isRead,
              createdAt: toIsoString(d.createdAt),
              updatedAt: toIsoString(d.updatedAt),
            };
          });
          setCloudNotifications(
            list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          );
        }
      )
    );

    unsubs.push(
      onSnapshot(collection(db, 'levels'), (snap) => {
        const list: DragonLevelConfig[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            level: d.level,
            name: d.name,
            titleBadge: d.titleBadge,
            priceIdr: d.priceIdr || 0,
            requiredCoins: 0,
            requiredFire: 0,
            tapMultiplier: d.tapMultiplier,
            perClickCoins: d.perClickCoins,
            perCycleClaimCoins: d.perCycleClaimCoins,
            dailyClaimLimit: d.dailyClaimLimit,
            maxEnergy: d.maxEnergy,
            dailyFireBonus: d.dailyFireBonus,
            updatedAt: toIsoString(d.updatedAt),
          };
        });
        if (list.length > 0) setCloudLevels(list);
      })
    );

    unsubs.push(
      onSnapshot(doc(db, 'game_settings', 'global'), (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        setCloudSettings({
          settingId: 'global',
          coinsPerTap: d.coinsPerTap || DEFAULT_GAME_SETTINGS.coinsPerTap,
          energyCostPerTap: d.energyCostPerTap || DEFAULT_GAME_SETTINGS.energyCostPerTap,
          baseMaxEnergy: d.baseMaxEnergy || DEFAULT_GAME_SETTINGS.baseMaxEnergy,
          energyRegenPerMinute:
            d.energyRegenPerMinute ?? DEFAULT_GAME_SETTINGS.energyRegenPerMinute,
          coinToIdrRate: ECONOMY_CONFIG.COIN_TO_IDR_RATE,
          fireToIdrRate: ECONOMY_CONFIG.FIRE_TO_IDR_EQUIVALENT,
          coinsPerFireConvert:
            d.coinsPerFireConvert || ECONOMY_CONFIG.COINS_PER_FIRE_CONVERT,
          maxDailyFireConvert:
            d.maxDailyFireConvert || ECONOMY_CONFIG.MAX_DAILY_FIRE_CONVERT,
          fireDropChancePercent:
            d.fireDropChancePercent || ECONOMY_CONFIG.FIRE_DROP_CHANCE_PERCENT,
          referralRewardCoin:
            d.referralRewardCoin ?? DEFAULT_GAME_SETTINGS.referralRewardCoin,
          referralRewardFire:
            d.referralRewardFire ?? DEFAULT_GAME_SETTINGS.referralRewardFire,
          referralRewardIdr:
            d.referralRewardIdr ?? DEFAULT_GAME_SETTINGS.referralRewardIdr,
          minWithdrawIdr: ECONOMY_CONFIG.MIN_WITHDRAW_IDR,
          maintenanceMode: Boolean(d.maintenanceMode),
          announcementText: d.announcementText || DEFAULT_GAME_SETTINGS.announcementText,
          updatedAt: toIsoString(d.updatedAt),
        });
      })
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [isSandboxMode, fbUser]);

  // ============================================================================
  // CORE GAMEPLAY & WALLET HANDLERS (INSTANT OPTIMISTIC UI + BATCHED SERVER SYNC)
  // ============================================================================

  const flushServerTapQueue = useCallback(async (): Promise<void> => {
    if (tapSyncInFlightRef.current) return;
    if (pendingServerTapRef.current.tapCount <= 0) {
      commitUncommittedTapsToState();
      return;
    }

    if (tapSyncTimerRef.current) {
      window.clearTimeout(tapSyncTimerRef.current);
      tapSyncTimerRef.current = null;
    }

    // Commit accumulated local tap deltas once per batch before sending to server
    commitUncommittedTapsToState();

    const batch = {
      tapCount: pendingServerTapRef.current.tapCount,
      optimisticCoinsAdded: pendingServerTapRef.current.optimisticCoinsAdded,
      optimisticEnergySpent: pendingServerTapRef.current.optimisticEnergySpent,
      tapIntervals: [...pendingServerTapRef.current.tapIntervals],
    };
    pendingServerTapRef.current = {
      tapCount: 0,
      optimisticCoinsAdded: 0,
      optimisticEnergySpent: 0,
      tapIntervals: [],
    };

    const resolvers = pendingChallengeResolversRef.current.splice(0);
    const snap = latestSandboxRef.current;
    const uid = (!isSandboxMode && cloudUser ? cloudUser.uid : snap.user.uid) || 'guest';
    const dragonLevel =
      !isSandboxMode && cloudUser ? cloudUser.dragonLevel : snap.user.dragonLevel;
    const tapId = `tap_${uid}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    tapSyncInFlightRef.current = true;

    let spawnedChallenge: {
      challengeId: string;
      question: string;
      rewardFire: number;
      expectedAnswer?: number;
    } | null = null;

    try {
      const resp = await fetch('/api/game/tap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userSessionToken
            ? { Authorization: `Bearer ${userSessionToken}` }
            : {}),
        },
        body: JSON.stringify({
          uid,
          tapId,
          nonce: tapId,
          clientTimestamp: Date.now(),
          dragonLevel,
          tapCount: batch.tapCount,
          tapIntervals: batch.tapIntervals,
        }),
      });
      const data = await resp.json().catch(() => null);

      if (!resp.ok || !data || data.ok === false || data.allowed === false) {
        // Server rejected batch (e.g. energy depleted or rate-limited) -> rollback unconfirmed batch
        if (isSandboxMode) {
          const extraDelta = uncommittedTapRef.current;
          uncommittedTapRef.current = { taps: 0, coins: 0, energy: 0 };
          setSandbox((prev) => {
            const pendingCoins = pendingServerTapRef.current.optimisticCoinsAdded;
            const pendingEnergy = pendingServerTapRef.current.optimisticEnergySpent;
            const targetCoins =
              typeof data?.coinBalance === 'number'
                ? Math.max(0, Number(data.coinBalance) + pendingCoins)
                : Math.max(
                    0,
                    prev.wallet.coinBalance + extraDelta.coins - batch.optimisticCoinsAdded
                  );
            const targetEnergy =
              typeof data?.energyRemaining === 'number'
                ? Math.max(0, Number(data.energyRemaining) - pendingEnergy)
                : Math.max(0, prev.wallet.energy - extraDelta.energy);
            liveEnergyRef.current = targetEnergy;
            const nextState: SandboxState = {
              ...prev,
              user: {
                ...prev.user,
                totalTaps: Math.max(
                  0,
                  prev.user.totalTaps + extraDelta.taps - batch.tapCount
                ),
              },
              wallet: {
                ...prev.wallet,
                coinBalance: targetCoins,
                idrBalance: calculateIdrFromCoins(targetCoins),
                energy: targetEnergy,
              },
            };
            latestSandboxRef.current = nextState;
            return nextState;
          });
        }
        if (resp.status === 400 && data?.error) {
          showNotice(data.error, 'error');
        }
        return;
      }

      if (data.diamondChallenge && data.diamondChallenge.challengeId) {
        spawnedChallenge = {
          challengeId: String(data.diamondChallenge.challengeId),
          question: String(data.diamondChallenge.question),
          rewardFire: Math.max(1, Number(data.diamondChallenge.rewardFire || 1)),
        };
      }

      // Reconcile with authoritative server state + any new in-flight optimistic taps (prevents double counting)
      if (isSandboxMode) {
        const extraDelta = uncommittedTapRef.current;
        uncommittedTapRef.current = { taps: 0, coins: 0, energy: 0 };
        setSandbox((prev) => {
          const pendingCoins = pendingServerTapRef.current.optimisticCoinsAdded;
          const pendingEnergy = pendingServerTapRef.current.optimisticEnergySpent;
          const serverAwarded = Number(
            data.coinsAwarded ?? data.coinsEarned ?? batch.optimisticCoinsAdded
          );
          const coinDelta = serverAwarded - batch.optimisticCoinsAdded;

          const reconciledCoins =
            typeof data.coinBalance === 'number'
              ? Math.max(0, Number(data.coinBalance) + pendingCoins)
              : Math.max(0, prev.wallet.coinBalance + extraDelta.coins + coinDelta);

          const reconciledEnergy =
            typeof data.energyRemaining === 'number'
              ? Math.max(0, Number(data.energyRemaining) - pendingEnergy)
              : Math.max(0, prev.wallet.energy - extraDelta.energy);

          liveEnergyRef.current = reconciledEnergy;

          // Skip state update if optimistic values already match server authoritative values
          if (
            prev.wallet.coinBalance === reconciledCoins &&
            prev.wallet.energy === reconciledEnergy &&
            extraDelta.taps === 0
          ) {
            return prev;
          }

          const nextState: SandboxState = {
            ...prev,
            user:
              extraDelta.taps > 0
                ? {
                    ...prev.user,
                    totalTaps: prev.user.totalTaps + extraDelta.taps,
                  }
                : prev.user,
            wallet: {
              ...prev.wallet,
              coinBalance: reconciledCoins,
              idrBalance: calculateIdrFromCoins(reconciledCoins),
              energy: reconciledEnergy,
              maxEnergy: Number(data.maxEnergy || prev.wallet.maxEnergy),
            },
          };
          latestSandboxRef.current = nextState;
          return nextState;
        });
      }
    } catch {
      // Keep optimistic state if transient offline error
    } finally {
      tapSyncInFlightRef.current = false;
      for (const resolve of resolvers) {
        resolve(spawnedChallenge);
      }
      if (pendingServerTapRef.current.tapCount > 0) {
        tapSyncTimerRef.current = window.setTimeout(() => {
          void flushServerTapQueue();
        }, 250);
      }
    }
  }, [isSandboxMode, cloudUser, userSessionToken, commitUncommittedTapsToState]);

  const handleTapTrigger = useCallback(
    async (
      tapCount = 1
    ): Promise<{
      coins: number;
      fire: number;
      allowed: boolean;
      diamondChallenge?: {
        challengeId: string;
        question: string;
        rewardFire: number;
        expectedAnswer?: number;
      } | null;
    }> => {
      const nowMs = Date.now();
      const prevMs = lastTapClientMsRef.current;
      const deltaMs = prevMs > 0 ? nowMs - prevMs : 0;
      if (prevMs > 0 && deltaMs < 22) {
        return { coins: 0, fire: 0, allowed: false, diamondChallenge: null };
      }

      const snap = latestSandboxRef.current;
      const activeSettings =
        !isSandboxMode && cloudSettings ? cloudSettings : snap.settings;
      const activeUser = !isSandboxMode && cloudUser ? cloudUser : snap.user;
      const activeLevels =
        !isSandboxMode && cloudLevels.length > 0 ? cloudLevels : snap.levels;

      const energyNeeded = Math.max(
        1,
        activeSettings.energyCostPerTap * tapCount
      );

      if (liveEnergyRef.current < energyNeeded) {
        showNotice(
          'Core Energy habis. Upgrade level untuk mendapatkan kapasitas tap berikutnya.',
          'error'
        );
        return { coins: 0, fire: 0, allowed: false, diamondChallenge: null };
      }

      lastTapClientMsRef.current = nowMs;

      const levelCfg =
        activeLevels.find((l) => l.level === activeUser.dragonLevel) ||
        activeLevels[0];
      const levelEcon = getLevelEconomy(
        activeUser.dragonLevel,
        levelCfg,
        activeSettings
      );

      const coinsEarned = Math.max(1, levelEcon.coinsPerTap * tapCount);

      // 1. Play tap sound & deduct live energy ref immediately (0ms latency)
      liveEnergyRef.current = Math.max(0, liveEnergyRef.current - energyNeeded);
      if (soundEnabled) {
        soundEngine.playTap();
      }

      // 2. Buffer tap in lightweight local ref (avoids re-rendering 4,100-line App root on every tap)
      uncommittedTapRef.current.taps += tapCount;
      uncommittedTapRef.current.coins += coinsEarned;
      uncommittedTapRef.current.energy += energyNeeded;

      if (!isSandboxMode && fbUser) {
        tapBufferRef.current.taps += tapCount;
        tapBufferRef.current.coins += coinsEarned;
        tapBufferRef.current.energy += energyNeeded;

        if (tapBufferRef.current.taps >= 8) {
          flushCloudTapBuffer();
        }
      }

      // 3. Queue tap in server batch ref & schedule debounced server sync
      pendingServerTapRef.current.tapCount += tapCount;
      pendingServerTapRef.current.optimisticCoinsAdded += coinsEarned;
      pendingServerTapRef.current.optimisticEnergySpent += energyNeeded;
      if (deltaMs >= 25 && deltaMs < 1500) {
        pendingServerTapRef.current.tapIntervals.push(deltaMs);
        if (pendingServerTapRef.current.tapIntervals.length > 10) {
          pendingServerTapRef.current.tapIntervals.shift();
        }
      }

      const challengePromise = new Promise<{
        challengeId: string;
        question: string;
        rewardFire: number;
        expectedAnswer?: number;
      } | null>((resolve) => {
        pendingChallengeResolversRef.current.push(resolve);
      });

      if (tapSyncTimerRef.current) {
        window.clearTimeout(tapSyncTimerRef.current);
      }

      if (
        pendingServerTapRef.current.tapCount >= 10 &&
        !tapSyncInFlightRef.current
      ) {
        void flushServerTapQueue();
      } else {
        tapSyncTimerRef.current = window.setTimeout(() => {
          void flushServerTapQueue();
        }, 250);
      }

      const diamondChallenge = await challengePromise;
      return {
        coins: coinsEarned,
        fire: 0,
        allowed: true,
        diamondChallenge,
      };
    },
    [
      isSandboxMode,
      cloudSettings,
      cloudUser,
      cloudLevels,
      soundEnabled,
      fbUser,
      flushServerTapQueue,
    ]
  );

  const handleCompleteDiamondChallenge = async (
    challengeId: string,
    answer: string,
    fallbackExpectedAnswer?: number,
    fallbackRewardFire = 1
  ): Promise<{
    ok: boolean;
    correct: boolean;
    rewardFire: number;
    message: string;
  }> => {
    const lockKey = `dch_${challengeId}`;
    if (inFlightLocksRef.current[lockKey]) {
      return {
        ok: false,
        correct: false,
        rewardFire: 0,
        message: 'Challenge sedang diproses.',
      };
    }
    inFlightLocksRef.current[lockKey] = true;

    try {
      const resp = await fetch('/api/game/diamond-challenge/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userSessionToken ? { Authorization: `Bearer ${userSessionToken}` } : {}),
        },
        body: JSON.stringify({
          uid: currentUser.uid,
          challengeId,
          answer: answer.trim(),
        }),
      });
      const data = await resp.json();

      if (!resp.ok || data?.ok === false) {
        return {
          ok: false,
          correct: false,
          rewardFire: 0,
          message: data?.error || 'Jawaban salah. Diamond tidak didapat.',
        };
      }

      if (!data.correct) {
        return {
          ok: true,
          correct: false,
          rewardFire: 0,
          message: 'Jawaban salah. Diamond tidak didapat.',
        };
      }

      const awardedFire = Math.max(1, Math.floor(Number(data.rewardFire || fallbackRewardFire || 1)));
      const now = new Date().toISOString();

      if (soundEnabled) {
        soundEngine.playReward();
      }

      if (isSandboxMode) {
        setSandbox((prev) => ({
          ...prev,
          wallet: {
            ...prev.wallet,
            fireBalance: prev.wallet.fireBalance + awardedFire,
            totalEarnedFire: prev.wallet.totalEarnedFire + awardedFire,
            updatedAt: now,
          },
          transactions: [
            {
              id: `tx_dch_${Date.now()}`,
              uid: prev.user.uid,
              category: 'REWARD',
              direction: 'CREDIT',
              currency: 'FIRE',
              amount: awardedFire,
              description: `Bonus Diamond Challenge (+${awardedFire} Diamond 💎)`,
              referenceId: challengeId,
              createdAt: now,
            },
            ...prev.transactions,
          ],
        }));
      } else if (fbUser) {
        setCloudWallet((prev) =>
          prev
            ? {
                ...prev,
                fireBalance: prev.fireBalance + awardedFire,
                totalEarnedFire: prev.totalEarnedFire + awardedFire,
                updatedAt: now,
              }
            : prev
        );
        commitTapBatchFirestore(fbUser.uid, 1, 0, awardedFire, 0).catch(() => {});
      }

      showNotice(`Benar! +${awardedFire} Diamond 💎`, 'success');
      return {
        ok: true,
        correct: true,
        rewardFire: awardedFire,
        message: `Benar! +${awardedFire} Diamond 💎`,
      };
    } catch {
      const numericAns = Number(answer.trim());
      const isCorrect =
        fallbackExpectedAnswer !== undefined &&
        Number.isFinite(numericAns) &&
        numericAns === fallbackExpectedAnswer;
      if (!isCorrect) {
        return {
          ok: true,
          correct: false,
          rewardFire: 0,
          message: 'Jawaban salah. Diamond tidak didapat.',
        };
      }
      const awardedFire = Math.max(1, fallbackRewardFire);
      return {
        ok: true,
        correct: true,
        rewardFire: awardedFire,
        message: `Benar! +${awardedFire} Diamond 💎`,
      };
    }
  };

  const handleClaimCycleReward = (bonusCoins: number, bonusFire = 0) => {
    if (inFlightLocksRef.current.cycle_claim) return;

    const levelCfg =
      currentLevels.find((l) => l.level === currentUser.dragonLevel) ||
      currentLevels[0];
    const levelEcon = getLevelEconomy(
      currentUser.dragonLevel,
      levelCfg,
      currentSettings
    );
    const currentClaimsUsed = Math.max(0, Math.floor(Number(currentUser.dailyClaimsUsed ?? 0)));
    if (currentClaimsUsed >= levelEcon.dailyClaimsLimit) {
      showNotice(
        `Jatah klaim harian (${levelEcon.dailyClaimsLimit.toLocaleString('id-ID')} klaim/hari) telah tercapai. Naikkan Level atau lanjut besok!`,
        'error'
      );
      return;
    }

    inFlightLocksRef.current.cycle_claim = true;

    const cleanCoins = Math.max(0, Math.floor(bonusCoins));
    const cleanFire = Math.max(0, Math.floor(bonusFire));
    const now = new Date().toISOString();
    const cycleId = `cyc_${currentUser.uid}_${Date.now()}`;

    fetch('/api/game/claim-cycle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: currentUser.uid,
        cycleId,
        dragonLevel: currentUser.dragonLevel,
        claimsUsed: currentClaimsUsed,
      }),
    }).catch(() => {});

    if (soundEnabled) {
      soundEngine.playReward();
    }

    try {
      if (isSandboxMode) {
        setSandbox((prev) => {
          const nextCoins = prev.wallet.coinBalance + cleanCoins;
          const nextIdr = calculateIdrFromCoins(nextCoins);
          const prevUsed = Math.max(0, Math.floor(Number(prev.user.dailyClaimsUsed ?? 0)));
          return {
            ...prev,
            user: {
              ...prev.user,
              dailyClaimsUsed: prevUsed + 1,
              updatedAt: now,
            },
            wallet: {
              ...prev.wallet,
              coinBalance: nextCoins,
              idrBalance: nextIdr,
              fireBalance: prev.wallet.fireBalance + cleanFire,
              totalEarnedCoins: prev.wallet.totalEarnedCoins + cleanCoins,
              totalEarnedFire: prev.wallet.totalEarnedFire + cleanFire,
              updatedAt: now,
            },
            transactions: [
              {
                id: `tx_cyc_${Date.now()}`,
                uid: prev.user.uid,
                category: 'PENDAPATAN',
                direction: 'CREDIT',
                currency: 'COIN',
                amount: cleanCoins,
                description: `Klaim Siklus 10/10 Tap COINOVA (+${cleanCoins.toLocaleString('id-ID')} Koin / Rp${calculateIdrFromCoins(cleanCoins).toLocaleString('id-ID')} & +${cleanFire} Diamond)`,
                referenceId: cycleId,
                createdAt: now,
              },
              ...prev.transactions,
            ],
          };
        });
        showNotice(
          `Klaim Siklus 10/10 berhasil: +${cleanCoins.toLocaleString('id-ID')} Koin (Rp${calculateIdrFromCoins(cleanCoins).toLocaleString('id-ID')}) & +${cleanFire} Diamond!`,
          'success'
        );
      } else if (fbUser) {
        flushCloudTapBuffer();
        commitTapBatchFirestore(fbUser.uid, 1, cleanCoins, cleanFire, 0).catch(() => {});
        showNotice(
          `Klaim Siklus 10/10 berhasil: +${cleanCoins.toLocaleString('id-ID')} Koin (Rp${calculateIdrFromCoins(cleanCoins).toLocaleString('id-ID')}) & +${cleanFire} Diamond!`,
          'success'
        );
      }
    } finally {
      window.setTimeout(() => {
        inFlightLocksRef.current.cycle_claim = false;
      }, 600);
    }
  };

  const handleClaimCheckIn = async (rewardCoins: number, rewardFire: number) => {
    if (inFlightLocksRef.current.checkin) return;
    const today = getTodayKey();
    if (currentUser.lastCheckInDate === today) {
      showNotice('Anda sudah klaim Absensi Harian hari ini.', 'info');
      return;
    }

    inFlightLocksRef.current.checkin = true;
    setBusyAction('checkin');
    try {
      if (isSandboxMode) {
        const now = new Date().toISOString();
        const chkResp = await fetch('/api/game/claim-checkin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(userSessionToken ? { Authorization: `Bearer ${userSessionToken}` } : {}),
          },
          body: JSON.stringify({
            uid: currentUser.uid,
            coinReward: rewardCoins,
            fireReward: rewardFire,
          }),
        });
        const chkData = await chkResp.json().catch(() => null);
        if (!chkResp.ok || chkData?.ok === false) {
          showNotice(
            chkData?.error || 'Anda sudah klaim Absensi Harian hari ini.',
            'info'
          );
          return;
        }

        const nextStreak = Number(
          chkData?.streak || (currentUser.dailyStreak % 7) + 1
        );
        const awardedCoin = Number(chkData?.coinReward ?? rewardCoins);
        const awardedFire = Number(chkData?.fireReward ?? rewardFire);

        setSandbox((prev) => {
          const nextCoins =
            typeof chkData?.coinBalance === 'number'
              ? chkData.coinBalance
              : prev.wallet.coinBalance + awardedCoin;
          const nextFire =
            typeof chkData?.fireBalance === 'number'
              ? chkData.fireBalance
              : prev.wallet.fireBalance + awardedFire;
          return {
            ...prev,
            user: {
              ...prev.user,
              dailyStreak: nextStreak,
              lastCheckInDate: chkData?.lastCheckInDate || today,
              updatedAt: now,
            },
            wallet: {
              ...prev.wallet,
              coinBalance: nextCoins,
              idrBalance: calculateIdrFromCoins(nextCoins),
              fireBalance: nextFire,
              totalEarnedCoins: prev.wallet.totalEarnedCoins + awardedCoin,
              totalEarnedFire: prev.wallet.totalEarnedFire + awardedFire,
              updatedAt: now,
            },
            transactions: [
              {
                id: `tx_chk_${Date.now()}`,
                uid: prev.user.uid,
                category: 'REWARD',
                direction: 'CREDIT',
                currency: 'COIN',
                amount: awardedCoin,
                description: `Daily Check-In Hari ke-${nextStreak} (+${awardedCoin.toLocaleString('id-ID')} Koin & +${awardedFire} Diamond)`,
                referenceId: `checkin_${today}`,
                createdAt: now,
              },
              ...prev.transactions,
            ],
          };
        });
        if (soundEnabled) soundEngine.playReward();
        showNotice(
          `Check-In Hari ke-${nextStreak} berhasil: +${awardedCoin.toLocaleString('id-ID')} Koin & +${awardedFire} Diamond!`,
          'success'
        );
      } else if (fbUser) {
        const nextStreak = await claimDailyCheckInFirestore(
          fbUser.uid,
          rewardCoins,
          rewardFire
        );
        if (soundEnabled) soundEngine.playReward();
        showNotice(
          `Check-In Hari ke-${nextStreak} berhasil: +${rewardCoins.toLocaleString('id-ID')} Koin & +${rewardFire} Diamond!`,
          'success'
        );
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Gagal klaim absen harian.',
        'error'
      );
    } finally {
      inFlightLocksRef.current.checkin = false;
      setBusyAction(null);
    }
  };


  // ============================================================================
  // REAL-MONEY RUPIAH LEVEL UPGRADE PURCHASE FLOW (QRIS + BUKTI PEMBAYARAN)
  // ============================================================================
  const handleCreateUpgradeOrder = async (
    targetLevelCfg: DragonLevelConfig,
    paymentMethod: UpgradePaymentMethod
  ): Promise<LevelUpgradeOrder | void> => {
    if (inFlightLocksRef.current.upgrade_order) return;
    if (targetLevelCfg.level <= currentUser.dragonLevel) {
      showNotice(`Level ${targetLevelCfg.name} sudah aktif di akun Anda.`, 'info');
      return;
    }

    inFlightLocksRef.current.upgrade_order = true;
    setBusyAction('upgrade_order');
    try {
      const resp = await fetch('/api/game/validate-upgrade-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: currentUser.uid,
          targetLevel: targetLevelCfg.level,
          currentLevel: currentUser.dragonLevel,
          paymentMethod,
        }),
      });
      const validated = await resp.json();
      if (!resp.ok || !validated?.ok) {
        throw new Error(validated?.error || 'Gagal memvalidasi order pembelian level.');
      }

      const verifiedPriceIdr = Number(
        validated.verifiedPriceIdr || targetLevelCfg.priceIdr || 25000
      );

      if (isSandboxMode) {
        const now = new Date().toISOString();
        const orderId = `ord_lvl${targetLevelCfg.level}_${Date.now()}`;
        const newOrder: LevelUpgradeOrder = {
          orderId,
          uid: currentUser.uid,
          username: currentUser.username,
          targetLevel: targetLevelCfg.level,
          levelName: targetLevelCfg.name,
          priceIdr: verifiedPriceIdr,
          paymentMethod,
          paymentReference: '-',
          paymentProofDataUrl: '',
          paymentProofFileName: '',
          paidSubmittedAt: '',
          status: 'WAITING_PAYMENT',
          adminNote: `PENDING PAYMENT — Silakan scan QRIS Rp${verifiedPriceIdr.toLocaleString('id-ID')} dan unggah bukti pembayaran.`,
          createdAt: now,
          updatedAt: now,
        };

        setSandbox((prev) => ({
          ...prev,
          upgradeOrders: [newOrder, ...prev.upgradeOrders],
        }));
        showNotice(
          `Order Lv.${targetLevelCfg.level} (${targetLevelCfg.name}) Rp${verifiedPriceIdr.toLocaleString('id-ID')} berhasil dibuat. Silakan scan QRIS & unggah bukti bayar.`,
          'info'
        );
        return newOrder;
      } else if (fbUser) {
        flushCloudTapBuffer();
        const created = await createLevelUpgradeOrderFirestore(
          fbUser.uid,
          currentUser.username,
          { ...targetLevelCfg, priceIdr: verifiedPriceIdr },
          paymentMethod
        );
        showNotice(
          `Order Lv.${targetLevelCfg.level} (${targetLevelCfg.name}) Rp${verifiedPriceIdr.toLocaleString('id-ID')} berhasil dibuat.`,
          'info'
        );
        return created;
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Gagal membuat order upgrade level.',
        'error'
      );
    } finally {
      inFlightLocksRef.current.upgrade_order = false;
      setBusyAction(null);
    }
  };

  const handleConfirmUpgradePayment = async (
    orderId: string,
    paymentReference: string,
    paymentProofDataUrl?: string,
    paymentProofFileName?: string
  ): Promise<void> => {
    if (inFlightLocksRef.current.confirm_order) return;
    if (!paymentProofDataUrl || !paymentProofDataUrl.startsWith('data:image/')) {
      showNotice('Wajib mengunggah screenshot / foto bukti pembayaran QRIS.', 'error');
      return;
    }

    inFlightLocksRef.current.confirm_order = true;
    setBusyAction('confirm_order');
    try {
      const resp = await fetch('/api/game/submit-upgrade-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: currentUser.uid,
          orderId,
          paymentReference: paymentReference.trim() || `QRIS-${Date.now().toString().slice(-6)}`,
          paymentProofDataUrl,
          paymentProofFileName: paymentProofFileName || 'bukti_qris.jpg',
        }),
      });
      const validated = await resp.json();
      if (!resp.ok || !validated?.ok) {
        throw new Error(validated?.error || 'Bukti pembayaran tidak valid.');
      }

      const cleanRef = validated.paymentReference;
      const submittedAt = validated.paidSubmittedAt || new Date().toISOString();

      if (isSandboxMode) {
        const now = new Date().toISOString();
        setSandbox((prev) => ({
          ...prev,
          upgradeOrders: prev.upgradeOrders.map((o) =>
            o.orderId === orderId
              ? {
                  ...o,
                  paymentReference: cleanRef,
                  paymentProofImage: paymentProofDataUrl,
                  paymentProofDataUrl,
                  paymentProofFileName: paymentProofFileName || 'bukti_qris.jpg',
                  paidSubmittedAt: submittedAt,
                  status: 'PENDING_VERIFICATION',
                  adminNote: `PAYMENT SUBMITTED / UNDER REVIEW — Bukti pembayaran (${cleanRef}) sedang diverifikasi Admin.`,
                  updatedAt: now,
                }
              : o
          ),
          notifications: [
            {
              id: `notif_ord_${Date.now()}`,
              uid: prev.user.uid,
              title: 'Bukti Pembayaran Upgrade Terkirim',
              message: `Order #${orderId.slice(-8).toUpperCase()} sedang dalam peninjauan Admin (UNDER REVIEW). Level akan aktif setelah disetujui.`,
              type: 'INFO',
              isRead: false,
              createdAt: now,
              updatedAt: now,
            },
            ...prev.notifications,
          ],
        }));
        showNotice(
          'Bukti pembayaran berhasil dikirim! Status: PAYMENT SUBMITTED / UNDER REVIEW.',
          'success'
        );
      } else if (fbUser) {
        await confirmLevelUpgradePaymentFirestore(
          fbUser.uid,
          orderId,
          cleanRef,
          paymentProofDataUrl
        );
        showNotice(
          'Bukti pembayaran berhasil dikirim! Status: PAYMENT SUBMITTED / UNDER REVIEW.',
          'success'
        );
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Gagal mengirim bukti pembayaran.',
        'error'
      );
    } finally {
      inFlightLocksRef.current.confirm_order = false;
      setBusyAction(null);
    }
  };

  const handleClaimTask = async (
    task: GameTask,
    extraPayload?: { telegramUserId?: string; telegramUsername?: string }
  ): Promise<{
    ok: boolean;
    error?: string;
    rewardCoins?: number;
    message?: string;
  }> => {
    const today = getTodayKey();
    const lockKey = `task_${task.taskId}`;
    if (inFlightLocksRef.current[lockKey]) {
      return {
        ok: false,
        error: 'Permintaan klaim misi sedang diproses. Harap tunggu.',
      };
    }

    const alreadyClaimed = currentClaims.some((c) => {
      if (c.uid !== currentUser.uid || c.taskId !== task.taskId) return false;
      if (task.category === 'DAILY') {
        return c.claimId.endsWith(`_${today}`) || isClaimedOnLocalToday(c.claimedAt);
      }
      return true;
    });

    if (alreadyClaimed) {
      showNotice('Misi ini sudah diklaim.', 'info');
      return {
        ok: false,
        error: 'Misi ini sudah pernah diklaim sebelumnya.',
      };
    }

    inFlightLocksRef.current[lockKey] = true;
    setBusyAction(lockKey);
    try {
      // Mandatory Server-Side Verification & Anti-Double-Claim Check
      const resp = await fetch('/api/game/claim-task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userSessionToken ? { Authorization: `Bearer ${userSessionToken}` } : {}),
        },
        body: JSON.stringify({
          uid: currentUser.uid,
          taskId: task.taskId,
          targetMilestone: task.taskId.startsWith('vp_invite_5_')
            ? task.targetCount
            : 0,
          telegramUserId: extraPayload?.telegramUserId,
          telegramUsername: extraPayload?.telegramUsername,
        }),
      });
      const serverData = await resp.json().catch(() => null);

      if (!resp.ok || !serverData || serverData.ok === false) {
        const errMsg =
          serverData?.error || 'Gagal memverifikasi penyelesaian misi di server.';
        showNotice(errMsg, 'error');
        return {
          ok: false,
          error: errMsg,
        };
      }

      // Use authoritative reward amounts from server config
      const authoritativeCoins =
        typeof serverData.rewardCoins === 'number'
          ? Math.max(0, Number(serverData.rewardCoins))
          : task.coinReward +
            (task.idrReward > 0 ? calculateCoinsFromIdr(task.idrReward) : 0);
      const authoritativeFire =
        typeof serverData.rewardFire === 'number'
          ? Math.max(0, Number(serverData.rewardFire))
          : task.fireReward;

      if (isSandboxMode) {
        const now = new Date().toISOString();
        const periodSuffix = task.category === 'DAILY' ? `_${today}` : '';
        const claimId =
          String(serverData.claimKey || '') ||
          `claim_${currentUser.uid}_${task.taskId}${periodSuffix}`;
        const newClaim: TaskClaim = {
          claimId,
          uid: currentUser.uid,
          taskId: task.taskId,
          taskTitle: task.title,
          coinReward: authoritativeCoins,
          fireReward: authoritativeFire,
          idrReward: 0,
          claimedAt: now,
        };

        setSandbox((prev) => {
          // Double check idempotency inside state reducer
          if (
            prev.taskClaims.some(
              (c) =>
                c.claimId === newClaim.claimId ||
                (task.category !== 'DAILY' &&
                  c.uid === prev.user.uid &&
                  c.taskId === task.taskId)
            )
          ) {
            return prev;
          }
          const nextCoins =
            typeof serverData.coinBalance === 'number'
              ? Math.max(prev.wallet.coinBalance + authoritativeCoins, Number(serverData.coinBalance))
              : prev.wallet.coinBalance + authoritativeCoins;
          const nextFire =
            typeof serverData.fireBalance === 'number'
              ? Math.max(prev.wallet.fireBalance + authoritativeFire, Number(serverData.fireBalance))
              : prev.wallet.fireBalance + authoritativeFire;
          return {
            ...prev,
            wallet: {
              ...prev.wallet,
              coinBalance: nextCoins,
              idrBalance: calculateIdrFromCoins(nextCoins),
              fireBalance: nextFire,
              totalEarnedCoins: prev.wallet.totalEarnedCoins + authoritativeCoins,
              totalEarnedFire: prev.wallet.totalEarnedFire + authoritativeFire,
              updatedAt: now,
            },
            taskClaims: [newClaim, ...prev.taskClaims],
            transactions: [
              {
                id: `tx_tsk_${Date.now()}`,
                uid: prev.user.uid,
                category: 'TASK',
                direction: 'CREDIT',
                currency: 'COIN',
                amount: authoritativeCoins,
                description: `Klaim Misi: ${task.title} (+${authoritativeCoins.toLocaleString('id-ID')} Koin${authoritativeFire > 0 ? ` & +${authoritativeFire} Diamond` : ''})`,
                referenceId: newClaim.claimId,
                createdAt: now,
              },
              ...prev.transactions,
            ],
          };
        });
        if (soundEnabled) soundEngine.playReward();
        const successMsg =
          serverData.message ||
          `Misi "${task.title}" selesai! +${authoritativeCoins.toLocaleString('id-ID')} Koin${authoritativeFire > 0 ? ` & +${authoritativeFire} Diamond` : ''}.`;
        showNotice(successMsg, 'success');
        return {
          ok: true,
          rewardCoins: authoritativeCoins,
          message: successMsg,
        };
      } else if (fbUser) {
        flushCloudTapBuffer();
        await claimTaskRewardFirestore(fbUser.uid, {
          ...task,
          coinReward: authoritativeCoins,
          fireReward: authoritativeFire,
          idrReward: 0,
        });
        if (soundEnabled) soundEngine.playReward();
        const successMsg =
          serverData.message || `Misi "${task.title}" berhasil diklaim!`;
        showNotice(successMsg, 'success');
        return {
          ok: true,
          rewardCoins: authoritativeCoins,
          message: successMsg,
        };
      }
      return { ok: true, rewardCoins: authoritativeCoins };
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Gagal mengklaim hadiah misi.';
      showNotice(errMsg, 'error');
      return {
        ok: false,
        error: errMsg,
      };
    } finally {
      inFlightLocksRef.current[lockKey] = false;
      setBusyAction(null);
    }
  };

  const handleServerFeatureSync = useCallback(
    (payload: {
      coinBalance?: number;
      fireBalance?: number;
      isVip?: boolean;
      vipStatus?: 'NONE' | 'PENDING' | 'ACTIVE' | 'EXPIRED';
      vipStartedAt?: string | null;
      vipExpiresAt?: string | null;
      noticeText?: string;
    }) => {
      const now = new Date().toISOString();
      const inFlightTapCoins =
        uncommittedTapRef.current.coins +
        pendingServerTapRef.current.optimisticCoinsAdded;
      setSandbox((prev) => {
        const nextCoins =
          typeof payload.coinBalance === 'number'
            ? Math.max(0, payload.coinBalance + inFlightTapCoins)
            : prev.wallet.coinBalance;
        const nextFire =
          typeof payload.fireBalance === 'number'
            ? Math.max(0, payload.fireBalance)
            : prev.wallet.fireBalance;
        return {
          ...prev,
          user: {
            ...prev.user,
            isVip:
              typeof payload.isVip === 'boolean' ? payload.isVip : prev.user.isVip,
            vipStatus: payload.vipStatus || prev.user.vipStatus,
            vipStartedAt:
              payload.vipStartedAt !== undefined
                ? payload.vipStartedAt || undefined
                : prev.user.vipStartedAt,
            vipExpiresAt:
              payload.vipExpiresAt !== undefined
                ? payload.vipExpiresAt || undefined
                : prev.user.vipExpiresAt,
            updatedAt: now,
          },
          wallet: {
            ...prev.wallet,
            coinBalance: nextCoins,
            idrBalance: calculateIdrFromCoins(nextCoins),
            fireBalance: nextFire,
            updatedAt: now,
          },
        };
      });

      if (!isSandboxMode && fbUser) {
        setCloudUser((prev) =>
          prev
            ? {
                ...prev,
                isVip:
                  typeof payload.isVip === 'boolean' ? payload.isVip : prev.isVip,
                vipStatus: payload.vipStatus || prev.vipStatus,
                vipStartedAt:
                  payload.vipStartedAt !== undefined
                    ? payload.vipStartedAt || undefined
                    : prev.vipStartedAt,
                vipExpiresAt:
                  payload.vipExpiresAt !== undefined
                    ? payload.vipExpiresAt || undefined
                    : prev.vipExpiresAt,
                updatedAt: now,
              }
            : prev
        );
        setCloudWallet((prev) => {
          if (!prev) return prev;
          const nextCoins =
            typeof payload.coinBalance === 'number'
              ? Math.max(0, payload.coinBalance)
              : prev.coinBalance;
          const nextFire =
            typeof payload.fireBalance === 'number'
              ? Math.max(0, payload.fireBalance)
              : prev.fireBalance;
          return {
            ...prev,
            coinBalance: nextCoins,
            idrBalance: calculateIdrFromCoins(nextCoins),
            fireBalance: nextFire,
            updatedAt: now,
          };
        });
      }

      if (payload.noticeText) {
        if (soundEnabled) soundEngine.playReward();
        showNotice(payload.noticeText, 'success');
      }
    },
    [isSandboxMode, fbUser, soundEnabled]
  );

  const handleRedeemCode = async (rawCode: string) => {
    if (inFlightLocksRef.current.redeem) return;
    const cleanCode = rawCode.trim().toUpperCase();
    if (!cleanCode) return;

    inFlightLocksRef.current.redeem = true;
    setBusyAction('redeem');
    try {
      // First check Server-Side Promo Code endpoint
      const promoRes = await fetch('/api/game/promo/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: currentUser.uid,
          code: cleanCode,
        }),
      }).catch(() => null);

      if (promoRes) {
        const promoData = await promoRes.json().catch(() => null);
        if (promoRes.ok && promoData?.ok) {
          const now = new Date().toISOString();
          const awardedCoins = Number(promoData.coinReward || 0);
          const awardedFire = Number(promoData.fireReward || 0);
          setSandbox((prev) => ({
            ...prev,
            claimedCodes: Array.from(new Set([...prev.claimedCodes, cleanCode])),
            rewardCodes: prev.rewardCodes.map((rc) =>
              rc.code.toUpperCase() === cleanCode
                ? { ...rc, claimedCount: rc.claimedCount + 1 }
                : rc
            ),
            transactions: [
              {
                id: `tx_code_${Date.now()}`,
                uid: prev.user.uid,
                category: 'REWARD',
                direction: 'CREDIT',
                currency: awardedCoins > 0 ? 'COIN' : 'FIRE',
                amount: awardedCoins > 0 ? awardedCoins : awardedFire,
                description: `Klaim Kode Redeem ${cleanCode} (+${awardedCoins.toLocaleString('id-ID')} Koin & +${awardedFire} Diamond)`,
                referenceId: `code_${cleanCode}`,
                createdAt: now,
              },
              ...prev.transactions,
            ],
          }));
          handleServerFeatureSync({
            coinBalance: promoData.coinBalance,
            fireBalance: promoData.fireBalance,
            noticeText:
              promoData.message ||
              `Kode Redeem ${cleanCode} berhasil diklaim!`,
          });
          return;
        }
        if (promoData?.error) {
          throw new Error(promoData.error);
        }
      }

      if (isSandboxMode) {
        const target = sandbox.rewardCodes.find(
          (rc) => rc.code.toUpperCase() === cleanCode && rc.isActive
        );
        if (!target) {
          throw new Error('Gift Code tidak ditemukan atau sudah tidak aktif.');
        }
        if (sandbox.claimedCodes.includes(cleanCode)) {
          throw new Error('Anda sudah pernah mengklaim Gift Code ini.');
        }

        const now = new Date().toISOString();
        const addedCoins =
          target.coinReward +
          (target.idrReward > 0 ? calculateCoinsFromIdr(target.idrReward) : 0);

        await fetch('/api/game/redeem-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: currentUser.uid,
            code: cleanCode,
            coinReward: addedCoins,
            fireReward: target.fireReward,
          }),
        }).catch(() => {});

        setSandbox((prev) => {
          const nextCoins = prev.wallet.coinBalance + addedCoins;
          return {
            ...prev,
            wallet: {
              ...prev.wallet,
              coinBalance: nextCoins,
              idrBalance: calculateIdrFromCoins(nextCoins),
              fireBalance: prev.wallet.fireBalance + target.fireReward,
              totalEarnedCoins: prev.wallet.totalEarnedCoins + addedCoins,
              totalEarnedFire: prev.wallet.totalEarnedFire + target.fireReward,
              updatedAt: now,
            },
            claimedCodes: [...prev.claimedCodes, cleanCode],
            rewardCodes: prev.rewardCodes.map((rc) =>
              rc.code === cleanCode
                ? { ...rc, claimedCount: rc.claimedCount + 1 }
                : rc
            ),
            transactions: [
              {
                id: `tx_code_${Date.now()}`,
                uid: prev.user.uid,
                category: 'REWARD',
                direction: 'CREDIT',
                currency: 'COIN',
                amount: addedCoins,
                description: `Klaim Gift Code ${cleanCode} (+${addedCoins.toLocaleString('id-ID')} Coin / Rp${calculateIdrFromCoins(addedCoins).toLocaleString('id-ID')} & +${target.fireReward} Api)`,
                referenceId: `code_${cleanCode}`,
                createdAt: now,
              },
              ...prev.transactions,
            ],
          };
        });
        if (soundEnabled) soundEngine.playReward();
        showNotice(
          `Kode Hadiah ${cleanCode} berhasil ditukar! +${addedCoins.toLocaleString('id-ID')} Koin (Rp${calculateIdrFromCoins(addedCoins).toLocaleString('id-ID')}) & +${target.fireReward} Diamond.`,
          'success'
        );
      } else if (fbUser) {
        const res = await redeemRewardCodeFirestore(fbUser.uid, cleanCode);
        if (soundEnabled) soundEngine.playReward();
        showNotice(
          `Kode Hadiah ${res.code} berhasil! +${res.coinReward} Koin & +${res.fireReward} Diamond.`,
          'success'
        );
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Gagal menukar Gift Code.',
        'error'
      );
    } finally {
      inFlightLocksRef.current.redeem = false;
      setBusyAction(null);
    }
  };

  // ============================================================================
  // STRICT CONVERSION: KOIN COINOVA -> DIAMOND ONLY (MAX 10 DIAMOND / DAY)
  // ============================================================================
  const handleConvertCoinToFire = async (fireToObtain: number) => {
    if (inFlightLocksRef.current.convert) return;
    if (!isTierEligibleForConversion(currentUser.dragonLevel)) {
      showNotice(
        'Fitur Konversi Koin ke Diamond hanya tersedia untuk 2 Tier Tertinggi (Tier Pro Lv.4 & Tier Ultimate Lv.5).',
        'error'
      );
      return;
    }
    const cleanFire = Math.max(0, Math.floor(fireToObtain));
    const maxDailyFire =
      currentSettings.maxDailyFireConvert || ECONOMY_CONFIG.MAX_DAILY_FIRE_CONVERT;
    const coinsPerFire =
      currentSettings.coinsPerFireConvert || ECONOMY_CONFIG.COINS_PER_FIRE_CONVERT;

    if (cleanFire < 1) {
      showNotice(
        `Minimal konversi adalah ${coinsPerFire.toLocaleString('id-ID')} Koin (1 Diamond).`,
        'error'
      );
      return;
    }

    const today = getTodayKey();
    const usedToday =
      currentUser.lastConvertDate === today
        ? Math.min(maxDailyFire, Math.max(0, currentUser.dailyConvertedFire || 0))
        : 0;

    if (usedToday >= maxDailyFire || usedToday + cleanFire > maxDailyFire) {
      showNotice(
        `Batas konversi hari ini telah tercapai. Maksimal ${maxDailyFire} Diamond per hari.`,
        'error'
      );
      return;
    }

    const coinsRequired = cleanFire * coinsPerFire;
    if (coinsRequired > currentWallet.coinBalance) {
      showNotice('Saldo Koin COINOVA Anda tidak mencukupi.', 'error');
      return;
    }

    inFlightLocksRef.current.convert = true;
    setBusyAction('convert');
    try {
      // Mandatory Server-Side Validation of Daily 10 Diamond Quota & Top-2-Tier Eligibility
      const resp = await fetch('/api/game/validate-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: currentUser.uid,
          dragonLevel: currentUser.dragonLevel,
          fireToObtain: cleanFire,
          coinBalance: currentWallet.coinBalance,
          usedToday,
        }),
      });
      const serverCheck = await resp.json();
      if (!resp.ok || !serverCheck?.ok) {
        throw new Error(
          serverCheck?.error ||
            `Batas konversi hari ini telah tercapai. Maksimal ${maxDailyFire} Diamond per hari.`
        );
      }

      if (isSandboxMode) {
        const now = new Date().toISOString();
        const nextDailyUsed = Number(
          serverCheck.dailyConvertedFire || usedToday + cleanFire
        );

        setSandbox((prev) => {
          const nextCoins = Math.max(0, prev.wallet.coinBalance - coinsRequired);
          const nextIdr = calculateIdrFromCoins(nextCoins);
          return {
            ...prev,
            user: {
              ...prev.user,
              lastConvertDate: today,
              dailyConvertedFire: nextDailyUsed,
              updatedAt: now,
            },
            wallet: {
              ...prev.wallet,
              coinBalance: nextCoins,
              idrBalance: nextIdr,
              fireBalance: prev.wallet.fireBalance + cleanFire,
              totalEarnedFire: prev.wallet.totalEarnedFire + cleanFire,
              updatedAt: now,
            },
            transactions: [
              {
                id: `tx_conv_coin_${Date.now()}`,
                uid: prev.user.uid,
                category: 'KONVERSI',
                direction: 'DEBIT',
                currency: 'COIN',
                amount: coinsRequired,
                description: `Konversi Koin COINOVA → +${cleanFire} Diamond (${nextDailyUsed}/${maxDailyFire} hari ini)`,
                referenceId: `conv_${Date.now()}`,
                createdAt: now,
              },
              {
                id: `tx_conv_fire_${Date.now()}`,
                uid: prev.user.uid,
                category: 'KONVERSI',
                direction: 'CREDIT',
                currency: 'FIRE',
                amount: cleanFire,
                description: `Hasil Konversi ${coinsRequired.toLocaleString('id-ID')} Koin → +${cleanFire} Diamond`,
                referenceId: `conv_${Date.now()}`,
                createdAt: now,
              },
              ...prev.transactions,
            ],
          };
        });
        if (soundEnabled) soundEngine.playReward();
        showNotice(
          `Konversi berhasil: -${coinsRequired.toLocaleString('id-ID')} Koin → +${cleanFire} Diamond (${nextDailyUsed}/${maxDailyFire} hari ini)!`,
          'success'
        );
      } else if (fbUser) {
        flushCloudTapBuffer();
        const res = await convertCoinToFireFirestore(fbUser.uid, cleanFire);
        if (soundEnabled) soundEngine.playReward();
        showNotice(
          `Konversi berhasil: -${res.coinsSpent.toLocaleString('id-ID')} Koin → +${res.fireGained} Diamond (${res.dailyConvertedFire}/${maxDailyFire} hari ini)!`,
          'success'
        );
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Gagal mengonversi Koin COINOVA.',
        'error'
      );
    } finally {
      inFlightLocksRef.current.convert = false;
      setBusyAction(null);
    }
  };

  // ============================================================================
  // WITHDRAWAL ECONOMY (SINGLE UNIFIED KOIN BALANCE + DIAMOND REQUIREMENT)
  // ============================================================================
  const handleRequestWithdrawal = async (
    method: EWalletMethod,
    accountNumber: string,
    accountName: string,
    amount: number
  ) => {
    if (inFlightLocksRef.current.withdraw) return;
    const cleanAmount = Math.max(0, Math.floor(amount));
    const requiredCoins = calculateCoinsFromIdr(cleanAmount);
    const mappedFire = WITHDRAWAL_DIAMOND_MAP[requiredCoins];
    const requiredFire =
      typeof mappedFire === 'number'
        ? mappedFire
        : calculateRequiredFireForWithdrawal(cleanAmount);

    if (
      !VALID_WITHDRAW_COIN_TIERS.includes(requiredCoins) ||
      typeof mappedFire !== 'number'
    ) {
      showNotice(
        'Pilih nominal penarikan resmi: 20.000, 50.000, 100.000, 200.000, 500.000, atau 1.000.000 Koin.',
        'error'
      );
      return;
    }
    if (currentWallet.coinBalance < requiredCoins) {
      showNotice(
        `Koin tidak mencukupi (butuh ${requiredCoins.toLocaleString('id-ID')} Koin).`,
        'error'
      );
      return;
    }
    if (currentWallet.fireBalance < requiredFire) {
      showNotice(
        `Syarat Diamond belum mencukupi! Withdraw ${requiredCoins.toLocaleString('id-ID')} Koin membutuhkan ${requiredFire.toLocaleString('id-ID')} Diamond.`,
        'error'
      );
      return;
    }

    inFlightLocksRef.current.withdraw = true;
    setBusyAction('withdraw');
    try {
      const resp = await fetch('/api/game/validate-withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userSessionToken ? { Authorization: `Bearer ${userSessionToken}` } : {}),
        },
        body: JSON.stringify({
          uid: currentUser.uid,
          username: currentUser.username,
          amountCoins: requiredCoins,
          amountIdr: requiredCoins,
          coinBalance: currentWallet.coinBalance,
          fireBalance: currentWallet.fireBalance,
          dragonLevel: currentUser.dragonLevel,
          method,
          accountNumber,
          accountName,
        }),
      });
      const validated = await resp.json();
      if (!resp.ok || !validated?.ok) {
        throw new Error(validated?.error || 'Gagal memvalidasi syarat penarikan.');
      }

      const normalizedPhone = String(
        validated.normalizedAccountNumber || accountNumber
      ).trim();
      const verifiedName = String(validated.accountName || accountName).trim();

      if (isSandboxMode) {
        const now = new Date().toISOString();
        const wdId = String(validated.withdrawalId || `wd_${Date.now()}`);
        const newRecord: WithdrawalRecord = {
          withdrawalId: wdId,
          uid: currentUser.uid,
          username: currentUser.username,
          method,
          accountNumber: normalizedPhone,
          accountName: verifiedName,
          amount: requiredCoins,
          lockedCoins: requiredCoins,
          coinDeducted: requiredCoins,
          fireDeducted: requiredFire,
          isVipPriority: Boolean(
            validated.isVipPriority || validated.withdrawal?.isVipPriority
          ),
          status: 'PENDING',
          paymentReference: '',
          adminNote: 'Menunggu verifikasi pencairan manual ke E-Wallet (Maks. 3x24 jam)',
          createdAt: validated.withdrawal?.createdAt || now,
          updatedAt: now,
        };

        setSandbox((prev) => {
          const nextCoins = Math.max(0, prev.wallet.coinBalance - requiredCoins);
          const nextFire = Math.max(0, prev.wallet.fireBalance - requiredFire);
          return {
            ...prev,
            profile: {
              ...prev.profile,
              defaultEwallet: method,
              ewalletNumber: normalizedPhone,
              ewalletAccountName: verifiedName,
              updatedAt: now,
            },
            wallet: {
              ...prev.wallet,
              coinBalance: nextCoins,
              idrBalance: calculateIdrFromCoins(nextCoins),
              fireBalance: nextFire,
              lockedIdrBalance: prev.wallet.lockedIdrBalance + requiredCoins,
              updatedAt: now,
            },
            withdrawals: [newRecord, ...prev.withdrawals],
            transactions: [
              {
                id: `tx_wd_${Date.now()}`,
                uid: prev.user.uid,
                category: 'WITHDRAWAL',
                direction: 'HOLD',
                currency: 'COIN',
                amount: requiredCoins,
                description: `Penarikan ${requiredCoins.toLocaleString('id-ID')} Koin ke ${method} (${normalizedPhone} a/n ${verifiedName}) — -${requiredCoins.toLocaleString('id-ID')} Koin & -${requiredFire} Diamond`,
                referenceId: wdId,
                createdAt: now,
              },
              ...prev.transactions,
            ],
            notifications: [
              {
                id: `notif_wd_${Date.now()}`,
                uid: prev.user.uid,
                title: 'Permintaan Penarikan Diterima (PENDING)',
                message: `Penarikan ${requiredCoins.toLocaleString('id-ID')} Koin ke ${method} (${normalizedPhone}) sedang dalam antrean verifikasi Admin (estimasi maksimal 3x24 jam).`,
                type: 'INFO',
                isRead: false,
                createdAt: now,
                updatedAt: now,
              },
              ...prev.notifications,
            ],
          };
        });
        showNotice(
          `Permintaan penarikan ${requiredCoins.toLocaleString('id-ID')} Koin ke ${method} berhasil diajukan! Proses maksimal 3x24 jam.`,
          'success'
        );
      } else if (fbUser) {
        await requestManualWithdrawalFirestore(
          fbUser.uid,
          currentUser.username,
          method,
          normalizedPhone,
          verifiedName,
          requiredCoins
        );
        showNotice(
          `Permintaan penarikan ${requiredCoins.toLocaleString('id-ID')} Koin ke ${method} berhasil diajukan! Proses maksimal 3x24 jam.`,
          'success'
        );
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Gagal mengajukan penarikan.',
        'error'
      );
    } finally {
      inFlightLocksRef.current.withdraw = false;
      setBusyAction(null);
    }
  };

  const handleBindReferralCode = async (code: string) => {
    if (inFlightLocksRef.current.bind_ref) return;
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;

    if (cleanCode === currentUser.referralCode.toUpperCase()) {
      showNotice('Tidak dapat menggunakan kode undangan milik sendiri.', 'error');
      return;
    }
    if (currentUser.referredByCode) {
      showNotice('Akun Anda sudah terhubung dengan pengundang.', 'info');
      return;
    }

    inFlightLocksRef.current.bind_ref = true;
    setBusyAction('bind_ref');
    try {
      const resp = await fetch('/api/game/referral/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: currentUser.uid,
          ownReferralCode: currentUser.referralCode,
          inviterCode: cleanCode,
          alreadyBoundCode: currentUser.referredByCode || '',
        }),
      });
      const validated = await resp.json();
      if (!resp.ok || !validated?.ok) {
        throw new Error(validated?.error || 'Kode undangan tidak valid.');
      }

      if (isSandboxMode) {
        const now = new Date().toISOString();
        setSandbox((prev) => ({
          ...prev,
          user: {
            ...prev.user,
            referredByCode: cleanCode,
            referredByUid: 'inviter_demo',
            updatedAt: now,
          },
        }));
        if (soundEnabled) soundEngine.playReward();
        showNotice(
          `Kode ${cleanCode} berhasil diikat (Status: PENDING). Komisi diberikan setelah akun aktif / top-up diverifikasi Admin.`,
          'success'
        );
      } else if (fbUser) {
        await bindReferralCodeFirestore(
          fbUser.uid,
          currentUser.username,
          cleanCode,
          currentSettings
        );
        if (soundEnabled) soundEngine.playReward();
        showNotice(
          `Kode ${cleanCode} berhasil dihubungkan (Status: PENDING)!`,
          'success'
        );
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Gagal mengikat kode undangan.',
        'error'
      );
    } finally {
      inFlightLocksRef.current.bind_ref = false;
      setBusyAction(null);
    }
  };

  const handleAdminProcessReferral = async (
    ref: ReferralRecord,
    milestone: 'ACTIVE' | 'VERIFIED' | 'UPGRADE' | 'REJECTED'
  ) => {
    if (!(await verifyAdminActionServerSide(`REFERRAL_${milestone}`))) return;
    const lockKey = `ver_${ref.referralId}`;
    if (inFlightLocksRef.current[lockKey]) return;

    inFlightLocksRef.current[lockKey] = true;
    setBusyAction(lockKey);
    try {
      const resp = await fetch('/api/admin/referral/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminSession?.token
            ? { Authorization: `Bearer ${adminSession.token}` }
            : {}),
        },
        body: JSON.stringify({
          referralId: ref.referralId,
          inviterUid: ref.inviterUid,
          inviteeUid: ref.inviteeUid,
          milestone,
          upgradeEventId: `upg_ref_${ref.referralId}`,
        }),
      });
      const validated = await resp.json();
      if (!resp.ok || !validated?.ok) {
        throw new Error(validated?.error || 'Gagal memproses milestone referral.');
      }

      const awardedCoins = Number(validated.awardedCoins || 0);
      const awardedFire = Number(validated.awardedFire || 0);

      if (isSandboxMode) {
        const now = new Date().toISOString();
        setSandbox((prev) => {
          const isCurrentInviter = ref.inviterUid === prev.user.uid;
          const nextCoins = isCurrentInviter
            ? prev.wallet.coinBalance + awardedCoins
            : prev.wallet.coinBalance;
          const nextFire = isCurrentInviter
            ? prev.wallet.fireBalance + awardedFire
            : prev.wallet.fireBalance;

          return {
            ...prev,
            wallet: isCurrentInviter
              ? {
                  ...prev.wallet,
                  coinBalance: nextCoins,
                  idrBalance: calculateIdrFromCoins(nextCoins),
                  fireBalance: nextFire,
                  totalEarnedCoins: prev.wallet.totalEarnedCoins + awardedCoins,
                  totalEarnedFire: prev.wallet.totalEarnedFire + awardedFire,
                  updatedAt: now,
                }
              : prev.wallet,
            referrals: prev.referrals.map((r) =>
              r.referralId === ref.referralId
                ? {
                    ...r,
                    status: validated.status || (milestone === 'UPGRADE' ? 'VERIFIED' : milestone),
                    activeRewardClaimed: Boolean(validated.activeRewardClaimed),
                    topupRewardClaimed: Boolean(validated.topupRewardClaimed),
                    updatedAt: now,
                  }
                : r
            ),
            transactions:
              awardedCoins > 0 || awardedFire > 0
                ? [
                    {
                      id: `tx_ref_${Date.now()}`,
                      uid: ref.inviterUid,
                      category: 'REFERRAL',
                      direction: 'CREDIT',
                      currency: awardedCoins > 0 ? 'COIN' : 'FIRE',
                      amount: awardedCoins > 0 ? awardedCoins : awardedFire,
                      description:
                        milestone === 'ACTIVE'
                          ? `Referral Teman Aktif (${ref.inviteeUsername}): +${awardedFire} Diamond`
                          : milestone === 'UPGRADE'
                          ? `Referral Upgrade Level Valid (${ref.inviteeUsername}): +${awardedCoins.toLocaleString('id-ID')} Koin & +${awardedFire} Diamond`
                          : `Referral Top-Up Valid (${ref.inviteeUsername}): +${awardedCoins.toLocaleString('id-ID')} Koin & +${awardedFire} Diamond`,
                      referenceId: ref.referralId,
                      createdAt: now,
                    },
                    ...prev.transactions,
                  ]
                : prev.transactions,
          };
        });
        showNotice(
          milestone === 'REJECTED'
            ? `Referral ${ref.inviteeUsername} ditolak.`
            : `Referral ${ref.inviteeUsername} diperbarui (${milestone}): +${awardedCoins.toLocaleString('id-ID')} Koin & +${awardedFire} Diamond!`,
          'success'
        );
      } else if (fbUser) {
        await adminProcessReferralFirestore(
          fbUser.uid,
          fbUser.email || 'admin',
          ref,
          milestone
        );
        showNotice(`Referral ${ref.inviteeUsername} diperbarui ke ${milestone}!`, 'success');
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Gagal memproses milestone referral.',
        'error'
      );
    } finally {
      inFlightLocksRef.current[lockKey] = false;
      setBusyAction(null);
    }
  };

  const handleSubmitCreatorContent = async (
    platform: CreatorPlatform,
    contentUrl: string,
    caption: string
  ) => {
    if (inFlightLocksRef.current.creator) return;
    inFlightLocksRef.current.creator = true;
    setBusyAction('creator');
    try {
      if (isSandboxMode) {
        const now = new Date().toISOString();
        const subResp = await fetch('/api/game/creator/submit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(userSessionToken ? { Authorization: `Bearer ${userSessionToken}` } : {}),
          },
          body: JSON.stringify({
            uid: currentUser.uid,
            username: currentUser.username,
            platform,
            contentUrl,
            caption: caption || `Konten ${platform} COINOVA`,
          }),
        });
        const subData = await subResp.json().catch(() => null);
        if (!subResp.ok || subData?.ok === false) {
          throw new Error(subData?.error || 'Gagal mengirim konten kreator.');
        }

        const newSub: CreatorSubmission = subData?.submission || {
          submissionId: `sub_${Date.now()}`,
          uid: currentUser.uid,
          username: currentUser.username,
          platform,
          contentUrl,
          caption: caption || `Konten ${platform} COINOVA`,
          status: 'PENDING',
          rewardCoin: 3000,
          rewardFire: 5,
          rewardIdr: 300,
          adminNote: 'Menunggu verifikasi Admin COINOVA',
          createdAt: now,
          updatedAt: now,
        };
        setSandbox((prev) => ({
          ...prev,
          creatorSubmissions: [newSub, ...prev.creatorSubmissions],
        }));
        showNotice(
          `Link video ${platform} berhasil dikirim! Silakan klaim hadiah Misi Kreator.`,
          'success'
        );
      } else if (fbUser) {
        await submitCreatorContentFirestore(
          fbUser.uid,
          currentUser.username,
          platform,
          contentUrl,
          caption
        );
        showNotice('Konten kreator berhasil dikirim!', 'success');
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Gagal mengirim konten kreator.',
        'error'
      );
    } finally {
      inFlightLocksRef.current.creator = false;
      setBusyAction(null);
    }
  };

  const handleSaveProfile = async (
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
  ) => {
    setBusyAction('profile');
    try {
      if (isSandboxMode) {
        const now = new Date().toISOString();
        await fetch('/api/game/profile/save', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(userSessionToken ? { Authorization: `Bearer ${userSessionToken}` } : {}),
          },
          body: JSON.stringify({
            uid: currentUser.uid,
            username: username || currentUser.username,
            fullName: updates.fullName,
            phone: updates.phone,
            defaultEwallet: updates.defaultEwallet,
            ewalletNumber: updates.ewalletNumber,
            ewalletAccountName: updates.ewalletAccountName,
          }),
        }).catch(() => {});

        setSandbox((prev) => ({
          ...prev,
          user: {
            ...prev.user,
            username: username || prev.user.username,
            updatedAt: now,
          },
          profile: {
            ...prev.profile,
            ...updates,
            updatedAt: now,
          },
        }));
        showNotice('Pengaturan profil & E-Wallet berhasil disimpan!', 'success');
      } else if (fbUser) {
        await updateUserProfileFirestore(fbUser.uid, username, updates);
        showNotice('Pengaturan profil & E-Wallet berhasil disimpan!', 'success');
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : 'Gagal menyimpan profil.',
        'error'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleMarkNotificationsRead = async () => {
    if (isSandboxMode) {
      setSandbox((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) => ({ ...n, isRead: true })),
      }));
    } else if (fbUser) {
      const unread = cloudNotifications.filter((n) => !n.isRead);
      await Promise.all(
        unread.map((n) => markNotificationReadFirestore(n.id).catch(() => {}))
      );
    }
  };

  const handleSubmitBugReport = (report: BugReportItem) => {
    const now = new Date().toISOString();
    if (isSandboxMode) {
      setSandbox((prev) => ({
        ...prev,
        notifications: [
          {
            id: `notif_bug_${Date.now()}`,
            uid: prev.user.uid,
            title: `Laporan Bug #${report.reportId} Diterima`,
            message: `Laporan Anda untuk fitur "${report.featureArea}" telah masuk ke antrean tim teknis COINOVA.`,
            type: 'INFO',
            isRead: false,
            createdAt: now,
            updatedAt: now,
          },
          ...prev.notifications,
        ],
      }));
    }
    showNotice(`Laporan Bug #${report.reportId} berhasil dikirim!`, 'success');
  };

  // ============================================================================
  // SERVER-AUTHORIZED ADMIN HANDLERS
  // ============================================================================

  const handleAdminProcessWithdrawal = async (
    w: WithdrawalRecord,
    nextStatus: WithdrawalStatus,
    paymentRef: string,
    note: string
  ) => {
    if (!(await verifyAdminActionServerSide(`WITHDRAWAL_${nextStatus}`))) return;
    setBusyAction(`wd_${w.withdrawalId}`);
    try {
      if (adminSession?.token) {
        const wdResp = await fetch('/api/admin/withdrawals/action', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminSession.token}`,
          },
          body: JSON.stringify({
            withdrawalId: w.withdrawalId,
            nextStatus,
            paymentReference: paymentRef,
            adminNote: note,
          }),
        });
        const wdData = await wdResp.json().catch(() => null);
        if (!wdResp.ok || wdData?.ok === false) {
          showNotice(wdData?.error || 'Gagal memproses withdrawal di server.', 'error');
          return;
        }
      }

      if (isSandboxMode) {
        const now = new Date().toISOString();
        const refundCoins = w.coinDeducted || calculateCoinsFromIdr(w.amount);
        const refundFire =
          w.fireDeducted || calculateRequiredFireForWithdrawal(w.amount);

        setSandbox((prev) => {
          let updatedWallet = { ...prev.wallet };
          if (w.uid === prev.user.uid) {
            if (nextStatus === 'PAID') {
              updatedWallet = {
                ...updatedWallet,
                lockedIdrBalance: Math.max(0, updatedWallet.lockedIdrBalance - w.amount),
                totalWithdrawnIdr: updatedWallet.totalWithdrawnIdr + w.amount,
              };
            } else if (nextStatus === 'REJECTED') {
              const nextCoins = updatedWallet.coinBalance + refundCoins;
              updatedWallet = {
                ...updatedWallet,
                lockedIdrBalance: Math.max(0, updatedWallet.lockedIdrBalance - w.amount),
                coinBalance: nextCoins,
                idrBalance: calculateIdrFromCoins(nextCoins),
                fireBalance: updatedWallet.fireBalance + refundFire,
              };
            }
          }

          return {
            ...prev,
            wallet: updatedWallet,
            withdrawals: prev.withdrawals.map((item) =>
              item.withdrawalId === w.withdrawalId
                ? {
                    ...item,
                    status: nextStatus,
                    paymentReference: paymentRef,
                    adminNote: note,
                    updatedAt: now,
                  }
                : item
            ),
          };
        });
        showNotice(`Status penarikan diperbarui ke ${nextStatus}.`, 'success');
      } else if (fbUser) {
        await adminProcessWithdrawalFirestore(
          fbUser.uid,
          fbUser.email || 'admin',
          w,
          nextStatus,
          paymentRef,
          note
        );
        showNotice(`Status penarikan diperbarui ke ${nextStatus}.`, 'success');
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleAdminReviewUpgradeOrder = async (
    order: LevelUpgradeOrder,
    nextStatus: 'PAID' | 'REJECTED',
    note: string
  ) => {
    if (!(await verifyAdminActionServerSide(`UPGRADE_ORDER_${nextStatus}`))) return;
    setBusyAction(`ord_${order.orderId}`);
    try {
      const targetCfg =
        currentLevels.find((l) => l.level === order.targetLevel) ||
        DEFAULT_DRAGON_LEVELS.find((l) => l.level === order.targetLevel);

      // Process authoritative server-side upgrade verification + automatic one-time referral upgrade reward
      let referralUpgradeRewardCoins = 0;
      let referralUpgradeRewardFire = 0;
      let referralInviterUid = '';
      if (adminSession?.token) {
        const linkedReferral = currentReferrals.find(
          (r) => r.inviteeUid === order.uid && r.status !== 'REJECTED'
        );
        try {
          const verifyResp = await fetch('/api/admin/upgrade/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminSession.token}`,
            },
            body: JSON.stringify({
              orderId: order.orderId,
              uid: order.uid,
              targetLevel: order.targetLevel,
              status: nextStatus,
              adminNote: note,
              inviterUid: linkedReferral?.inviterUid || '',
            }),
          });
          const verifyData = await verifyResp.json();
          if (verifyResp.ok && verifyData?.referralRewardGranted) {
            referralUpgradeRewardCoins = Number(verifyData.referralAwardedCoins || 0);
            referralUpgradeRewardFire = Number(verifyData.referralAwardedFire || 0);
            referralInviterUid = String(
              verifyData.inviterUid || linkedReferral?.inviterUid || ''
            );
          }
        } catch {
          // continue local state update
        }
      }

      if (isSandboxMode) {
        const now = new Date().toISOString();
        setSandbox((prev) => {
          const isCurrentUser = order.uid === prev.user.uid;
          const isInviterCurrentUser =
            referralInviterUid && referralInviterUid === prev.user.uid;
          const nextUser =
            isCurrentUser && nextStatus === 'PAID'
              ? {
                  ...prev.user,
                  dragonLevel: Math.max(prev.user.dragonLevel, order.targetLevel),
                  updatedAt: now,
                }
              : prev.user;

          let nextWallet =
            isCurrentUser && nextStatus === 'PAID' && targetCfg
              ? {
                  ...prev.wallet,
                  // Activate level maxEnergy & fireBonus WITHOUT touching Koin COINOVA!
                  maxEnergy: Math.max(prev.wallet.maxEnergy, targetCfg.maxEnergy),
                  energy: Math.max(prev.wallet.energy, targetCfg.maxEnergy),
                  fireBalance: prev.wallet.fireBalance + targetCfg.dailyFireBonus,
                  totalEarnedFire: prev.wallet.totalEarnedFire + targetCfg.dailyFireBonus,
                  updatedAt: now,
                }
              : prev.wallet;

          if (
            isInviterCurrentUser &&
            (referralUpgradeRewardCoins > 0 || referralUpgradeRewardFire > 0)
          ) {
            const updatedCoins = nextWallet.coinBalance + referralUpgradeRewardCoins;
            nextWallet = {
              ...nextWallet,
              coinBalance: updatedCoins,
              idrBalance: calculateIdrFromCoins(updatedCoins),
              fireBalance: nextWallet.fireBalance + referralUpgradeRewardFire,
              totalEarnedCoins:
                nextWallet.totalEarnedCoins + referralUpgradeRewardCoins,
              totalEarnedFire:
                nextWallet.totalEarnedFire + referralUpgradeRewardFire,
              updatedAt: now,
            };
          }

          const newTxs: WalletTransaction[] = [];
          if (nextStatus === 'PAID') {
            newTxs.push({
              id: `tx_lvl_paid_${Date.now()}`,
              uid: order.uid,
              category: 'LEVEL',
              direction: 'CREDIT',
              currency: 'IDR',
              amount: order.priceIdr,
              description: `Aktivasi Upgrade Lv.${order.targetLevel} (${order.levelName}) Terverifikasi Rp${order.priceIdr.toLocaleString('id-ID')}`,
              referenceId: order.orderId,
              createdAt: now,
            });
            if (
              referralInviterUid &&
              (referralUpgradeRewardCoins > 0 || referralUpgradeRewardFire > 0)
            ) {
              newTxs.push({
                id: `tx_ref_upg_${Date.now()}`,
                uid: referralInviterUid,
                category: 'REFERRAL',
                direction: 'CREDIT',
                currency: 'COIN',
                amount: referralUpgradeRewardCoins,
                description: `Reward Referral Upgrade Level (${order.username} -> Lv.${order.targetLevel}): +${referralUpgradeRewardCoins.toLocaleString('id-ID')} Koin & +${referralUpgradeRewardFire} Diamond`,
                referenceId: order.orderId,
                createdAt: now,
              });
            }
          }

          return {
            ...prev,
            user: nextUser,
            wallet: nextWallet,
            upgradeOrders: prev.upgradeOrders.map((item) =>
              item.orderId === order.orderId
                ? { ...item, status: nextStatus, adminNote: note, updatedAt: now }
                : item
            ),
            transactions: [...newTxs, ...prev.transactions],
            notifications: [
              {
                id: `notif_ord_ver_${Date.now()}`,
                uid: order.uid,
                title:
                  nextStatus === 'PAID'
                    ? `APPROVED! Lv.${order.targetLevel} (${order.levelName}) Aktif`
                    : `Order Upgrade Lv.${order.targetLevel} Ditolak (REJECTED)`,
                message: note,
                type: nextStatus === 'PAID' ? 'SUCCESS' : 'WARNING',
                isRead: false,
                createdAt: now,
                updatedAt: now,
              },
              ...prev.notifications,
            ],
          };
        });
        showNotice(
          nextStatus === 'PAID'
            ? `Order Lv.${order.targetLevel} disetujui (APPROVED) & level diaktifkan!`
            : 'Order upgrade level ditolak (REJECTED).',
          'success'
        );
      } else if (fbUser) {
        await adminReviewUpgradeOrderFirestore(
          fbUser.uid,
          fbUser.email || 'admin',
          order,
          nextStatus,
          note,
          targetCfg
        );
        showNotice(`Order upgrade level diperbarui ke ${nextStatus}.`, 'success');
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleAdminReviewCreator = async (
    sub: CreatorSubmission,
    nextStatus: CreatorStatus,
    coinReward: number,
    fireReward: number,
    idrReward: number,
    note: string
  ) => {
    if (!(await verifyAdminActionServerSide(`CREATOR_${nextStatus}`))) return;
    if (adminSession?.token) {
      await fetch('/api/admin/creator/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSession.token}`,
        },
        body: JSON.stringify({
          submissionId: sub.submissionId,
          nextStatus,
          coinReward,
          fireReward,
          idrReward,
          adminNote: note,
        }),
      }).catch(() => {});
    }
    if (isSandboxMode) {
      const now = new Date().toISOString();
      setSandbox((prev) => ({
        ...prev,
        creatorSubmissions: prev.creatorSubmissions.map((s) =>
          s.submissionId === sub.submissionId
            ? {
                ...s,
                status: nextStatus,
                rewardCoin: coinReward,
                rewardFire: fireReward,
                rewardIdr: idrReward,
                adminNote: note,
                updatedAt: now,
              }
            : s
        ),
      }));
      showNotice(`Submission kreator diperbarui ke ${nextStatus}.`, 'success');
    } else if (fbUser) {
      await adminReviewCreatorSubmissionFirestore(
        fbUser.uid,
        fbUser.email || 'admin',
        sub,
        nextStatus,
        coinReward,
        fireReward,
        idrReward,
        note
      );
      showNotice(`Submission kreator diperbarui ke ${nextStatus}.`, 'success');
    }
  };

  const handleAdminAdjustUserBalance = async (
    targetUid: string,
    currency: CurrencyType,
    delta: number,
    reason: string
  ) => {
    if (!(await verifyAdminActionServerSide('WALLET_ADJUSTMENT'))) return;
    if (adminSession?.token) {
      await fetch('/api/admin/user/adjust-balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminSession.token}`,
        },
        body: JSON.stringify({
          targetUid,
          currency,
          delta,
          reason,
        }),
      }).catch(() => {});
    }

    if (isSandboxMode) {
      const now = new Date().toISOString();
      setSandbox((prev) => {
        const applyWalletDelta = (w: UserWallet): UserWallet => {
          let nextCoins = w.coinBalance;
          let nextFire = w.fireBalance;
          if (currency === 'COIN') {
            nextCoins = Math.max(0, w.coinBalance + delta);
          } else if (currency === 'IDR') {
            const deltaCoins =
              (delta >= 0 ? 1 : -1) * calculateCoinsFromIdr(Math.abs(delta));
            nextCoins = Math.max(0, w.coinBalance + deltaCoins);
          } else if (currency === 'FIRE') {
            nextFire = Math.max(0, w.fireBalance + delta);
          }
          return {
            ...w,
            coinBalance: nextCoins,
            idrBalance: calculateIdrFromCoins(nextCoins),
            fireBalance: nextFire,
            updatedAt: now,
          };
        };

        const isCurrent = targetUid === prev.user.uid;
        const updatedCurrentWallet = isCurrent
          ? applyWalletDelta(prev.wallet)
          : prev.wallet;

        const updatedAllUsers = prev.allUsers.map((item) =>
          item.user.uid === targetUid
            ? { ...item, wallet: applyWalletDelta(item.wallet) }
            : item
        );

        const newTx: WalletTransaction = {
          id: `tx_adm_${Date.now()}`,
          uid: targetUid,
          category: 'REWARD',
          direction: delta >= 0 ? 'CREDIT' : 'DEBIT',
          currency: currency === 'FIRE' ? 'FIRE' : 'COIN',
          amount: Math.abs(delta),
          description: `${reason || 'Penyesuaian Saldo Admin'} (${delta >= 0 ? '+' : ''}${delta.toLocaleString('id-ID')} ${currency === 'FIRE' ? 'Diamond' : 'Koin'})`,
          referenceId: `adm_${Date.now()}`,
          createdAt: now,
        };

        const newAudit: AdminAuditLog = {
          id: `aud_${Date.now()}`,
          adminUid: adminSession?.uid || 'admin_root',
          adminEmail: adminSession?.username || 'admin',
          action: 'PENYESUAIAN SALDO USER',
          targetUid,
          details: `${reason || 'Penyesuaian Saldo'}: ${delta >= 0 ? '+' : ''}${delta.toLocaleString('id-ID')} ${currency === 'FIRE' ? 'Diamond' : 'Koin'} (UID: ${targetUid})`,
          createdAt: now,
        };

        return {
          ...prev,
          wallet: updatedCurrentWallet,
          allUsers: updatedAllUsers,
          transactions: [newTx, ...prev.transactions],
          auditLogs: [newAudit, ...prev.auditLogs],
        };
      });
      const labelCurrency = currency === 'FIRE' ? 'Diamond' : 'Koin';
      showNotice(
        `Saldo ${labelCurrency} berhasil disesuaikan (${delta >= 0 ? '+' : ''}${delta.toLocaleString('id-ID')} ${labelCurrency}).`,
        'success'
      );
    } else if (fbUser) {
      await adminAdjustWalletFirestore(
        fbUser.uid,
        fbUser.email || 'admin',
        targetUid,
        currency,
        delta >= 0 ? 'CREDIT' : 'DEBIT',
        Math.abs(delta),
        reason
      );
      showNotice('Saldo pemain berhasil disesuaikan.', 'success');
    }
  };

  // ============================================================================
  // RENDER DEDICATED SEPARATE ADMIN PORTAL (`/admin` OR `#admin`)
  // ============================================================================
  if (isAdminRoute) {
    const rawBaseUsersList = isSandboxMode
      ? sandbox.allUsers.map((u) =>
          u.user.uid === sandbox.user.uid
            ? { user: sandbox.user, wallet: sandbox.wallet, profile: sandbox.profile }
            : u
        )
      : cloudAllUsers.length > 0
      ? cloudAllUsers
      : [{ user: currentUser, wallet: currentWallet, profile: currentProfile }];

    const baseUsersList = rawBaseUsersList.filter(
      (u) =>
        Boolean(u.user.uid) &&
        Boolean(u.user.username) &&
        u.user.username.trim().toLowerCase() !== 'member' &&
        u.user.uid !== 'user_new_0'
    );

    const hasCurrentInList = baseUsersList.some(
      (u) => u.user.uid === currentUser.uid
    );
    const allUsersList =
      !hasCurrentInList &&
      currentUser.uid &&
      currentUser.username &&
      currentUser.username.trim().toLowerCase() !== 'member' &&
      currentUser.uid !== 'user_new_0'
        ? [
            { user: currentUser, wallet: currentWallet, profile: currentProfile },
            ...baseUsersList,
          ]
        : baseUsersList;

    return (
      <>
        {toast && (
          <div className="fixed left-1/2 top-3 z-50 w-[92%] max-w-[420px] -translate-x-1/2">
            <div
              className={`flex items-center justify-between gap-2 rounded-2xl border px-4 py-2.5 text-xs font-extrabold shadow-2xl backdrop-blur-md ${
                toast.type === 'error'
                  ? 'border-red-400/60 bg-[#1A0808]/95 text-red-200'
                  : 'border-[#FFEA00]/65 bg-[#14130B]/95 text-[#FFEA00] shadow-[0_0_24px_rgba(255,234,0,0.28)]'
              }`}
            >
              <span>{toast.text}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="ml-2 rounded-lg px-1.5 py-0.5 text-[10px] font-bold text-zinc-300 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
        )}
        <AdminDashboard
          adminSession={adminSession}
          onAdminLoginSuccess={(session) => {
            sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, JSON.stringify(session));
            setAdminSession(session);
            showNotice('Login Admin berhasil.', 'success');
          }}
          onAdminLogout={async () => {
            if (adminSession?.token) {
              await fetch('/api/admin/logout', {
                method: 'POST',
                headers: { Authorization: `Bearer ${adminSession.token}` },
              }).catch(() => {});
            }
            sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
            setAdminSession(null);
            if (window.location.hash) {
              window.location.hash = '';
            }
            window.history.replaceState({}, '', '/');
            setIsAdminRoute(false);
            setIsUserAuthenticated(false);
            showNotice('Sesi Admin telah diakhiri. Silakan login kembali.', 'info');
          }}
          onExitToUserApp={() => {
            if (window.location.hash) {
              window.location.hash = '';
            }
            window.history.replaceState({}, '', '/');
            setIsAdminRoute(false);
          }}
          users={allUsersList.map((x) => x.user)}
          wallets={allUsersList.map((x) => x.wallet)}
          tasks={currentTasks}
          rewardCodes={currentCodes}
          referrals={currentReferrals}
          creatorSubmissions={currentSubmissions}
          withdrawals={currentWithdrawals}
          upgradeOrders={currentUpgradeOrders}
          transactions={currentTransactions}
          levels={currentLevels}
          settings={currentSettings}
          auditLogs={currentAuditLogs}
          onProcessWithdrawal={handleAdminProcessWithdrawal}
          onReviewUpgradeOrder={handleAdminReviewUpgradeOrder}
          onProcessReferral={handleAdminProcessReferral}
          onReviewCreator={handleAdminReviewCreator}
          onAdjustUserBalance={handleAdminAdjustUserBalance}
          onToggleUserSuspend={async (targetUid, currentStatus) => {
            if (!(await verifyAdminActionServerSide('TOGGLE_USER_STATUS'))) return;
            const next: 'active' | 'suspended' =
              currentStatus === 'active' ? 'suspended' : 'active';
            if (adminSession?.token) {
              await fetch('/api/admin/user/toggle-status', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${adminSession.token}`,
                },
                body: JSON.stringify({
                  targetUid,
                  nextStatus: next,
                }),
              }).catch(() => {});
            }
            const now = new Date().toISOString();
            setSandbox((prev) => {
              const existsInAll = prev.allUsers.some(
                (item) => item.user.uid === targetUid
              );
              const nextAllUsers = existsInAll
                ? prev.allUsers.map((item) =>
                    item.user.uid === targetUid
                      ? {
                          ...item,
                          user: { ...item.user, status: next, updatedAt: now },
                        }
                      : item
                  )
                : [
                    ...prev.allUsers,
                    {
                      user: {
                        ...prev.user,
                        uid: targetUid,
                        username: targetUid,
                        status: next,
                        updatedAt: now,
                      },
                      wallet: {
                        ...prev.wallet,
                        uid: targetUid,
                        coinBalance: 0,
                        idrBalance: 0,
                        fireBalance: 0,
                        updatedAt: now,
                      },
                      profile: {
                        ...prev.profile,
                        uid: targetUid,
                        updatedAt: now,
                      },
                    },
                  ];

              return {
                ...prev,
                user:
                  prev.user.uid === targetUid
                    ? { ...prev.user, status: next, updatedAt: now }
                    : prev.user,
                allUsers: nextAllUsers,
                auditLogs: [
                  {
                    id: `aud_usr_${Date.now()}`,
                    adminUid: adminSession?.uid || 'admin_root',
                    adminEmail: adminSession?.username || 'admin',
                    action: next === 'suspended' ? 'SUSPEND USER' : 'AKTIFKAN USER',
                    targetUid,
                    details: `Status akun UID ${targetUid} diubah menjadi ${next.toUpperCase()}`,
                    createdAt: now,
                  },
                  ...prev.auditLogs,
                ],
              };
            });
            showNotice(
              `Status akun berhasil diubah menjadi ${next === 'active' ? 'Aktif' : 'Suspended'}.`,
              'success'
            );
          }}
          onSaveTask={async (task) => {
            if (!(await verifyAdminActionServerSide('SAVE_TASK'))) return;
            const now = new Date().toISOString();
            if (adminSession?.token) {
              const exists = currentTasks.some((t) => t.taskId === task.taskId);
              const nextTasks = exists
                ? currentTasks.map((t) => (t.taskId === task.taskId ? task : t))
                : [task, ...currentTasks];
              await fetch('/api/admin/config/save', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${adminSession.token}`,
                },
                body: JSON.stringify({ tasks: nextTasks }),
              }).catch(() => {});
            }
            if (isSandboxMode) {
              setSandbox((prev) => {
                const exists = prev.tasks.some((t) => t.taskId === task.taskId);
                return {
                  ...prev,
                  tasks: exists
                    ? prev.tasks.map((t) => (t.taskId === task.taskId ? task : t))
                    : [task, ...prev.tasks],
                  auditLogs: [
                    {
                      id: `aud_tsk_${Date.now()}`,
                      adminUid: adminSession?.uid || 'admin_root',
                      adminEmail: adminSession?.username || 'admin',
                      action: exists ? 'UPDATE MISI' : 'TAMBAH MISI',
                      targetUid: task.taskId,
                      details: `Misi "${task.title}" (${task.isActive ? 'Aktif' : 'Nonaktif'}) disimpan`,
                      createdAt: now,
                    },
                    ...prev.auditLogs,
                  ],
                };
              });
            } else if (fbUser) {
              await adminSaveTaskFirestore(fbUser.uid, fbUser.email || 'admin', task);
            }
            showNotice('Data misi berhasil disimpan!', 'success');
          }}
          onSaveRewardCode={async (rc) => {
            if (!(await verifyAdminActionServerSide('SAVE_REWARD_CODE'))) return;
            const now = new Date().toISOString();
            if (adminSession?.token) {
              const exists = currentCodes.some((c) => c.code === rc.code);
              const nextCodes = exists
                ? currentCodes.map((c) => (c.code === rc.code ? rc : c))
                : [rc, ...currentCodes];
              await Promise.all([
                fetch('/api/admin/promo', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminSession.token}`,
                  },
                  body: JSON.stringify({
                    code: rc.code,
                    description: rc.description,
                    coinReward: rc.coinReward,
                    fireReward: rc.fireReward,
                    quota: rc.maxClaims,
                    maxClaims: rc.maxClaims,
                    expiresAt: rc.expiresAt || null,
                    isActive: rc.isActive,
                  }),
                }).catch(() => {}),
                fetch('/api/admin/config/save', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminSession.token}`,
                  },
                  body: JSON.stringify({ rewardCodes: nextCodes }),
                }).catch(() => {}),
              ]);
            }
            if (isSandboxMode) {
              setSandbox((prev) => {
                const exists = prev.rewardCodes.some((c) => c.code === rc.code);
                return {
                  ...prev,
                  rewardCodes: exists
                    ? prev.rewardCodes.map((c) => (c.code === rc.code ? rc : c))
                    : [rc, ...prev.rewardCodes],
                  auditLogs: [
                    {
                      id: `aud_rc_${Date.now()}`,
                      adminUid: adminSession?.uid || 'admin_root',
                      adminEmail: adminSession?.username || 'admin',
                      action: exists ? 'UPDATE GIFT CODE' : 'BUAT GIFT CODE',
                      targetUid: rc.code,
                      details: `Gift Code ${rc.code} (+${rc.coinReward.toLocaleString('id-ID')} Koin, +${rc.fireReward} Diamond) disimpan`,
                      createdAt: now,
                    },
                    ...prev.auditLogs,
                  ],
                };
              });
            } else if (fbUser) {
              await adminSaveRewardCodeFirestore(
                fbUser.uid,
                fbUser.email || 'admin',
                rc
              );
            }
            showNotice('Gift Code berhasil disimpan!', 'success');
          }}
          onSaveLevelConfig={async (lvl) => {
            if (!(await verifyAdminActionServerSide('SAVE_LEVEL_CONFIG'))) return;
            const now = new Date().toISOString();
            if (adminSession?.token) {
              const nextLevels = currentLevels.map((l) =>
                l.level === lvl.level ? lvl : l
              );
              await fetch('/api/admin/config/save', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${adminSession.token}`,
                },
                body: JSON.stringify({ levels: nextLevels }),
              }).catch(() => {});
            }
            if (isSandboxMode) {
              setSandbox((prev) => ({
                ...prev,
                levels: prev.levels.map((l) => (l.level === lvl.level ? lvl : l)),
                auditLogs: [
                  {
                    id: `aud_lvl_${Date.now()}`,
                    adminUid: adminSession?.uid || 'admin_root',
                    adminEmail: adminSession?.username || 'admin',
                    action: 'UPDATE KONFIGURASI LEVEL',
                    targetUid: `level_${lvl.level}`,
                    details: `Level ${lvl.level} (${lvl.name}) diperbarui: Rp${lvl.priceIdr.toLocaleString('id-ID')}, Multiplier ${lvl.tapMultiplier}x, Energi ${lvl.maxEnergy}`,
                    createdAt: now,
                  },
                  ...prev.auditLogs,
                ],
              }));
            } else if (fbUser) {
              await adminSaveDragonLevelFirestore(
                fbUser.uid,
                fbUser.email || 'admin',
                lvl
              );
            }
            showNotice(`Konfigurasi Level ${lvl.level} berhasil diperbarui!`, 'success');
          }}
          onSaveGameSettings={async (newSettings) => {
            if (!(await verifyAdminActionServerSide('SAVE_GAME_SETTINGS'))) return;
            const now = new Date().toISOString();
            if (adminSession?.token) {
              await Promise.all([
                fetch('/api/admin/economic-config', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminSession.token}`,
                  },
                  body: JSON.stringify({
                    coinsPerTap: newSettings.coinsPerTap,
                    energyCostPerTap: newSettings.energyCostPerTap,
                    energyRegenPerMinute: newSettings.energyRegenPerMinute,
                    coinsPerFireConvert: newSettings.coinsPerFireConvert,
                    maxDailyFireConvert: newSettings.maxDailyFireConvert,
                    minWithdrawIdr: newSettings.minWithdrawIdr,
                    referralActiveFireReward: newSettings.referralRewardFire,
                    referralUpgradeCoinReward: newSettings.referralRewardCoin,
                  }),
                }).catch(() => {}),
                fetch('/api/admin/config/save', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminSession.token}`,
                  },
                  body: JSON.stringify({ settings: newSettings }),
                }).catch(() => {}),
              ]);
            }
            if (isSandboxMode) {
              setSandbox((prev) => ({
                ...prev,
                settings: newSettings,
                auditLogs: [
                  {
                    id: `aud_set_${Date.now()}`,
                    adminUid: adminSession?.uid || 'admin_root',
                    adminEmail: adminSession?.username || 'admin',
                    action: 'SIMPAN PENGATURAN EKONOMI',
                    targetUid: 'global',
                    details: `Tap Dasar=${newSettings.coinsPerTap} Koin, Min Withdraw=${newSettings.minWithdrawIdr.toLocaleString('id-ID')} Koin`,
                    createdAt: now,
                  },
                  ...prev.auditLogs,
                ],
              }));
            } else if (fbUser) {
              await adminSaveGameSettingsFirestore(
                fbUser.uid,
                fbUser.email || 'admin',
                newSettings
              );
            }
            showNotice('Pengaturan ekonomi COINOVA berhasil disimpan!', 'success');
          }}
          busyAction={busyAction}
        />
      </>
    );
  }

  // ============================================================================
  // ENTRY POINT: LOGIN USER / REGISTER USER / LOGIN ADMIN
  // ============================================================================
  if (userSessionToken && isRestoringServerSession) {
    return (
      <div className="min-h-[100dvh] w-full bg-[#040406] text-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-3xl border border-[#FFEA00]/25 bg-[#0A0A0D]/95 p-6 text-center shadow-2xl">
          <div className="text-[#FFEA00] text-sm font-black tracking-[0.18em]">COINOVA</div>
          <div className="mt-3 text-base font-black">MEMUAT DATA AKUN</div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">Saldo, Core Energy, level, dan progress sedang diverifikasi dari server.</p>
          <div className="mt-5 mx-auto h-1.5 w-32 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/2 animate-pulse rounded-full bg-[#FFEA00]" /></div>
        </div>
      </div>
    );
  }

  if (userSessionToken && serverSessionRestoreError) {
    return (
      <div className="min-h-[100dvh] w-full bg-[#040406] text-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-3xl border border-red-400/25 bg-[#0A0A0D]/95 p-6 text-center shadow-2xl">
          <div className="text-red-300 text-sm font-black tracking-[0.18em]">COINOVA • SERVER</div>
          <div className="mt-3 text-base font-black">DATA AKUN BELUM TERBACA</div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">COINOVA menolak menampilkan saldo 0 atau Energy penuh sebagai pengganti data asli.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 w-full rounded-2xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-3 text-xs font-black uppercase tracking-wider text-black">COBA LAGI</button>
        </div>
      </div>
    );
  }

  if (!isUserAuthenticated && !fbUser) {
    const handleAuthSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (loginBusy) return;
      setLoginErrorText(null);

      const cleanUsername = loginUsernameInput.trim();
      if (cleanUsername.length < 3) {
        setLoginErrorText('Username wajib diisi minimal 3 karakter.');
        return;
      }
      if (loginPasswordInput.length < 4) {
        setLoginErrorText('Password wajib diisi minimal 4 karakter.');
        return;
      }
      if (
        authTab === 'REGISTER' &&
        loginPasswordInput !== loginConfirmPasswordInput
      ) {
        setLoginErrorText('Konfirmasi password tidak cocok.');
        return;
      }

      setLoginBusy(true);
      try {
        const endpoint =
          authTab === 'REGISTER' ? '/api/auth/register' : '/api/auth/login';
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: cleanUsername,
            password: loginPasswordInput,
            confirmPassword: loginConfirmPasswordInput,
            referralCodeInput: loginReferralInput.trim().toUpperCase(),
          }),
        });
        let data: any = null;
        try {
          data = await resp.json();
        } catch {
          setLoginErrorText('Gagal menghubungi server autentikasi. Coba lagi.');
          return;
        }
        if (!resp.ok || !data?.ok || !data?.session?.token) {
          setLoginErrorText(
            data?.error ||
              (authTab === 'REGISTER'
                ? 'Gagal membuat akun. Coba username lain.'
                : 'Username atau password salah.')
          );
          return;
        }

        const token = String(data.session.token);
        const srvUser = data.user || {};
        sessionStorage.setItem(USER_SESSION_STORAGE_KEY, token);
        setUserSessionToken(token);

        if (authTab === 'REGISTER') {
          // Brand new account MUST ALWAYS start from ZERO (0 Koin, 0 Diamond, Level 1 Free, empty history)
          const cleanState = createCleanUserSandboxState({
            uid: srvUser.uid,
            username: srvUser.username || cleanUsername,
            referralCode: srvUser.referralCode,
            referredByCode: srvUser.referredByCode,
          });
          try {
            localStorage.removeItem(getSandboxStorageKeyForUser(cleanState.user.uid));
            localStorage.setItem(SHARE_COUNT_STORAGE_KEY, '0');
          } catch {
            // ignore
          }
          setShareCount(0);
          setSandbox(cleanState);
        } else {
          const baseState = createCleanUserSandboxState({
                uid: srvUser.uid,
                username: srvUser.username || cleanUsername,
                referralCode: srvUser.referralCode,
                referredByCode: srvUser.referredByCode,
              });

          const nextCoinBalance =
            typeof srvUser.coinBalance === 'number'
              ? srvUser.coinBalance
              : baseState.wallet.coinBalance;
          const nextFireBalance =
            typeof srvUser.fireBalance === 'number'
              ? srvUser.fireBalance
              : baseState.wallet.fireBalance;
          const nextLevel = Number(
            srvUser.dragonLevel || baseState.user.dragonLevel || 1
          );
          const nextMaxEnergy = Number(
            srvUser.maxEnergy || baseState.wallet.maxEnergy || 100
          );
          const nextEnergy = Number(
            srvUser.energy ?? baseState.wallet.energy ?? 100
          );

          setSandbox({
            ...baseState,
            user: {
              ...baseState.user,
              uid: srvUser.uid || baseState.user.uid,
              username: srvUser.username || cleanUsername,
              referralCode: srvUser.referralCode || baseState.user.referralCode,
              referredByCode:
                srvUser.referredByCode ?? baseState.user.referredByCode,
              dragonLevel: nextLevel,
            },
            profile: {
              ...baseState.profile,
              uid: srvUser.uid || baseState.profile.uid,
              fullName:
                baseState.profile.fullName || srvUser.username || cleanUsername,
              ewalletAccountName:
                baseState.profile.ewalletAccountName ||
                srvUser.username ||
                cleanUsername,
            },
            wallet: {
              ...baseState.wallet,
              uid: srvUser.uid || baseState.wallet.uid,
              coinBalance: nextCoinBalance,
              idrBalance: nextCoinBalance,
              fireBalance: nextFireBalance,
              energy: nextEnergy,
              maxEnergy: nextMaxEnergy,
            },
          });
        }

        setLoginPasswordInput('');
        setLoginConfirmPasswordInput('');
        setIsUserAuthenticated(true);
        setActiveTab('HOME');
        window.history.replaceState({}, '', '/');
        showNotice(
          authTab === 'REGISTER'
            ? `Akun ${srvUser.username || cleanUsername} berhasil dibuat! Selamat datang di COINOVA.`
            : `Selamat datang kembali di COINOVA, ${srvUser.username || cleanUsername}!`,
          'success'
        );
      } catch {
        setLoginErrorText('Gagal menghubungi server autentikasi. Coba lagi.');
      } finally {
        setLoginBusy(false);
      }
    };

    return (
      <div className="coinova-hud-bg flex min-h-[100dvh] w-full items-center justify-center bg-[#040406] px-4 py-8 text-white select-none">
        <div className="w-full max-w-[400px] rounded-[28px] border border-[#FFEA00]/40 bg-[#0A0A0E]/95 p-6 shadow-[0_0_50px_rgba(255,234,0,0.16)]">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#FFEA00]/55 bg-[#14130B] shadow-[0_0_24px_rgba(255,234,0,0.28)]">
              <CoinovaLogoMark className="h-11 w-11" />
            </div>
            <span className="mt-3 rounded-full border border-[#FFEA00]/45 bg-[#FFEA00]/10 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-[#FFEA00]">
              COINOVA OFFICIAL PORTAL
            </span>
            <h1 className="mt-2 font-display text-2xl font-black tracking-tight text-white">
              {authTab === 'LOGIN' ? 'LOGIN USER COINOVA' : 'REGISTER USER BARU'}
            </h1>
            <p className="mt-1 text-xs text-zinc-400">
              {authTab === 'LOGIN'
                ? 'Masuk ke akun COINOVA Anda menggunakan Username & Password.'
                : 'Buat akun baru COINOVA untuk mulai mengumpulkan Koin & Diamond.'}
            </p>
          </div>

          {/* 2 Primary Options: A. LOGIN USER | B. REGISTER USER */}
          <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-[#FACC15]/30 bg-[#07070A] p-1">
            <button
              type="button"
              onClick={() => {
                setAuthTab('LOGIN');
                setLoginErrorText(null);
              }}
              className={`rounded-xl py-2.5 text-xs font-black uppercase tracking-wider transition ${
                authTab === 'LOGIN'
                  ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A] shadow-[0_0_14px_rgba(255,234,0,0.35)]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              LOGIN USER
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab('REGISTER');
                setLoginErrorText(null);
              }}
              className={`rounded-xl py-2.5 text-xs font-black uppercase tracking-wider transition ${
                authTab === 'REGISTER'
                  ? 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A] shadow-[0_0_14px_rgba(255,234,0,0.35)]'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              REGISTER USER
            </button>
          </div>

          {(loginErrorText || toast) && (
            <div
              className={`mt-4 rounded-xl border px-3.5 py-2.5 text-center text-xs font-extrabold ${
                loginErrorText || toast?.type === 'error'
                  ? 'border-red-400/50 bg-red-500/15 text-red-200'
                  : 'border-[#FFEA00]/50 bg-[#FFEA00]/15 text-[#FFEA00]'
              }`}
            >
              {loginErrorText || toast?.text}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="mt-4 space-y-3.5">
            <div>
              <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wider text-[#FACC15]">
                Username
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={loginUsernameInput}
                onChange={(e) => {
                  setLoginUsernameInput(e.target.value);
                  setLoginErrorText(null);
                }}
                placeholder="Masukkan username (contoh: Keylaa.)"
                className="w-full rounded-xl border border-[#FACC15]/30 bg-[#07070A] px-3.5 py-3 text-xs font-bold text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wider text-[#FACC15]">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete={
                  authTab === 'REGISTER' ? 'new-password' : 'current-password'
                }
                value={loginPasswordInput}
                onChange={(e) => {
                  setLoginPasswordInput(e.target.value);
                  setLoginErrorText(null);
                }}
                placeholder="Masukkan password akun"
                className="w-full rounded-xl border border-[#FACC15]/30 bg-[#07070A] px-3.5 py-3 text-xs font-bold text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
              />
            </div>

            {authTab === 'REGISTER' && (
              <>
                <div>
                  <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wider text-[#FACC15]">
                    Konfirmasi Password
                  </label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={loginConfirmPasswordInput}
                    onChange={(e) => {
                      setLoginConfirmPasswordInput(e.target.value);
                      setLoginErrorText(null);
                    }}
                    placeholder="Ulangi password akun"
                    className="w-full rounded-xl border border-[#FACC15]/30 bg-[#07070A] px-3.5 py-3 text-xs font-bold text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wider text-zinc-400">
                    Kode Referral Pengundang (Opsional)
                  </label>
                  <input
                    type="text"
                    value={loginReferralInput}
                    onChange={(e) =>
                      setLoginReferralInput(e.target.value.toUpperCase())
                    }
                    placeholder="Contoh: F11B4A"
                    className="font-mono-num w-full rounded-xl border border-white/15 bg-[#07070A] px-3.5 py-2.5 text-xs font-bold uppercase text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loginBusy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-3.5 text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_24px_rgba(255,234,0,0.4)] transition active:scale-[0.99] disabled:opacity-50"
            >
              <span>
                {loginBusy
                  ? 'MEMPROSES...'
                  : authTab === 'REGISTER'
                  ? 'BUAT AKUN & MASUK'
                  : 'LOGIN SEKARANG'}
              </span>
            </button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              PORTAL ADMINISTRATOR
            </span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <button
            type="button"
            onClick={() => {
              window.history.replaceState({}, '', '/#admin');
              setIsAdminRoute(true);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#FFEA00]/40 bg-[#14130B] py-3 text-xs font-black uppercase tracking-wider text-[#FFEA00] transition hover:bg-[#FFEA00]/15 active:scale-[0.99]"
          >
            <NovaDiamondIcon className="h-4 w-4" />
            <span>LOGIN ADMIN</span>
          </button>

          <PWAInstallButton variant="button" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-[#040406] text-white">
      {/* Centered Mobile Viewport Shell */}
      <div className="relative mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-[#060608] shadow-[0_0_50px_rgba(0,0,0,0.95)]">
        <PWAInstallButton variant="banner" />
        {/* Global Toast Feedback Banner */}
        {toast && (
          <div className="fixed left-1/2 top-3 z-50 w-[92%] max-w-[390px] -translate-x-1/2">
            <div
              className={`flex items-center justify-between gap-2 rounded-2xl border px-4 py-2.5 text-xs font-extrabold shadow-2xl backdrop-blur-md ${
                toast.type === 'error'
                  ? 'border-red-400/60 bg-[#1A0808]/95 text-red-200'
                  : 'border-[#FFEA00]/65 bg-[#14130B]/95 text-[#FFEA00] shadow-[0_0_24px_rgba(255,234,0,0.28)]'
              }`}
            >
              <span>{toast.text}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="ml-2 text-xs text-white/75 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Active View Content */}
        <main
          className={`min-h-0 flex-1 ${
            activeTab === 'HOME'
              ? 'overflow-hidden'
              : 'overflow-y-auto no-scrollbar'
          }`}
        >
          {activeTab === 'HOME' && (
            <HomeView
              user={currentUser}
              wallet={currentWallet}
              settings={currentSettings}
              levels={currentLevels}
              upgradeOrders={currentUpgradeOrders}
              rewardCodes={currentCodes}
              rewardCodeClaims={currentRewardCodeClaims}
              notifications={currentNotifications}
              transactions={currentTransactions}
              onTapTrigger={handleTapTrigger}
              onClaimCycleReward={handleClaimCycleReward}
              onCompleteDiamondChallenge={handleCompleteDiamondChallenge}
              onClaimCheckIn={handleClaimCheckIn}
              onCreateUpgradeOrder={handleCreateUpgradeOrder}
              onConfirmUpgradePayment={handleConfirmUpgradePayment}
              onConvertCoinToFire={handleConvertCoinToFire}
              onRedeemCode={handleRedeemCode}
              onMarkNotificationsRead={handleMarkNotificationsRead}
              onNavigateTab={(t) => {
                flushCloudTapBuffer();
                void flushServerTapQueue();
                setActiveTab(t);
              }}
              busyAction={busyAction}
              openUpgradeSignal={openUpgradeSignal}
              onConsumeUpgradeSignal={() => setOpenUpgradeSignal(0)}
              onSyncServerWalletAndVip={handleServerFeatureSync}
            />
          )}

          {activeTab === 'TASK' && (
            <TaskView
              user={currentUser}
              wallet={currentWallet}
              tasks={currentTasks}
              taskClaims={currentClaims}
              referrals={currentReferrals}
              shareCount={shareCount}
              onClaimCheckIn={handleClaimCheckIn}
              onClaimTask={handleClaimTask}
              onNavigateTab={(t) => {
                flushCloudTapBuffer();
                void flushServerTapQueue();
                setActiveTab(t);
              }}
              onOpenUpgrade={handleOpenUpgradePage}
              busyAction={busyAction}
              onSyncServerWalletAndVip={handleServerFeatureSync}
            />
          )}

          {activeTab === 'INVITE' && (
            <InviteView
              user={currentUser}
              wallet={currentWallet}
              settings={currentSettings}
              referrals={currentReferrals}
              taskClaims={currentClaims}
              onBindReferralCode={handleBindReferralCode}
              onRecordShare={handleRecordShare}
              onNavigateTab={(t) => {
                flushCloudTapBuffer();
                setActiveTab(t);
              }}
              busyAction={busyAction}
            />
          )}

          {activeTab === 'WITHDRAW' && (
            <WithdrawView
              user={currentUser}
              wallet={currentWallet}
              profile={currentProfile}
              settings={currentSettings}
              withdrawals={currentWithdrawals}
              transactions={currentTransactions}
              onConvertCoinToFire={handleConvertCoinToFire}
              onRequestWithdrawal={handleRequestWithdrawal}
              onSaveEwalletMethod={async (
                ewMethod,
                ewAccountNumber,
                ewAccountName
              ) => {
                await handleSaveProfile(currentUser.username, {
                  fullName: currentProfile.fullName || ewAccountName,
                  phone: currentProfile.phone || ewAccountNumber,
                  defaultEwallet: ewMethod,
                  ewalletNumber: ewAccountNumber,
                  ewalletAccountName: ewAccountName,
                  pinHash: currentProfile.pinHash || '',
                  notificationsEnabled: currentProfile.notificationsEnabled,
                });
              }}
              onOpenUpgrade={handleOpenUpgradePage}
              onNavigateTab={(t) => {
                flushCloudTapBuffer();
                setActiveTab(t);
              }}
              busyAction={busyAction}
            />
          )}

          {activeTab === 'PROFILE' && (
            <ProfileView
              user={currentUser}
              wallet={currentWallet}
              profile={currentProfile}
              levels={currentLevels}
              settings={currentSettings}
              transactions={currentTransactions}
              withdrawals={currentWithdrawals}
              isSandboxMode={isSandboxMode}
              onSaveProfile={handleSaveProfile}
              onRedeemCode={handleRedeemCode}
              onConvertCoinToFire={handleConvertCoinToFire}
              onSubmitBugReport={handleSubmitBugReport}
              onNavigateWithdraw={() => {
                flushCloudTapBuffer();
                setActiveTab('WITHDRAW');
              }}
              onNavigateTask={() => {
                flushCloudTapBuffer();
                setActiveTab('TASK');
              }}
              onNavigateHome={() => {
                flushCloudTapBuffer();
                setActiveTab('HOME');
              }}
              onOpenUpgrade={handleOpenUpgradePage}
              onSignOut={async () => {
                flushCloudTapBuffer();
                if (userSessionToken) {
                  await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${userSessionToken}` },
                  }).catch(() => {});
                }
                sessionStorage.removeItem(USER_SESSION_STORAGE_KEY);
                setUserSessionToken('');
                setIsUserAuthenticated(false);
                setSandbox(createCleanUserSandboxState());
                setLoginUsernameInput('');
                setLoginPasswordInput('');
                setLoginConfirmPasswordInput('');
                setLoginErrorText(null);
                setActiveTab('HOME');
                await signOut(auth).catch(() => {});
                setIsSandboxMode(true);
                window.history.replaceState({}, '', '/');
                showNotice('Logout berhasil. Silakan login kembali.', 'info');
              }}
              onSwitchToCloudAuth={async () => {
                try {
                  await signInWithPopup(auth, googleProvider);
                  showNotice('Berhasil terhubung dengan Google Cloud!', 'success');
                } catch {
                  showNotice(
                    'Login Google dibatalkan. Tetap di mode penyimpanan perangkat.',
                    'info'
                  );
                }
              }}
              onDeductCoinsForUgc={(newCoinBalance, costCoins) => {
                const now = new Date().toISOString();
                setSandbox((prev) => ({
                  ...prev,
                  wallet: {
                    ...prev.wallet,
                    coinBalance: newCoinBalance,
                    idrBalance: calculateIdrFromCoins(newCoinBalance),
                    updatedAt: now,
                  },
                  transactions: [
                    {
                      id: `tx_ugc_${Date.now()}`,
                      uid: prev.user.uid,
                      category: 'LEVEL',
                      direction: 'DEBIT',
                      currency: 'COIN',
                      amount: costCoins,
                      description: `Generate AI UGC Affiliate Studio (-${costCoins.toLocaleString('id-ID')} Koin)`,
                      referenceId: `ugc_${Date.now()}`,
                      createdAt: now,
                    },
                    ...prev.transactions,
                  ],
                }));
                showNotice(
                  `Prompt AI UGC berhasil dibuat! -${costCoins.toLocaleString('id-ID')} Koin dipotong.`,
                  'success'
                );
              }}
              busyAction={busyAction}
            />
          )}
        </main>

        {/* Bottom Navigation Bar (COINOVA Futuristic: Home, Task, Invite, Withdraw, Profile) */}
        <nav
          aria-label="Navigasi Utama COINOVA"
          className="z-40 w-full shrink-0 border-t border-[#FFEA00]/28 bg-[#08080B]/95 px-2.5 py-1.5 shadow-[0_-10px_30px_rgba(0,0,0,0.85)] backdrop-blur-xl"
        >
          <div className="grid grid-cols-5 gap-1.5">
            {(
              [
                { id: 'HOME', label: 'Home', icon: BottomNavHomeIcon },
                { id: 'TASK', label: 'Task', icon: BottomNavTaskIcon },
                { id: 'INVITE', label: 'Invite', icon: BottomNavInviteIcon },
                { id: 'WITHDRAW', label: 'Withdraw', icon: BottomNavWithdrawIcon },
                { id: 'PROFILE', label: 'Profile', icon: BottomNavProfileIcon },
              ] as {
                id: NavTab;
                label: string;
                icon: React.FC<{ className?: string }>;
              }[]
            ).map((item) => {
              const IconComp = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    flushCloudTapBuffer();
                    void flushServerTapQueue();
                    setActiveTab(item.id);
                  }}
                  className={`flex flex-col items-center justify-center rounded-2xl border py-1.5 transition-all ${
                    isActive
                      ? 'border-[#FFEA00]/65 bg-[#FFEA00]/15 text-[#FFEA00] shadow-[0_0_16px_rgba(255,234,0,0.22)]'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <IconComp
                    className={`h-5 w-5 transition-transform ${
                      isActive
                        ? 'scale-110 text-[#FFEA00] drop-shadow-[0_0_8px_rgba(255,234,0,0.75)]'
                        : ''
                    }`}
                  />
                  <span
                    className={`mt-0.5 text-[10px] font-extrabold tracking-wide ${
                      isActive ? 'text-[#FFEA00]' : 'text-zinc-400'
                    }`}
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
