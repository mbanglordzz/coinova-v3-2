import {
  AdminAuditLog,
  CreatorSubmission,
  DragonLevelConfig,
  GameSettings,
  GameTask,
  LevelUpgradeOrder,
  NotificationItem,
  ReferralRecord,
  RewardCode,
  RewardCodeClaim,
  TaskClaim,
  UserAccount,
  UserProfile,
  UserWallet,
  WalletTransaction,
  WithdrawalRecord,
} from '../types/dragon';
import {
  CENTRAL_LEVEL_ECONOMY,
  ECONOMY_CONSTANTS,
  calculateCoinsFromIdr,
} from '../config/economy';

const NOW_ISO = new Date().toISOString();

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  settingId: 'global',
  coinsPerTap: 10,
  energyCostPerTap: 1,
  baseMaxEnergy: 500,
  energyRegenPerMinute: 0,
  coinToIdrRate: ECONOMY_CONSTANTS.COIN_TO_IDR_RATE,
  fireToIdrRate: 1000,
  coinsPerFireConvert: ECONOMY_CONSTANTS.COINS_PER_FIRE_CONVERT,
  maxDailyFireConvert: ECONOMY_CONSTANTS.MAX_DAILY_FIRE_CONVERT,
  fireDropChancePercent: ECONOMY_CONSTANTS.DEFAULT_FIRE_DROP_CHANCE_PERCENT,
  referralRewardCoin: 25000,
  referralRewardFire: 2,
  referralRewardIdr: 2500,
  minWithdrawIdr: ECONOMY_CONSTANTS.MIN_WITHDRAW_IDR,
  maintenanceMode: false,
  announcementText: 'Selamat datang di ekosistem COINOVA Neon Futuristic!',
  updatedAt: NOW_ISO,
};

export const DEFAULT_DRAGON_LEVELS: DragonLevelConfig[] = [
  {
    level: 1,
    name: 'Free',
    titleBadge: 'Free',
    priceIdr: CENTRAL_LEVEL_ECONOMY[1].priceIdr,
    requiredCoins: 0,
    requiredFire: 0,
    tapMultiplier: CENTRAL_LEVEL_ECONOMY[1].tapMultiplier,
    maxEnergy: CENTRAL_LEVEL_ECONOMY[1].maxEnergy,
    dailyFireBonus: 0,
    updatedAt: NOW_ISO,
  },
  {
    level: 2,
    name: 'Basic',
    titleBadge: 'Basic',
    priceIdr: CENTRAL_LEVEL_ECONOMY[2].priceIdr,
    requiredCoins: 25000,
    requiredFire: 25,
    tapMultiplier: CENTRAL_LEVEL_ECONOMY[2].tapMultiplier,
    maxEnergy: CENTRAL_LEVEL_ECONOMY[2].maxEnergy,
    dailyFireBonus: 15,
    updatedAt: NOW_ISO,
  },
  {
    level: 3,
    name: 'Elite',
    titleBadge: 'Elite',
    priceIdr: CENTRAL_LEVEL_ECONOMY[3].priceIdr,
    requiredCoins: 50000,
    requiredFire: 50,
    tapMultiplier: CENTRAL_LEVEL_ECONOMY[3].tapMultiplier,
    maxEnergy: CENTRAL_LEVEL_ECONOMY[3].maxEnergy,
    dailyFireBonus: 30,
    updatedAt: NOW_ISO,
  },
  {
    level: 4,
    name: 'Pro',
    titleBadge: 'Pro',
    priceIdr: CENTRAL_LEVEL_ECONOMY[4].priceIdr,
    requiredCoins: 100000,
    requiredFire: 100,
    tapMultiplier: CENTRAL_LEVEL_ECONOMY[4].tapMultiplier,
    maxEnergy: CENTRAL_LEVEL_ECONOMY[4].maxEnergy,
    dailyFireBonus: 60,
    updatedAt: NOW_ISO,
  },
  {
    level: 5,
    name: 'Ultimate',
    titleBadge: 'Ultimate',
    priceIdr: CENTRAL_LEVEL_ECONOMY[5].priceIdr,
    requiredCoins: 200000,
    requiredFire: 200,
    tapMultiplier: CENTRAL_LEVEL_ECONOMY[5].tapMultiplier,
    maxEnergy: CENTRAL_LEVEL_ECONOMY[5].maxEnergy,
    dailyFireBonus: 120,
    updatedAt: NOW_ISO,
  },
];

