import { DragonLevelConfig, GameSettings, UserWallet } from '../types/dragon';

/**
 * ============================================================================
 * COINOVA — CENTRALIZED ECONOMY ENGINE (SINGLE SOURCE OF TRUTH)
 * ============================================================================
 * All conversions, tap rewards, tier multipliers, withdrawal rules,
 * and level upgrade prices are calculated strictly from this module.
 */

export const ECONOMY_CONSTANTS = {
  /** 10 Koin = Rp 1 (1.000 Koin = Rp 100 | 500.000 Koin = Rp 50.000) */
  COIN_TO_IDR_RATE: 0.1,
  /** 1.000 Koin = 1 Diamond via one-way conversion (Top 2 Tiers Lv.4 & Lv.5 only) */
  COINS_PER_ONE_FIRE_CONVERT: 1000,
  COINS_PER_FIRE_CONVERT: 1000,
  /** Maximum Diamond convertible per user per day (for eligible Top 2 Tiers) */
  MAX_DAILY_FIRE_CONVERT: 10,
  /** Minimum level required to access Coin -> Diamond conversion (Top 2 Tiers: Lv.4 Pro & Lv.5 Ultimate) */
  MIN_LEVEL_FOR_CONVERSION: 4,
  /** Rare Diamond drop probability per normal tap (5% server-controlled random chance for +1 Diamond) */
  DEFAULT_FIRE_DROP_CHANCE_PERCENT: 5,
  FIRE_DROP_CHANCE_PERCENT: 5,
  FIRE_TO_IDR_EQUIVALENT: 100,
  /** Cost in Koin per successful AI UGC Affiliate prompt generation */
  AI_UGC_GENERATE_COST_COINS: 10000,
  /** Minimum withdrawal in Koin (20.000 Koin -> 200 Diamond) */
  MIN_WITHDRAW_IDR: 20000,
  /** Required Diamond per 1.000 Koin withdrawn (10 Diamond per 1.000 Koin -> 20.000 Koin requires 200 Diamond) */
  FIRE_REQUIRED_PER_1000_IDR: 10,
  /** Official Merchant QRIS Info for Real-Money Level Upgrades */
  QRIS_MERCHANT_NAME: 'PT COINOVA DIGITAL NUSANTARA (COINOVA)',
  QRIS_NMID: 'ID202609278899101',
  OFFICIAL_PAYMENT_RECEIVER: '0812-8888-9999 a/n COINOVA Official',
  WITHDRAW_PROCESS_TIME_TEXT: '3x24 jam',
} as const;

export const ECONOMY_CONFIG = ECONOMY_CONSTANTS;

export interface LevelEconomyMeta {
  level: number;
  name: string;
  titleBadge: string;
  priceIdr: number;
  upgradePriceIdr: number;
  tapMultiplier: number;
  coinsPerTap: number;
  perClickCoins: number;
  idrPerTap: number;
  cycleBonusCoins: number;
  perCycleClaimCoins: number;
  maxEnergy: number;
  dailyClaimsLimit: number;
  dailyClaimLimit: number;
  diamondBonus: number;
  conversionAvailable: boolean;
  mainBenefit: string;
}

