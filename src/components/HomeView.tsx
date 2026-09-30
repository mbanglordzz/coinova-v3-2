import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DragonLevelConfig,
  GameSettings,
  LevelUpgradeOrder,
  NotificationItem,
  RewardCode,
  RewardCodeClaim,
  UpgradePaymentMethod,
  UserAccount,
  UserWallet,
  WalletTransaction,
} from '../types/dragon';
import {
  ECONOMY_CONFIG,
  getLevelEconomy,
} from '../config/economy';
import {
  CoinovaAvatarSvg,
  CoinovaLogoMark,
  CoinovaTapCoreReactor,
  NovaCoinIcon,
  NovaDiamondIcon,
  VerifiedBlueBadge,
} from './GameIllustrations';
import {
  CheckCircleNeonIcon,
  ClockNeonIcon,
  CloseIcon,
  OfficialQRISCodeDisplay,
  UploadNeonIcon,
  XCircleNeonIcon,
} from './DragonIcons';
import {
  ServerFeatureStatusData,
} from './CoinovaEventsAndVipModals';

interface HomeViewProps {
  user: UserAccount;
  wallet: UserWallet;
  settings: GameSettings;
  levels: DragonLevelConfig[];
  upgradeOrders: LevelUpgradeOrder[];
  rewardCodes: RewardCode[];
  rewardCodeClaims: RewardCodeClaim[];
  notifications: NotificationItem[];
  transactions?: WalletTransaction[];
  onTapTrigger: (
    tapCount?: number
  ) => Promise<{
    coins: number;
    fire: number;
    allowed: boolean;
    diamondChallenge?: {
      challengeId: string;
      question: string;
      rewardFire: number;
      expectedAnswer?: number;
    } | null;
  }>;
  onClaimCycleReward?: (bonusCoins: number, bonusFire?: number) => void;
  onCompleteDiamondChallenge?: (
    challengeId: string,
    answer: string,
    fallbackExpectedAnswer?: number,
    fallbackRewardFire?: number
  ) => Promise<{
    ok: boolean;
    correct: boolean;
    rewardFire: number;
    message: string;
  }>;
  onClaimCheckIn: (rewardCoins: number, rewardFire: number) => Promise<void>;
  onCreateUpgradeOrder: (
    targetLevel: DragonLevelConfig,
    paymentMethod: UpgradePaymentMethod
  ) => Promise<LevelUpgradeOrder | void>;
  onConfirmUpgradePayment: (
    orderId: string,
    paymentReference: string,
    paymentProofDataUrl?: string,
    paymentProofFileName?: string
  ) => Promise<void>;
  onConvertCoinToFire?: (fireToObtain: number) => Promise<void>;
  onRedeemCode: (code: string) => Promise<void>;
  onMarkNotificationsRead: () => Promise<void>;
  onNavigateTab: (tab: 'TASK' | 'INVITE' | 'WITHDRAW' | 'PROFILE') => void;
  onSyncServerWalletAndVip?: (payload: {
    coinBalance?: number;
    fireBalance?: number;
    isVip?: boolean;
    vipStatus?: 'NONE' | 'PENDING' | 'ACTIVE' | 'EXPIRED';
    vipExpiresAt?: string | null;
  }) => void;
  busyAction: string | null;
  openUpgradeSignal?: number;
  onConsumeUpgradeSignal?: () => void;
}

interface FloatingParticle {
  id: number;
  offsetX: number;
  offsetY: number;
  coins: number;
  fire: number;
}

interface FloatingTapParticlesHandle {
  spawn: (coins: number, fire: number) => void;
}