export const DAILY_CHECKIN_REWARDS: {
  day: number;
  coins: number;
  fire: number;
  label: string;
}[] = [
  { day: 1, coins: 500, fire: 0, label: '+500' },
  { day: 2, coins: 1000, fire: 0, label: '+1K' },
  { day: 3, coins: 2000, fire: 0, label: '+2K' },
  { day: 4, coins: 0, fire: 2, label: '+2' },
  { day: 5, coins: 4000, fire: 0, label: '+4K' },
  { day: 6, coins: 0, fire: 5, label: '+5' },
  { day: 7, coins: 10000, fire: 0, label: '+10K' },
];

export const DEFAULT_TASKS: GameTask[] = [
  {
    taskId: 'vp_join_channel',
    title: 'Bergabung Saluran COINOVA',
    description: 'Bergabung ke saluran komunitas resmi Telegram COINOVA (@CoinovaOfficiall) dan verifikasi keanggotaan.',
    category: 'BEGINNER',
    targetCount: 1,
    metricType: 'SHARE',
    coinReward: 5000,
    fireReward: 2,
    idrReward: 500,
    isActive: true,
    updatedAt: NOW_ISO,
  },
  {
    taskId: 'vp_install_apk',
    title: 'Install APK',
    description: 'Unduh dan install aplikasi resmi COINOVA APK di perangkat Android Anda.',
    category: 'BEGINNER',
    targetCount: 1,
    metricType: 'SHARE',
    coinReward: 5000,
    fireReward: 0,
    idrReward: 500,
    isActive: true,
    updatedAt: NOW_ISO,
  },
  {
    taskId: 'vp_level_bonus',
    title: 'Bonus Level (Pro)',
    description: 'Hadiah khusus aktivasi paket Level Pro di COINOVA.',
    category: 'BEGINNER',
    targetCount: 4,
    metricType: 'LEVEL',
    coinReward: 0,
    fireReward: 60,
    idrReward: 0,
    isActive: true,
    updatedAt: NOW_ISO,
  },
  {
    taskId: 'vp_invite_5',
    title: 'Mengundang 5 Teman',
    description: 'Ajak 5 teman bergabung menggunakan kode undangan COINOVA Anda.',
    category: 'BEGINNER',
    targetCount: 5,
    metricType: 'INVITES',
    coinReward: 25000,
    fireReward: 10,
    idrReward: 2500,
    isActive: true,
    updatedAt: NOW_ISO,
  },
  {
    taskId: 'vp_claims_2500',
    title: 'Klaim 2500 Kali',
    description: 'Selesaikan 2.500 klaim siklus di halaman utama COINOVA.',
    category: 'BEGINNER',
    targetCount: 2500,
    metricType: 'TAPS',
    coinReward: 20000,
    fireReward: 3,
    idrReward: 2000,
    isActive: true,
    updatedAt: NOW_ISO,
  },
];

export const DEFAULT_REWARD_CODES: RewardCode[] = [
  {
    code: 'COINOVA2026',
    description: 'Bonus peluncuran resmi COINOVA',
    coinReward: 10000,
    fireReward: 5,
    idrReward: 1000,
    maxClaims: 5000,
    claimedCount: 142,
    isActive: true,
    updatedAt: NOW_ISO,
  },
  {
    code: 'NOVAVIP',
    description: 'Kode hadiah VIP komunitas COINOVA',
    coinReward: 25000,
    fireReward: 10,
    idrReward: 2500,
    maxClaims: 1000,
    claimedCount: 88,
    isActive: true,
    updatedAt: NOW_ISO,
  },
  {
    code: 'NOVAPRO',
    description: 'Voucher ekstra koin & diamond member Pro',
    coinReward: 50000,
    fireReward: 15,
    idrReward: 5000,
    maxClaims: 500,
    claimedCount: 19,
    isActive: true,
    updatedAt: NOW_ISO,
  },
];