export const CENTRAL_LEVEL_ECONOMY: Record<number, LevelEconomyMeta> = {
  1: {
    level: 1,
    name: 'Nova Free',
    titleBadge: 'Free',
    priceIdr: 0,
    upgradePriceIdr: 0,
    tapMultiplier: 1,
    coinsPerTap: 10,
    perClickCoins: 10,
    idrPerTap: 1,
    cycleBonusCoins: 100,
    perCycleClaimCoins: 100,
    maxEnergy: 200,
    dailyClaimsLimit: 200,
    dailyClaimLimit: 200,
    diamondBonus: 0,
    conversionAvailable: false,
    mainBenefit: 'Akses dasar tap koin harian, misi pemula, dan program referral.',
  },
  2: {
    level: 2,
    name: 'Nova Basic',
    titleBadge: 'Basic',
    priceIdr: 25000,
    upgradePriceIdr: 25000,
    tapMultiplier: 2,
    coinsPerTap: 20,
    perClickCoins: 20,
    idrPerTap: 2,
    cycleBonusCoins: 200,
    perCycleClaimCoins: 200,
    maxEnergy: 400,
    dailyClaimsLimit: 400,
    dailyClaimLimit: 400,
    diamondBonus: 15,
    conversionAvailable: false,
    mainBenefit: '2x kecepatan tap koin, kapasitas Core Energy 400, dan bonus +15 Diamond.',
  },
  3: {
    level: 3,
    name: 'Nova Elite',
    titleBadge: 'Elite',
    priceIdr: 50000,
    upgradePriceIdr: 50000,
    tapMultiplier: 5,
    coinsPerTap: 50,
    perClickCoins: 50,
    idrPerTap: 5,
    cycleBonusCoins: 500,
    perCycleClaimCoins: 500,
    maxEnergy: 800,
    dailyClaimsLimit: 800,
    dailyClaimLimit: 800,
    diamondBonus: 30,
    conversionAvailable: false,
    mainBenefit: '5x kecepatan tap koin (+50 Koin/Tap), kapasitas Core Energy 800, dan bonus +30 Diamond.',
  },
  4: {
    level: 4,
    name: 'Pro',
    titleBadge: 'Pro',
    priceIdr: 100000,
    upgradePriceIdr: 100000,
    tapMultiplier: 30,
    coinsPerTap: 300,
    perClickCoins: 300,
    idrPerTap: 30,
    cycleBonusCoins: 3000,
    perCycleClaimCoins: 3000,
    maxEnergy: 5000,
    dailyClaimsLimit: 5000,
    dailyClaimLimit: 5000,
    diamondBonus: 60,
    conversionAvailable: true,
    mainBenefit: '30x multiplier (+300 Koin/Tap), 5.000 Core Energy, +60 Diamond & akses fitur Konversi Koin ke Diamond.',
  },
  5: {
    level: 5,
    name: 'Ultimate',
    titleBadge: 'Ultimate',
    priceIdr: 200000,
    upgradePriceIdr: 200000,
    tapMultiplier: 50,
    coinsPerTap: 500,
    perClickCoins: 500,
    idrPerTap: 50,
    cycleBonusCoins: 5000,
    perCycleClaimCoins: 5000,
    maxEnergy: 10000,
    dailyClaimsLimit: 10000,
    dailyClaimLimit: 10000,
    diamondBonus: 120,
    conversionAvailable: true,
    mainBenefit: '50x multiplier tertinggi (+500 Koin/Tap), 10.000 Core Energy, +120 Diamond & akses penuh Konversi.',
  },
};

export interface WithdrawNominalOption {
  amountCoins: number;
  amountIdr: number;
  requiredCoins: number;
  requiredFire: number;
  minLevel: number;
}

/**
 * Single authoritative mapping for Withdrawal Nominal (Koin) -> Required Diamond.
 * Used by BOTH frontend and backend.
 */
export const WITHDRAWAL_DIAMOND_MAP: Record<number, number> = {
  20_000: 200,
  50_000: 500,
  100_000: 1_000,
  200_000: 2_000,
  500_000: 5_000,
  1_000_000: 10_000,
};

export const VALID_WITHDRAW_COIN_TIERS: number[] = [
  20_000,
  50_000,
  100_000,
  200_000,
  500_000,
  1_000_000,
];

export const WITHDRAWAL_TIERS: WithdrawNominalOption[] = [
  {
    amountCoins: 20_000,
    amountIdr: 20_000,
    requiredCoins: 20_000,
    requiredFire: WITHDRAWAL_DIAMOND_MAP[20_000],
    minLevel: 1,
  },
  {
    amountCoins: 50_000,
    amountIdr: 50_000,
    requiredCoins: 50_000,
    requiredFire: WITHDRAWAL_DIAMOND_MAP[50_000],
    minLevel: 1,
  },
  {
    amountCoins: 100_000,
    amountIdr: 100_000,
    requiredCoins: 100_000,
    requiredFire: WITHDRAWAL_DIAMOND_MAP[100_000],
    minLevel: 1,
  },
  {
    amountCoins: 200_000,
    amountIdr: 200_000,
    requiredCoins: 200_000,
    requiredFire: WITHDRAWAL_DIAMOND_MAP[200_000],
    minLevel: 1,
  },
  {
    amountCoins: 500_000,
    amountIdr: 500_000,
    requiredCoins: 500_000,
    requiredFire: WITHDRAWAL_DIAMOND_MAP[500_000],
    minLevel: 1,
  },
  {
    amountCoins: 1_000_000,
    amountIdr: 1_000_000,
    requiredCoins: 1_000_000,
    requiredFire: WITHDRAWAL_DIAMOND_MAP[1_000_000],
    minLevel: 1,
  },
];