const FloatingTapParticles = React.memo(
  forwardRef<FloatingTapParticlesHandle>((_, ref) => {
    const [particles, setParticles] = useState<FloatingParticle[]>([]);
    const particleIdRef = useRef<number>(1);

    useImperativeHandle(
      ref,
      () => ({
        spawn(coins: number, fire: number) {
          const pid = particleIdRef.current++;
          const offsetX = Math.round((Math.random() - 0.5) * 44);
          const offsetY = Math.round((Math.random() - 0.5) * 26) - 18;

          setParticles((prev) => [
            ...prev.slice(-4),
            { id: pid, offsetX, offsetY, coins, fire },
          ]);

          window.setTimeout(() => {
            setParticles((prev) => prev.filter((p) => p.id !== pid));
          }, 560);
        },
      }),
      []
    );

    if (particles.length === 0) return null;

    return (
      <>
        {particles.map((pt) => (
          <div
            key={pt.id}
            style={{
              transform: `translate3d(${pt.offsetX}px, ${pt.offsetY}px, 0)`,
            }}
            className="pointer-events-none absolute left-1/2 top-1/2 z-30 will-change-transform"
          >
            <div className="animate-coin-float flex flex-col items-center gap-1">
              <div className="flex items-center gap-1.5 rounded-full border border-[#FFEA00]/80 bg-[#0E0E14]/95 px-3 py-1 text-xs font-black whitespace-nowrap text-[#FFEA00] shadow-[0_0_16px_rgba(255,234,0,0.4)]">
                <NovaCoinIcon className="h-4 w-4 shrink-0" />
                <span>+{pt.coins.toLocaleString('id-ID')} Koin</span>
              </div>
              {pt.fire > 0 && (
                <div className="flex items-center gap-1 rounded-full border border-[#FFEA00]/80 bg-[#14130B]/95 px-2.5 py-0.5 text-[11px] font-black whitespace-nowrap text-[#FFEA00]">
                  <NovaDiamondIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>+{pt.fire} Diamond</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </>
    );
  })
);

interface ActiveDiamondChallenge {
  challengeId: string;
  question: string;
  rewardFire: number;
  expectedAnswer?: number;
}

const TIER_BENEFITS: Record<number, string[]> = {
  1: [
    'Akses dasar aktivitas tap harian',
    'Kapasitas Core Energy standar',
    'Akses program referral & misi',
  ],
  2: [
    'Reward Tap 2x lebih tinggi',
    'Kapasitas Core Energy lebih besar',
    'Bonus aktivasi +15 Diamond',
  ],
  3: [
    'Reward Tap 5x lebih tinggi',
    'Kapasitas aktivitas & batas tap lebih besar',
    'Bonus aktivasi +30 Diamond',
  ],
  4: [
    'Reward Tap 30x lebih tinggi (+300/Tap)',
    'Kapasitas Core Energy 5.000 & +60 Bonus Diamond',
    'Akses eksklusif fitur Konversi Coin → Diamond',
  ],
  5: [
    'Reward Tap tertinggi 50x (+500/Tap)',
    'Kapasitas maksimal 10.000 Core Energy & +120 Bonus Diamond',
    'Akses penuh Konversi Coin → Diamond & prioritas WD',
  ],
};

function compressProofImageToDataUrl(file: File): Promise<string> {
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

export const HomeView: React.FC<HomeViewProps> = React.memo(({
  user,
  wallet,
  settings,
  levels,
  upgradeOrders,
  notifications,
  onTapTrigger,
  onCompleteDiamondChallenge,
  onCreateUpgradeOrder,
  onConfirmUpgradePayment,
  onMarkNotificationsRead,
  onSyncServerWalletAndVip,
  busyAction,
  openUpgradeSignal = 0,
  onConsumeUpgradeSignal,
}) => {
  const [hideBalance, setHideBalance] = useState<boolean>(false);
  const hideBalanceRef = useRef<boolean>(false);
  hideBalanceRef.current = hideBalance;

  const minEnergyPerTap = Math.max(1, settings.energyCostPerTap);
  const [isEnergyEmpty, setIsEnergyEmpty] = useState<boolean>(
    () => wallet.energy < minEnergyPerTap
  );

  // Instantaneous local refs for 0ms optimistic coin & energy display without re-rendering HomeView
  const localCoinsRef = useRef<number>(wallet.coinBalance);
  const localEnergyRef = useRef<number>(wallet.energy);
  const coinBalanceTextRef = useRef<HTMLParagraphElement | null>(null);
  const energyTextRef = useRef<HTMLSpanElement | null>(null);
  const energyBarFillRef = useRef<HTMLDivElement | null>(null);
  const coreBounceRef = useRef<HTMLDivElement | null>(null);
  const particlesRef = useRef<FloatingTapParticlesHandle | null>(null);

  const bounceTimeoutRef = useRef<number | null>(null);
  const lastTapEventMsRef = useRef<number>(0);
  const lastHandledSignalRef = useRef<number>(0);

  // Diamond Math Challenge Popup State (Anti-Spam Single-Submission)
  const [diamondChallenge, setDiamondChallenge] =
    useState<ActiveDiamondChallenge | null>(null);
  const diamondChallengeActiveRef = useRef<boolean>(false);
  diamondChallengeActiveRef.current = diamondChallenge !== null;
  const [challengeAnswerInput, setChallengeAnswerInput] = useState<string>('');
  const [challengeFeedback, setChallengeFeedback] = useState<{
    correct: boolean;
    text: string;
  } | null>(null);
  const [challengeSubmitting, setChallengeSubmitting] = useState<boolean>(false);
  const submittedChallengeIdsRef = useRef<Set<string>>(new Set());
  const challengeLockRef = useRef<boolean>(false);

  // Modals (Naikkan Level & Notifications)
  const [showUpgradeModal, setShowUpgradeModal] = useState<boolean>(false);
  const [selectedUpgradeLevelNum, setSelectedUpgradeLevelNum] = useState<number>(() =>
    Math.min(5, Math.max(2, user.dragonLevel < 5 ? user.dragonLevel + 1 : 5))
  );
  const [checkoutOrder, setCheckoutOrder] = useState<LevelUpgradeOrder | null>(null);
  const [paymentRefInput, setPaymentRefInput] = useState<string>('');
  const [proofDataUrl, setProofDataUrl] = useState<string>('');
  const [proofFileName, setProofFileName] = useState<string>('');
  const [proofError, setProofError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeQrisImageUrl, setActiveQrisImageUrl] = useState<string | null>(
    null
  );
  const [isLoadingQris, setIsLoadingQris] = useState<boolean>(false);

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
      // ignore network error
    } finally {
      setIsLoadingQris(false);
    }
  }, []);

  useEffect(() => {
    if (!showUpgradeModal) return;
    void fetchActiveQris();
    const handleFocus = () => {
      void fetchActiveQris();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [showUpgradeModal, checkoutOrder, fetchActiveQris]);

  const [showNotifModal, setShowNotifModal] = useState<boolean>(false);
  const [featureStatus, setFeatureStatus] =
    useState<ServerFeatureStatusData | null>(null);

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
          isVip: Boolean(data.isVip),
          vipStatus: data.vipStatus,
          vipExpiresAt: data.vipExpiresAt || null,
        });
      }
    } catch {
      // ignore network error
    }
  }, [user.uid, onSyncServerWalletAndVip]);

  useEffect(() => {
    void fetchFeatureStatus();
  }, [fetchFeatureStatus]);

  // Only open Upgrade Modal when an explicit new openUpgradeSignal arrives from another tab
  useEffect(() => {
    if (openUpgradeSignal > 0 && openUpgradeSignal !== lastHandledSignalRef.current) {
      lastHandledSignalRef.current = openUpgradeSignal;
      setSelectedUpgradeLevelNum(
        Math.min(5, Math.max(2, user.dragonLevel < 5 ? user.dragonLevel + 1 : 5))
      );
      setCheckoutOrder(null);
      setShowUpgradeModal(true);
      onConsumeUpgradeSignal?.();
    }
  }, [openUpgradeSignal, user.dragonLevel, onConsumeUpgradeSignal]);

  // Synchronize local optimistic coin balance ref & DOM text when authoritative wallet prop updates
  useEffect(() => {
    localCoinsRef.current = wallet.coinBalance;
    if (coinBalanceTextRef.current) {
      coinBalanceTextRef.current.textContent = hideBalance
        ? '•••••••• Koin'
        : `${wallet.coinBalance.toLocaleString('id-ID')} Koin`;
    }
  }, [wallet.coinBalance, hideBalance]);

  // Synchronize local optimistic energy ref & GPU progress bar when authoritative wallet prop updates
  useEffect(() => {
    localEnergyRef.current = wallet.energy;
    const empty = wallet.energy < minEnergyPerTap;
    setIsEnergyEmpty((prev) => (prev === empty ? prev : empty));

    if (energyTextRef.current) {
      energyTextRef.current.textContent = `${wallet.energy.toLocaleString(
        'id-ID'
      )}/${wallet.maxEnergy.toLocaleString('id-ID')}`;
    }
    if (energyBarFillRef.current) {
      const pct = Math.min(
        100,
        Math.max(0, Math.round((wallet.energy / Math.max(1, wallet.maxEnergy)) * 100))
      );
      energyBarFillRef.current.style.transform = `scaleX(${empty ? 0 : pct / 100})`;
    }
  }, [wallet.energy, wallet.maxEnergy, minEnergyPerTap]);

  useEffect(() => {
    return () => {
      if (bounceTimeoutRef.current) {
        window.clearTimeout(bounceTimeoutRef.current);
      }
    };
  }, []);

  const currentLevelCfg = useMemo(
    () => levels.find((l) => l.level === user.dragonLevel),
    [levels, user.dragonLevel]
  );
  const levelEconomy = useMemo(
    () => getLevelEconomy(user.dragonLevel, currentLevelCfg, settings),
    [user.dragonLevel, currentLevelCfg, settings]
  );

  const isVipActive = Boolean(featureStatus?.isVip || user.isVip);
  const perClickCoins = isVipActive
    ? Math.max(1, Math.round(levelEconomy.coinsPerTap * 1.1))
    : levelEconomy.coinsPerTap;

  const combinedNotifications = useMemo(() => {
    const serverList = featureStatus?.notifications || [];
    const seenIds = new Set<string>();
    const merged: NotificationItem[] = [];
    for (const item of [...serverList, ...notifications]) {
      if (item && item.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        merged.push(item);
      }
    }
    return merged;
  }, [featureStatus?.notifications, notifications]);

  const unreadCount = useMemo(
    () => combinedNotifications.filter((n) => !n.isRead).length,
    [combinedNotifications]
  );
  const activeBroadcast = featureStatus?.activeBroadcasts?.[0] || null;
  const myOrders = useMemo(
    () => upgradeOrders.filter((o) => o.uid === user.uid),
    [upgradeOrders, user.uid]
  );

  // Dedicated Tap Coin Handler — Instantaneous Optimistic UI (0ms latency, 0 full-component re-render)
  const handleTapCore = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.stopPropagation();

      const nowMs = performance.now();
      if (nowMs - lastTapEventMsRef.current < 25) {
        return;
      }
      lastTapEventMsRef.current = nowMs;

      if (localEnergyRef.current < minEnergyPerTap) {
        setIsEnergyEmpty(true);
        void onTapTrigger(1);
        return;
      }

      // 1. Update local optimistic coin & energy refs + DOM text nodes IMMEDIATELY (0ms, no React tree diff)
      const nextCoins = localCoinsRef.current + perClickCoins;
      const nextEnergy = Math.max(0, localEnergyRef.current - minEnergyPerTap);
      localCoinsRef.current = nextCoins;
      localEnergyRef.current = nextEnergy;

      if (!hideBalanceRef.current && coinBalanceTextRef.current) {
        coinBalanceTextRef.current.textContent = `${nextCoins.toLocaleString(
          'id-ID'
        )} Koin`;
      }

      if (energyTextRef.current) {
        energyTextRef.current.textContent = `${nextEnergy.toLocaleString(
          'id-ID'
        )}/${wallet.maxEnergy.toLocaleString('id-ID')}`;
      }

      const nowEmpty = nextEnergy < minEnergyPerTap;
      if (energyBarFillRef.current) {
        const pct = Math.min(
          100,
          Math.max(0, Math.round((nextEnergy / Math.max(1, wallet.maxEnergy)) * 100))
        );
        energyBarFillRef.current.style.transform = `scaleX(${
          nowEmpty ? 0 : pct / 100
        })`;
      }

      if (nowEmpty) {
        setIsEnergyEmpty(true);
      }

      // 2. GPU-accelerated scale3d bounce via ref (0 React re-renders) + isolated floating +10 particle
      if (coreBounceRef.current) {
        coreBounceRef.current.style.transform = 'scale3d(0.94, 0.94, 1)';
      }
      if (bounceTimeoutRef.current) {
        window.clearTimeout(bounceTimeoutRef.current);
      }
      bounceTimeoutRef.current = window.setTimeout(() => {
        if (coreBounceRef.current) {
          coreBounceRef.current.style.transform = 'scale3d(1, 1, 1)';
        }
      }, 105);

      particlesRef.current?.spawn(perClickCoins, 0);

      // 3. Queue tap in background batched server sync
      void onTapTrigger(1).then((res) => {
        if (!res.allowed) {
          if (localEnergyRef.current < minEnergyPerTap) {
            setIsEnergyEmpty(true);
          }
          return;
        }

        if (
          res.diamondChallenge &&
          !diamondChallengeActiveRef.current &&
          !submittedChallengeIdsRef.current.has(res.diamondChallenge.challengeId)
        ) {
          setChallengeAnswerInput('');
          setChallengeFeedback(null);
          setChallengeSubmitting(false);
          challengeLockRef.current = false;
          setDiamondChallenge(res.diamondChallenge);
        }
      });
    },
    [minEnergyPerTap, onTapTrigger, perClickCoins, wallet.maxEnergy]
  );

  const handleSubmitDiamondChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!diamondChallenge) return;
    if (
      challengeLockRef.current ||
      challengeSubmitting ||
      challengeFeedback !== null ||
      submittedChallengeIdsRef.current.has(diamondChallenge.challengeId)
    ) {
      return;
    }

    const trimmedAnswer = challengeAnswerInput.trim();
    if (!trimmedAnswer) return;

    challengeLockRef.current = true;
    setChallengeSubmitting(true);
    submittedChallengeIdsRef.current.add(diamondChallenge.challengeId);

    try {
      if (onCompleteDiamondChallenge) {
        const result = await onCompleteDiamondChallenge(
          diamondChallenge.challengeId,
          trimmedAnswer,
          diamondChallenge.expectedAnswer,
          diamondChallenge.rewardFire
        );
        setChallengeFeedback({
          correct: result.correct,
          text: result.correct
            ? `Benar! +${result.rewardFire} Diamond 💎`
            : 'Jawaban salah. Diamond tidak didapat.',
        });
      } else {
        const numericAns = Number(trimmedAnswer);
        const isCorrect =
          Number.isFinite(numericAns) &&
          diamondChallenge.expectedAnswer !== undefined &&
          numericAns === diamondChallenge.expectedAnswer;
        setChallengeFeedback({
          correct: isCorrect,
          text: isCorrect
            ? `Benar! +${diamondChallenge.rewardFire} Diamond 💎`
            : 'Jawaban salah. Diamond tidak didapat.',
        });
      }
    } finally {
      setChallengeSubmitting(false);
    }
  };

  const handleCloseDiamondChallenge = () => {
    setDiamondChallenge(null);
    setChallengeAnswerInput('');
    setChallengeFeedback(null);
    setChallengeSubmitting(false);
    challengeLockRef.current = false;
  };

  const handleOpenUpgradeModalExplicit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckoutOrder(null);
    setSelectedUpgradeLevelNum(
      Math.min(5, Math.max(2, user.dragonLevel < 5 ? user.dragonLevel + 1 : 5))
    );
    setShowUpgradeModal(true);
  };

  const handleProceedToPaymentScreen = async (levelNum: number) => {
    const targetCfg =
      levels.find((l) => l.level === levelNum) ||
      levels[levels.length - 1];
    if (!targetCfg) return;

    setProofError(null);
    setProofDataUrl('');
    setProofFileName('');
    setPaymentRefInput('');

    const existing = myOrders.find(
      (o) =>
        o.targetLevel === targetCfg.level &&
        (o.status === 'WAITING_PAYMENT' || o.status === 'PENDING_VERIFICATION')
    );

    if (existing) {
      setCheckoutOrder(existing);
      setProofDataUrl(existing.paymentProofDataUrl || existing.paymentProofImage || '');
      setProofFileName(existing.paymentProofFileName || '');
      return;
    }

    const created = await onCreateUpgradeOrder(targetCfg, 'QRIS');
    if (created) {
      setCheckoutOrder(created);
    } else if (targetCfg.level > user.dragonLevel) {
      const now = new Date().toISOString();
      const targetEcon = getLevelEconomy(targetCfg.level, targetCfg, settings);
      setCheckoutOrder({
        orderId: `ord_lvl${targetCfg.level}_${Date.now()}`,
        uid: user.uid,
        username: user.username,
        targetLevel: targetCfg.level,
        levelName: targetEcon.name,
        priceIdr: targetEcon.priceIdr || 100000,
        paymentMethod: 'QRIS',
        paymentReference: '-',
        status: 'WAITING_PAYMENT',
        adminNote: 'Menunggu pembayaran QRIS & upload bukti pembayaran.',
        createdAt: now,
        updatedAt: now,
      });
    }
  };

  const handleSelectProofFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setProofError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProofError('File bukti pembayaran harus berupa gambar (JPG/PNG/WebP).');
      return;
    }
    try {
      const compressed = await compressProofImageToDataUrl(file);
      setProofDataUrl(compressed);
      setProofFileName(file.name);
    } catch (err) {
      setProofError(
        err instanceof Error ? err.message : 'Gagal membaca gambar bukti pembayaran.'
      );
    }
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutOrder) return;
    if (!proofDataUrl) {
      setProofError('Silakan upload screenshot bukti pembayaran QRIS terlebih dahulu.');
      return;
    }
    const cleanRef =
      paymentRefInput.trim() || `QRIS-${Date.now().toString().slice(-6)}`;
    await onConfirmUpgradePayment(
      checkoutOrder.orderId,
      cleanRef,
      proofDataUrl,
      proofFileName || 'bukti_qris.jpg'
    );
    setCheckoutOrder((prev) =>
      prev
        ? {
            ...prev,
            status: 'PENDING_VERIFICATION',
            paymentReference: cleanRef,
            paymentProofDataUrl: proofDataUrl,
            paymentProofFileName: proofFileName || 'bukti_qris.jpg',
            adminNote: 'Menunggu Verifikasi Admin',
          }
        : null
    );
  };

  const energyPercent = Math.min(
    100,
    Math.max(
      0,
      Math.round((localEnergyRef.current / Math.max(1, wallet.maxEnergy)) * 100)
    )
  );

  const selectedTargetLevelCfg =
    levels.find((l) => l.level === selectedUpgradeLevelNum) ||
    levels[levels.length - 1];
  const selectedTargetEcon = getLevelEconomy(
    selectedUpgradeLevelNum,
    selectedTargetLevelCfg,
    settings
  );

  return (
    <div className="coinova-hud-bg relative flex h-full w-full flex-col justify-between overflow-y-auto no-scrollbar px-3.5 pt-3 pb-3 select-none">
      {/* ====================================================================
          1. FUTURISTIC COINOVA HEADER (BRAND, USER, BADGE, CURRENCY, NOTIF)
         ==================================================================== */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        {/* Left: Avatar + Brand COINOVA + Username & Level Badge */}
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-[#FFEA00]/65 bg-[#0A0A0E] shadow-[0_0_14px_rgba(255,234,0,0.22)]">
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

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <CoinovaLogoMark className="h-4 w-4 shrink-0" />
              <span className="font-display text-[11px] font-black tracking-[0.18em] text-[#FFEA00]">
                COINOVA
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="truncate text-[15px] font-extrabold text-white">
                {user.username}
              </span>
              <span className="shrink-0 rounded-md border border-[#FFEA00]/45 bg-[#FFEA00]/15 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[#FDE047]">
                {levelEconomy.titleBadge}
              </span>
              {isVipActive && (
                <span className="shrink-0 rounded-md border border-[#FFEA00] bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-1.5 py-0.5 text-[9.5px] font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_10px_rgba(255,234,0,0.45)]">
                  👑 VIP
                </span>
              )}
              <VerifiedBlueBadge className="h-4 w-4 shrink-0" />
            </div>
          </div>
        </div>

        {/* Right: Diamond Counter + Notification Bell */}
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex items-center gap-1.5 rounded-full border border-[#FACC15]/35 bg-[#0B0C10]/90 px-2.5 py-1">
            <NovaDiamondIcon className="h-4 w-4 shrink-0" />
            <span className="font-mono-num text-[12.5px] font-extrabold text-[#FDE047]">
              {wallet.fireBalance.toLocaleString('id-ID')}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowNotifModal(true);
              onMarkNotificationsRead();
            }}
            aria-label="Notifikasi"
            className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[#FACC15]/35 bg-[#12110B] text-[#FFEA00] shadow active:scale-95"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4.5 w-4.5">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#FFEA00] text-[9px] font-black text-[#08080A]">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ====================================================================
          2. UNIFIED "KOIN SAYA" CARD (SINGLE PRIMARY BALANCE)
         ==================================================================== */}
      <div className="coinova-card-glow relative mt-2.5 shrink-0 rounded-[22px] p-3.5">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[22px]">
          <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[#FFEA00]/12 blur-2xl" />
        </div>

        {/* Top Row: KOIN SAYA + Eye Toggle */}
        <div className="relative z-10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <NovaCoinIcon className="h-4 w-4 shrink-0" />
            <span className="text-xs font-extrabold uppercase tracking-wider text-zinc-200">
              KOIN SAYA
            </span>
            <button
              type="button"
              onClick={() => setHideBalance((prev) => !prev)}
              aria-label="Sembunyikan atau tampilkan Koin"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-zinc-400 hover:text-[#FFEA00]"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
              </svg>
            </button>
          </div>

          <span className="text-[11px] font-bold text-zinc-400">
            Level {user.dragonLevel} ({levelEconomy.name})
          </span>
        </div>

        {/* Single Unified Koin Balance */}
        <p
          ref={coinBalanceTextRef}
          className="font-mono-num relative z-10 mt-1.5 text-[24px] leading-tight font-extrabold tracking-tight text-[#FFEA00] drop-shadow-[0_0_14px_rgba(255,234,0,0.32)]"
        >
          {hideBalance
            ? '•••••••• Koin'
            : `${localCoinsRef.current.toLocaleString('id-ID')} Koin`}
        </p>

        {/* Clean HUD Stat Mini Cards: Koin/Tap | Batas Aktivitas | Diamond */}
        <div className="relative z-10 mt-2.5 grid grid-cols-3 gap-1.5 sm:gap-2">
          <div className="flex min-w-0 flex-col justify-between rounded-xl border border-[#FACC15]/28 bg-[#0C0C10]/95 px-2.5 py-2">
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">
              Koin / Tap
            </p>
            <p className="font-mono-num mt-1 text-[11px] leading-snug font-extrabold text-[#FFEA00] sm:text-xs">
              +{perClickCoins.toLocaleString('id-ID')} Koin
            </p>
          </div>

          <div className="flex min-w-0 flex-col justify-between rounded-xl border border-[#FFEA00]/28 bg-[#0C0C10]/95 px-2.5 py-2">
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">
              Batas Tap
            </p>
            <p className="font-mono-num mt-1 text-[11px] leading-snug font-extrabold text-white sm:text-xs">
              {wallet.maxEnergy.toLocaleString('id-ID')}
            </p>
          </div>

          <div className="flex min-w-0 flex-col justify-between rounded-xl border border-[#FACC15]/28 bg-[#0C0C10]/95 px-2.5 py-2">
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">
              Diamond
            </p>
            <p className="font-mono-num mt-1 inline-flex items-center gap-1 text-[11px] leading-snug font-extrabold text-[#FDE047] sm:text-xs">
              <NovaDiamondIcon className="h-3.5 w-3.5 shrink-0" />
              <span>{wallet.fireBalance.toLocaleString('id-ID')}</span>
            </p>
          </div>
        </div>
      </div>

      {/* ====================================================================
          3. FUTURISTIC LEVEL & UPGRADE HUD BAR ("Naikkan Level")
         ==================================================================== */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="coinova-card mt-2.5 flex shrink-0 items-center justify-between gap-2 rounded-2xl px-3.5 py-2.5"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#FFEA00]/45 bg-[#18160C] text-[#FFEA00]">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path
                d="M12 3L19 9.5L16.2 11.8L12 8.2L7.8 11.8L5 9.5L12 3Z"
                fill="currentColor"
              />
              <path
                d="M12 10L19 16.5L16.2 18.8L12 15.2L7.8 18.8L5 16.5L12 10Z"
                fill="currentColor"
                fillOpacity="0.6"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-extrabold text-white">
                Tier: {levelEconomy.name}
              </span>
              <span className="rounded bg-[#FFEA00]/15 px-1.5 py-0.5 text-[9.5px] font-bold text-[#FDE047]">
                {levelEconomy.tapMultiplier}x Multiplier
              </span>
              {isVipActive && (
                <span className="rounded bg-[#FFEA00]/20 px-1.5 py-0.5 text-[9px] font-black text-[#FFEA00]">
                  +10% VIP
                </span>
              )}
            </div>
            <p className="truncate text-[10.5px] text-zinc-400">
              Tingkatkan tier untuk melipatgandakan koin per klik &amp; kuota klaim
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpenUpgradeModalExplicit}
          className="flex shrink-0 items-center gap-1 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] px-3 py-2 text-[11px] font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_16px_rgba(255,234,0,0.35)] transition-transform active:scale-95"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path
              fillRule="evenodd"
              d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z"
              clipRule="evenodd"
            />
          </svg>
          <span>Naikkan Level</span>
        </button>
      </div>

      {activeBroadcast && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setShowNotifModal(true);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowNotifModal(true);
            }
          }}
          className="mt-1.5 flex shrink-0 cursor-pointer items-center justify-between gap-2 rounded-xl border border-[#FFEA00]/40 bg-[#14130B] px-3 py-1.5 text-[10.5px]"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-xs">📢</span>
            <span className="truncate font-extrabold text-[#FFEA00]">
              {activeBroadcast.title}:
            </span>
            <span className="truncate text-zinc-200">
              {activeBroadcast.content}
            </span>
          </div>
          <span className="shrink-0 text-[9.5px] font-bold text-[#FACC15]">
            Detail &gt;
          </span>
        </div>
      )}

      {/* ====================================================================
          4. MAIN FUTURISTIC INTERACTIVE CORE & TAP KOIN BUTTON
         ==================================================================== */}
      <div className="relative my-auto flex shrink-0 flex-col items-center justify-center py-2">
        {/* Isolated Floating Particles Layer (0 HomeView Re-Renders on Tap) */}
        <FloatingTapParticles ref={particlesRef} />

        {/* Centerpiece COINOVA Reactor Core (Dedicated Tap Area) */}
        <div
          ref={coreBounceRef}
          role="button"
          tabIndex={0}
          aria-label={`Tap Koin +${perClickCoins}`}
          onClick={handleTapCore}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleTapCore(e as unknown as React.MouseEvent<HTMLElement>);
            }
          }}
          className="cursor-pointer touch-manipulation rounded-full transition-transform duration-75 will-change-transform focus:outline-none"
        >
          <CoinovaTapCoreReactor
            perClickCoins={perClickCoins}
            className="h-[185px] w-[185px]"
          />
        </div>

        {/* Explicit Large "TAP KOIN (+X)" Action Button */}
        <button
          type="button"
          onClick={handleTapCore}
          disabled={isEnergyEmpty}
          className={`mt-2.5 flex touch-manipulation items-center justify-center gap-2 rounded-2xl border px-7 py-2 text-xs font-black uppercase tracking-[0.16em] transition-transform ${
            isEnergyEmpty
              ? 'cursor-not-allowed border-red-400/50 bg-red-500/15 text-red-300'
              : 'cursor-pointer border-[#FFEA00] bg-gradient-to-r from-[#FFEA00]/20 via-[#FACC15]/28 to-[#FFEA00]/20 text-[#FFEA00] shadow-[0_0_22px_rgba(255,234,0,0.28)] active:scale-95'
          }`}
        >
          <NovaCoinIcon className="h-4 w-4" />
          <span>
            {isEnergyEmpty
              ? 'CORE ENERGY HABIS'
              : `TAP KOIN (+${perClickCoins.toLocaleString('id-ID')})`}
          </span>
        </button>
      </div>

      {/* ====================================================================
          5. FUTURISTIC NEON HIGHLIGHTER YELLOW CORE ENERGY BAR (SERVER AUTHORITATIVE)
         ==================================================================== */}
      <div className="coinova-card shrink-0 rounded-2xl p-2.5">
        <div className="flex items-center justify-between gap-2 text-[11px] font-extrabold">
          <div className="flex items-center gap-1.5 text-[#FACC15]">
            <span>⚡</span>
            <span>CORE ENERGY</span>
            <span
              ref={energyTextRef}
              className={`font-mono-num ${
                isEnergyEmpty ? 'text-red-400' : 'text-white'
              }`}
            >
              {localEnergyRef.current.toLocaleString('id-ID')}/
              {wallet.maxEnergy.toLocaleString('id-ID')}
            </span>
          </div>

          <span className="text-[10px] font-bold text-zinc-400">
            Energi tidak beregenerasi otomatis
          </span>
        </div>

        {/* Neon Highlighter Yellow Progress Bar (GPU Transform ScaleX for 0 Reflow) */}
        <div className="relative mt-1.5 h-3 w-full overflow-hidden rounded-full border border-[#FFEA00]/35 bg-[#08080B]">
          <div
            ref={energyBarFillRef}
            className={`h-full w-full origin-left rounded-full transition-transform duration-100 will-change-transform ${
              isEnergyEmpty
                ? 'bg-red-500/70'
                : 'bg-gradient-to-r from-[#EAB308] via-[#FACC15] to-[#FFEA00] shadow-[0_0_12px_rgba(255,234,0,0.6)]'
            }`}
            style={{
              transform: `scaleX(${isEnergyEmpty ? 0 : energyPercent / 100})`,
            }}
          />
        </div>

        {isEnergyEmpty && (
          <p className="mt-1.5 text-center text-[10.5px] font-bold text-red-300">
            Core Energy habis! Upgrade level untuk mendapatkan kapasitas tap berikutnya.
          </p>
        )}
      </div>

      {/* ====================================================================
          MODAL 1: NAIKKAN LEVEL & QRIS PEMBAYARAN (PROFESSIONAL TIER DETAILS)
         ==================================================================== */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3.5 backdrop-blur-md">
          <div className="coinova-card-glow relative flex max-h-[90dvh] w-full max-w-[400px] flex-col overflow-hidden rounded-[24px] text-white">
            {/* Sticky Modal Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-[#FACC15]/25 bg-[#12110B] px-4 py-3.5">
              <div className="flex items-center gap-2">
                <CoinovaLogoMark className="h-5 w-5" />
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#FFEA00]">
                    {checkoutOrder
                      ? 'Pembayaran QRIS COINOVA'
                      : 'Naikkan Level COINOVA'}
                  </h3>
                  <p className="text-[10px] font-semibold text-zinc-400">
                    Tier Aktif Anda: {levelEconomy.name} (Lv.{user.dragonLevel} •{' '}
                    {levelEconomy.tapMultiplier}x)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCheckoutOrder(null);
                  setShowUpgradeModal(false);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white hover:border-[#FFEA00]"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            {!checkoutOrder ? (
              <div className="flex-1 space-y-3 overflow-y-auto no-scrollbar p-4">
                <p className="text-xs leading-relaxed text-zinc-300">
                  Pilih level untuk meningkatkan{' '}
                  <span className="font-bold text-[#FFEA00]">Koin per Tap</span>,{' '}
                  <span className="font-bold text-[#FACC15]">Batas Aktivitas</span>,
                  dan fitur eksklusif akun Anda:
                </p>

                {/* Simple, Clean, Dark Black + Highlighter Yellow Level Cards */}
                <div className="space-y-2.5">
                  {levels.map((lvl) => {
                    const econ = getLevelEconomy(lvl.level, lvl, settings);
                    const isCurrent = user.dragonLevel === lvl.level;
                    const isSelectable = lvl.level >= 2;
                    const isSelected = selectedUpgradeLevelNum === lvl.level;

                    return (
                      <div
                        key={lvl.level}
                        onClick={() => {
                          if (isSelectable) {
                            setSelectedUpgradeLevelNum(lvl.level);
                          }
                        }}
                        role={isSelectable ? 'button' : undefined}
                        tabIndex={isSelectable ? 0 : undefined}
                        onKeyDown={
                          isSelectable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedUpgradeLevelNum(lvl.level);
                                }
                              }
                            : undefined
                        }
                        className={`relative rounded-2xl border p-3.5 text-left transition ${
                          isSelected
                            ? 'border-[#FFEA00] bg-[#14130B] shadow-[0_0_18px_rgba(255,234,0,0.18)]'
                            : isCurrent
                            ? 'border-[#FACC15]/45 bg-[#101014]'
                            : 'border-white/10 bg-[#0A0A0E]'
                        } ${isSelectable ? 'cursor-pointer' : 'opacity-90'}`}
                      >
                        {/* Header: LEVEL + Multiplier & Harga Upgrade */}
                        <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black uppercase tracking-wide text-white">
                                LEVEL {econ.name.toUpperCase()}
                              </span>
                              {isCurrent && (
                                <span className="text-[10px] font-black uppercase text-[#FFEA00]">
                                  • AKTIF
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] font-bold text-[#FACC15]">
                              {econ.tapMultiplier}x Multiplier
                            </span>
                          </div>
                          <span className="font-mono-num text-sm font-black text-[#FFEA00]">
                            {econ.priceIdr === 0
                              ? 'GRATIS'
                              : `Rp ${econ.priceIdr.toLocaleString('id-ID')}`}
                          </span>
                        </div>

                        {/* Simple Spec List (Simplified: Referral Active & Upgrade Reward removed from card display) */}
                        <div className="mt-2.5 space-y-1.5 text-[11.5px]">
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-400">Koin per Tap</span>
                            <span className="font-mono-num font-extrabold text-[#FFEA00]">
                              +{econ.coinsPerTap.toLocaleString('id-ID')} Koin/Tap
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-400">Batas Tap (Core Energy)</span>
                            <span className="font-mono-num font-extrabold text-white">
                              {econ.maxEnergy.toLocaleString('id-ID')}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-400">Benefit Diamond</span>
                            <span className="font-mono-num inline-flex items-center gap-1 font-extrabold text-[#FDE047]">
                              <NovaDiamondIcon className="h-3.5 w-3.5 shrink-0" />
                              <span>+{lvl.dailyFireBonus} Diamond</span>
                            </span>
                          </div>
                          <div className="flex items-center justify-between border-t border-white/10 pt-1.5">
                            <span className="text-zinc-400">Konversi Koin → Diamond</span>
                            <span
                              className={`font-extrabold uppercase ${
                                econ.conversionAvailable
                                  ? 'text-[#FFEA00]'
                                  : 'text-zinc-500'
                              }`}
                            >
                              {econ.conversionAvailable ? 'TERSEDIA' : 'TIDAK TERSEDIA'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Active QRIS Preview in Upgrade Level Modal */}
                <div className="pt-1">
                  <OfficialQRISCodeDisplay
                    amountIdr={selectedTargetEcon.priceIdr}
                    orderId=""
                    merchantName={ECONOMY_CONFIG.QRIS_MERCHANT_NAME}
                    nmid={ECONOMY_CONFIG.QRIS_NMID}
                    qrisImageUrl={activeQrisImageUrl}
                    isLoadingQris={isLoadingQris}
                  />
                </div>

                {/* Sticky/Bottom Upgrade Action Button */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      handleProceedToPaymentScreen(selectedUpgradeLevelNum)
                    }
                    disabled={
                      busyAction === 'upgrade_order' ||
                      selectedUpgradeLevelNum <= user.dragonLevel
                    }
                    className={`h-11 w-full rounded-2xl text-xs font-black uppercase tracking-wider transition ${
                      selectedUpgradeLevelNum <= user.dragonLevel
                        ? 'cursor-not-allowed border border-[#FFEA00]/40 bg-[#16150C] text-[#FFEA00]'
                        : 'bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-[#08080A] shadow-[0_0_20px_rgba(255,234,0,0.35)] active:scale-[0.99]'
                    }`}
                  >
                    {busyAction === 'upgrade_order'
                      ? 'Memproses Order...'
                      : selectedUpgradeLevelNum <= user.dragonLevel
                      ? `Tier ${selectedTargetEcon.name} Sudah Aktif`
                      : `Upgrade ke Tier ${selectedTargetEcon.name} (Rp ${selectedTargetEcon.priceIdr.toLocaleString(
                          'id-ID'
                        )})`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 space-y-3 overflow-y-auto no-scrollbar p-4">
                <div className="rounded-2xl border border-[#FACC15]/25 bg-[#0C0C10] p-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Paket Tier:</span>
                    <span className="font-extrabold text-white">
                      Tier {checkoutOrder.levelName} (Lv.{checkoutOrder.targetLevel})
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-zinc-400">Nominal Pembayaran:</span>
                    <span className="font-mono-num font-extrabold text-[#FFEA00]">
                      Rp {checkoutOrder.priceIdr.toLocaleString('id-ID')}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-zinc-400">Status:</span>
                    {checkoutOrder.status === 'PENDING_VERIFICATION' ? (
                      <span className="inline-flex items-center gap-1 font-bold text-[#FACC15]">
                        <ClockNeonIcon className="h-3.5 w-3.5" />
                        Menunggu Verifikasi Admin
                      </span>
                    ) : checkoutOrder.status === 'PAID' ? (
                      <span className="inline-flex items-center gap-1 font-bold text-[#FFEA00]">
                        <CheckCircleNeonIcon className="h-3.5 w-3.5" />
                        Aktif
                      </span>
                    ) : checkoutOrder.status === 'REJECTED' ? (
                      <span className="inline-flex items-center gap-1 font-bold text-red-400">
                        <XCircleNeonIcon className="h-3.5 w-3.5" />
                        Ditolak
                      </span>
                    ) : (
                      <span className="font-bold text-white">Menunggu Pembayaran</span>
                    )}
                  </div>
                </div>

                <OfficialQRISCodeDisplay
                  amountIdr={checkoutOrder.priceIdr}
                  orderId={checkoutOrder.orderId}
                  merchantName={ECONOMY_CONFIG.QRIS_MERCHANT_NAME}
                  nmid={ECONOMY_CONFIG.QRIS_NMID}
                  qrisImageUrl={activeQrisImageUrl}
                  isLoadingQris={isLoadingQris}
                />

                <form onSubmit={handleSubmitProof} className="space-y-2.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleSelectProofFile}
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
                        : 'Upload Bukti Pembayaran QRIS'}
                    </span>
                  </button>

                  {proofDataUrl && (
                    <img
                      src={proofDataUrl}
                      alt="Preview Bukti QRIS"
                      className="mx-auto max-h-32 rounded-xl border border-[#FACC15]/30 object-contain"
                    />
                  )}

                  {proofError && (
                    <p className="text-center text-xs font-bold text-red-400">
                      {proofError}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCheckoutOrder(null)}
                      className="h-10 rounded-xl border border-white/15 bg-white/5 text-xs font-bold text-white"
                    >
                      Kembali
                    </button>
                    <button
                      type="submit"
                      disabled={busyAction === 'confirm_order'}
                      className="h-10 rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] text-xs font-black text-[#08080A]"
                    >
                      {busyAction === 'confirm_order'
                        ? 'Mengirim...'
                        : 'Kirim Bukti Bayar'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 2: NOTIFIKASI COINOVA
         ==================================================================== */}
      {showNotifModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div className="coinova-card-glow w-full max-w-[365px] overflow-hidden rounded-[24px] text-white">
            <div className="flex items-center justify-between border-b border-[#FACC15]/25 bg-[#12110B] px-4 py-3.5">
              <div className="flex items-center gap-2">
                <CoinovaLogoMark className="h-5 w-5" />
                <h3 className="text-sm font-extrabold uppercase tracking-wider text-[#FFEA00]">
                  Notifikasi COINOVA
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNotifModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-80 space-y-2.5 overflow-y-auto p-4">
              {combinedNotifications.length === 0 ? (
                <p className="py-4 text-center text-xs text-zinc-400">
                  Belum ada notifikasi baru.
                </p>
              ) : (
                combinedNotifications.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-2xl border border-[#FACC15]/25 bg-[#0C0C10] p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-extrabold text-[#FFEA00]">{n.title}</p>
                      {n.category && (
                        <span className="shrink-0 rounded border border-[#FFEA00]/35 bg-[#FFEA00]/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-[#FDE047]">
                          {n.category}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-zinc-300">{n.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL 3: POPUP CHALLENGE MATEMATIKA (BONUS DIAMOND 💎)
         ==================================================================== */}
      {diamondChallenge && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
        >
          <div className="coinova-card-glow w-full max-w-[350px] overflow-hidden rounded-[24px] border border-[#FFEA00]/55 bg-[#09090C] text-white shadow-[0_0_30px_rgba(255,234,0,0.22)]">
            <div className="flex items-center justify-between border-b border-[#FACC15]/25 bg-[#12110B] px-4 py-3.5">
              <div className="flex items-center gap-2">
                <NovaDiamondIcon className="h-5 w-5 shrink-0" />
                <h3 className="text-sm font-black uppercase tracking-wider text-[#FFEA00]">
                  BONUS DIAMOND 💎
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseDiamondChallenge}
                aria-label="Tutup"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/5 text-zinc-300 hover:border-[#FFEA00] hover:text-white"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 text-center">
              <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-300">
                Berapa hasilnya?
              </p>

              <div className="my-3.5 rounded-2xl border border-[#FFEA00]/45 bg-[#12110B] px-4 py-4 shadow-inner">
                <p className="font-mono-num text-2xl font-black tracking-wider text-[#FFEA00]">
                  {diamondChallenge.question}
                </p>
              </div>

              {!challengeFeedback ? (
                <form onSubmit={handleSubmitDiamondChallenge} className="space-y-3">
                  <input
                    type="number"
                    inputMode="numeric"
                    autoFocus
                    required
                    disabled={challengeSubmitting}
                    value={challengeAnswerInput}
                    onChange={(e) => setChallengeAnswerInput(e.target.value)}
                    placeholder="Jawaban"
                    className="font-mono-num w-full rounded-xl border border-[#FACC15]/40 bg-[#060608] px-4 py-3 text-center text-base font-extrabold text-white placeholder-zinc-500 outline-none focus:border-[#FFEA00]"
                  />

                  <button
                    type="submit"
                    disabled={
                      challengeSubmitting || challengeAnswerInput.trim().length === 0
                    }
                    className="w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-3 text-xs font-black uppercase tracking-widest text-[#08080A] shadow-[0_0_18px_rgba(255,234,0,0.35)] transition active:scale-95 disabled:opacity-50"
                  >
                    {challengeSubmitting ? 'MEMERIKSA...' : 'JAWAB'}
                  </button>
                </form>
              ) : (
                <div className="space-y-3">
                  <div
                    className={`rounded-2xl border px-4 py-3 text-xs font-extrabold ${
                      challengeFeedback.correct
                        ? 'border-[#FFEA00]/60 bg-[#FFEA00]/15 text-[#FFEA00]'
                        : 'border-zinc-700 bg-zinc-900/90 text-zinc-300'
                    }`}
                  >
                    {challengeFeedback.text}
                  </div>

                  <button
                    type="button"
                    onClick={handleCloseDiamondChallenge}
                    className="w-full rounded-xl bg-gradient-to-r from-[#FFEA00] to-[#FACC15] py-2.5 text-xs font-black uppercase tracking-wider text-[#08080A] shadow-[0_0_16px_rgba(255,234,0,0.3)] active:scale-95"
                  >
                    LANJUT TAP KOIN
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