export interface SandboxState {
  user: UserAccount;
  profile: UserProfile;
  wallet: UserWallet;
  transactions: WalletTransaction[];
  tasks: GameTask[];
  taskClaims: TaskClaim[];
  rewardCodes: RewardCode[];
  claimedCodes: string[];
  rewardCodeClaims: RewardCodeClaim[];
  referrals: ReferralRecord[];
  creatorSubmissions: CreatorSubmission[];
  withdrawals: WithdrawalRecord[];
  upgradeOrders: LevelUpgradeOrder[];
  notifications: NotificationItem[];
  levels: DragonLevelConfig[];
  settings: GameSettings;
  auditLogs: AdminAuditLog[];
  allUsers: {
    user: UserAccount;
    wallet: UserWallet;
    profile: UserProfile;
  }[];
}

export function createCleanUserSandboxState(params?: {
  uid?: string;
  username?: string;
  email?: string;
  referralCode?: string;
  referredByCode?: string;
  referredByUid?: string;
}): SandboxState {
  const now = new Date();
  const nowIso = now.toISOString();
  const cleanUid = String(params?.uid || '').trim();
  const cleanUsername = String(params?.username || '').trim();
  const hasAuthenticatedUser = Boolean(
    cleanUid && cleanUsername && cleanUsername.toLowerCase() !== 'member'
  );
  const uid = hasAuthenticatedUser ? cleanUid : '';
  const username = hasAuthenticatedUser ? cleanUsername : '';
  const referralCode = hasAuthenticatedUser
    ? params?.referralCode ||
      Math.random().toString(36).substring(2, 8).toUpperCase()
    : '';

  const user: UserAccount = {
    uid,
    username,
    referralCode,
    referredByCode: params?.referredByCode,
    referredByUid: params?.referredByUid,
    dragonLevel: 1, // Free / Level 1
    totalTaps: 0,
    dailyStreak: 0,
    lastCheckInDate: '',
    lastConvertDate: '',
    dailyConvertedFire: 0,
    cycleProgress: 0,
    dailyClaimsUsed: 0,
    lastClaimDate: '',
    role: 'player',
    status: 'active',
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const profile: UserProfile = {
    uid,
    email: params?.email || '',
    fullName: username,
    phone: '',
    defaultEwallet: 'DANA',
    ewalletNumber: '',
    ewalletAccountName: '',
    pinHash: '',
    notificationsEnabled: true,
    updatedAt: nowIso,
  };

  const wallet: UserWallet = {
    uid,
    coinBalance: 0,
    fireBalance: 0,
    idrBalance: 0,
    lockedIdrBalance: 0,
    energy: CENTRAL_LEVEL_ECONOMY[1].maxEnergy,
    maxEnergy: CENTRAL_LEVEL_ECONOMY[1].maxEnergy,
    totalEarnedCoins: 0,
    totalEarnedFire: 0,
    totalWithdrawnIdr: 0,
    updatedAt: nowIso,
  };

  return {
    user,
    profile,
    wallet,
    transactions: [],
    tasks: DEFAULT_TASKS,
    taskClaims: [],
    rewardCodes: DEFAULT_REWARD_CODES,
    claimedCodes: [],
    rewardCodeClaims: [],
    referrals: [],
    creatorSubmissions: [],
    withdrawals: [],
    upgradeOrders: [],
    notifications: [],
    levels: DEFAULT_DRAGON_LEVELS,
    settings: DEFAULT_GAME_SETTINGS,
    auditLogs: [],
    allUsers: hasAuthenticatedUser ? [{ user, wallet, profile }] : [],
  };
}

export function createInitialSandboxState(): SandboxState {
  return createCleanUserSandboxState();
}