export function isTierEligibleForConversion(level: number): boolean {
  return Math.floor(Number(level) || 1) >= ECONOMY_CONSTANTS.MIN_LEVEL_FOR_CONVERSION;
}

/**
 * Single primary balance is KOIN (integer).
 */
export function calculateIdrFromCoins(
  coinBalance: number,
  _rate: number = 1
): number {
  return Math.max(0, Math.floor(Number(coinBalance) || 0));
}

export function calculateCoinsFromIdr(
  coinAmount: number,
  _rate: number = 1
): number {
  return Math.max(0, Math.floor(Number(coinAmount) || 0));
}

/**
 * Calculates required Diamond for a given Koin withdrawal nominal using the single authoritative mapping.
 */
export function calculateRequiredFireForWithdrawal(amountCoins: number): number {
  const cleanCoins = Math.max(0, Math.floor(Number(amountCoins) || 0));
  if (cleanCoins <= 0) return 0;
  if (WITHDRAWAL_DIAMOND_MAP[cleanCoins] !== undefined) {
    return WITHDRAWAL_DIAMOND_MAP[cleanCoins];
  }
  return Math.max(1, Math.floor(cleanCoins / 100));
}

/**
 * Resolves the authoritative level economy metadata for a given level.
 */
export function getLevelEconomy(
  level: number,
  customCfg?: DragonLevelConfig,
  settings?: GameSettings
): LevelEconomyMeta {
  const cleanLevel = Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));
  const fallback = CENTRAL_LEVEL_ECONOMY[cleanLevel] || CENTRAL_LEVEL_ECONOMY[1];
  const baseCoinsPerTap = settings?.coinsPerTap || 10;
  const rate = settings?.coinToIdrRate || ECONOMY_CONSTANTS.COIN_TO_IDR_RATE;
  const multiplier = customCfg?.tapMultiplier || fallback.tapMultiplier;
  const coinsPerTap = Math.max(1, Math.round(baseCoinsPerTap * multiplier));
  const idrPerTap = Math.max(1, Math.round(coinsPerTap * rate));
  const cycleBonusCoins = coinsPerTap * 10;
  const resolvedPriceIdr =
    cleanLevel === 1
      ? 0
      : customCfg?.priceIdr && customCfg.priceIdr >= 10000
      ? customCfg.priceIdr
      : fallback.priceIdr;

  return {
    level: cleanLevel,
    name: customCfg?.name || fallback.name,
    titleBadge: customCfg?.titleBadge || fallback.titleBadge,
    priceIdr: resolvedPriceIdr,
    upgradePriceIdr: resolvedPriceIdr,
    tapMultiplier: multiplier,
    coinsPerTap,
    perClickCoins: coinsPerTap,
    idrPerTap,
    cycleBonusCoins,
    perCycleClaimCoins: cycleBonusCoins,
    maxEnergy: customCfg?.maxEnergy || fallback.maxEnergy,
    dailyClaimsLimit: fallback.dailyClaimsLimit,
    dailyClaimLimit: fallback.dailyClaimsLimit,
    diamondBonus:
      customCfg?.dailyFireBonus !== undefined
        ? customCfg.dailyFireBonus
        : fallback.diamondBonus,
    conversionAvailable: isTierEligibleForConversion(cleanLevel),
    mainBenefit: fallback.mainBenefit,
  };
}

export const getLevelEconomyMeta = getLevelEconomy;

/**
 * Ensures any wallet object has `idrBalance` strictly synchronized with `coinBalance`
 * and prevents negative or overflow values.
 */
export function synchronizeWalletEconomy(
  wallet: UserWallet,
  rate: number = ECONOMY_CONSTANTS.COIN_TO_IDR_RATE
): UserWallet {
  const cleanCoins = Math.max(0, Math.floor(Number(wallet.coinBalance) || 0));
  const cleanFire = Math.max(0, Math.floor(Number(wallet.fireBalance) || 0));
  const syncedIdr = calculateIdrFromCoins(cleanCoins, rate);
  const cleanMaxEnergy = Math.max(10, Math.floor(Number(wallet.maxEnergy) || 200));
  const cleanEnergy = Math.min(
    cleanMaxEnergy,
    Math.max(0, Math.floor(Number(wallet.energy) || 0))
  );

  return {
    ...wallet,
    coinBalance: cleanCoins,
    fireBalance: cleanFire,
    idrBalance: syncedIdr,
    lockedIdrBalance: Math.max(0, Math.floor(Number(wallet.lockedIdrBalance) || 0)),
    energy: cleanEnergy,
    maxEnergy: cleanMaxEnergy,
  };
}

/**
 * Progressive Invite Mission Target Sequence:
 * Step 0 -> 5
 * Step 1 -> 15 (+10)
 * Step 2 -> 30 (+15)
 * Step 3 -> 50 (+20)
 * Step 4 -> 75 (+25)
 * Step 5 -> 105 (+30)
 * Step 6 -> 140 (+35)
 * Step 7 -> 180 (+40)
 * Step k -> 5 * ((k + 1) * (k + 2)) / 2 (continues infinitely)
 */
export function getInviteMissionTargetByStep(stepIndex: number): number {
  const k = Math.max(0, Math.floor(Number(stepIndex) || 0));
  return Math.floor((5 * (k + 1) * (k + 2)) / 2);
}

/**
 * Counts strictly valid, deduplicated referrals for an inviter.
 * Excludes self-referrals, duplicate invitee accounts, PENDING (unverified/inactive), and REJECTED records.
 */
export function countValidReferralsForUser(
  uid: string,
  referrals: {
    inviterUid: string;
    inviteeUid: string;
    status: string;
    activeRewardClaimed?: boolean;
    topupRewardClaimed?: boolean;
  }[]
): number {
  if (!uid || !Array.isArray(referrals)) return 0;
  const cleanUid = uid.trim();
  const seenInvitees = new Set<string>();

  for (const r of referrals) {
    if (!r || r.inviterUid !== cleanUid) continue;
    const inviteeKey = String(r.inviteeUid || '').trim().toLowerCase();
    if (!inviteeKey || inviteeKey === cleanUid.toLowerCase()) continue;
    if (r.status === 'REJECTED') continue;

    const isValid =
      r.status === 'VERIFIED' ||
      r.status === 'ACTIVE' ||
      r.status === 'TOPUP' ||
      r.status === 'UPGRADED' ||
      Boolean(r.activeRewardClaimed) ||
      Boolean(r.topupRewardClaimed);

    if (isValid) {
      seenInvitees.add(inviteeKey);
    }
  }

  return seenInvitees.size;
}

export function isInviteTargetAlreadyClaimed(
  target: number,
  uid: string,
  taskClaims: { uid: string; taskId: string; claimId?: string }[],
  claimedTargets?: number[]
): boolean {
  if (Array.isArray(claimedTargets) && claimedTargets.includes(target)) {
    return true;
  }
  const targetTaskId = `vp_invite_5_${target}`;
  return taskClaims.some((c) => {
    if (!c || c.uid !== uid) return false;
    if (c.taskId === targetTaskId) return true;
    if (target === 5 && c.taskId === 'vp_invite_5') return true;
    return false;
  });
}

export interface ProgressiveInviteMissionState {
  stepIndex: number;
  activeTarget: number;
  nextTarget: number;
  validInviteCount: number;
  claimTaskId: string;
  canClaim: boolean;
  progressPercent: number;
}

export function getProgressiveInviteMissionState(
  uid: string,
  referrals: {
    inviterUid: string;
    inviteeUid: string;
    status: string;
    activeRewardClaimed?: boolean;
    topupRewardClaimed?: boolean;
  }[],
  taskClaims: { uid: string; taskId: string; claimId?: string }[],
  claimedTargets?: number[]
): ProgressiveInviteMissionState {
  const validInviteCount = countValidReferralsForUser(uid, referrals);

  let stepIndex = 0;
  // Find the first target in 5 -> 15 -> 30 -> 50 -> 75 -> 105 -> 140 -> 180 -> ... that has not been claimed yet
  while (stepIndex < 10000) {
    const candidateTarget = getInviteMissionTargetByStep(stepIndex);
    if (!isInviteTargetAlreadyClaimed(candidateTarget, uid, taskClaims, claimedTargets)) {
      break;
    }
    stepIndex++;
  }

  const activeTarget = getInviteMissionTargetByStep(stepIndex);
  const nextTarget = getInviteMissionTargetByStep(stepIndex + 1);
  const claimTaskId = `vp_invite_5_${activeTarget}`;
  const canClaim = validInviteCount >= activeTarget;
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((validInviteCount / Math.max(1, activeTarget)) * 100))
  );

  return {
    stepIndex,
    activeTarget,
    nextTarget,
    validInviteCount,
    claimTaskId,
    canClaim,
    progressPercent,
  };
}

