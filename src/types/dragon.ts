export type NavTab = 'HOME' | 'TASK' | 'INVITE' | 'WITHDRAW' | 'PROFILE';

export type EWalletMethod = 'DANA' | 'GoPay' | 'OVO' | 'ShopeePay';

export type UpgradePaymentMethod = 'QRIS' | 'DANA' | 'GoPay' | 'OVO' | 'ShopeePay';

export type UpgradeOrderStatus =
  | 'WAITING_PAYMENT'
  | 'PENDING_VERIFICATION'
  | 'PAID'
  | 'REJECTED';

export type TaskCategory = 'DAILY' | 'BEGINNER' | 'SPECIAL' | 'REFERRAL' | 'CREATOR';

export type TaskMetricType =
  | 'TAPS'
  | 'CHECKIN'
  | 'LEVEL'
  | 'INVITES'
  | 'COINS_EARNED'
  | 'CREATOR_POST'
  | 'SHARE';

export type TransactionCategory =
  | 'PENDAPATAN'
  | 'KONVERSI'
  | 'TASK'
  | 'REFERRAL'
  | 'REWARD'
  | 'LEVEL'
  | 'WITHDRAWAL'
  | 'ADMIN';

export type TransactionDirection = 'CREDIT' | 'DEBIT' | 'HOLD' | 'REFUND';

export type CurrencyType = 'COIN' | 'FIRE' | 'IDR';

export type CreatorPlatform = 'TikTok' | 'YouTube' | 'Instagram' | 'Facebook';

export type CreatorStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type WithdrawalStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'REJECTED';

export interface UserAccount {
  uid: string;
  username: string;
  avatarUrl?: string;
  referralCode: string;
  referredByUid?: string;
  referredByCode?: string;
  dragonLevel: number;
  totalTaps: number;
  dailyStreak: number;
  lastCheckInDate: string; // 'YYYY-MM-DD' or 'none'
  lastConvertDate?: string; // 'YYYY-MM-DD' or 'none'
  dailyConvertedFire?: number; // 0..10 per day
  cycleProgress?: number; // 0..10 taps in current cycle
  dailyClaimsUsed?: number; // claims used on lastClaimDate
  lastClaimDate?: string; // 'YYYY-MM-DD'
  isVip?: boolean;
  vipStatus?: 'NONE' | 'PENDING' | 'ACTIVE' | 'EXPIRED';
  vipStartedAt?: string;
  vipExpiresAt?: string;
  role: 'player' | 'admin';
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  phone: string;
  defaultEwallet: EWalletMethod;
  ewalletNumber: string;
  ewalletAccountName: string;
  pinHash: string;
  notificationsEnabled: boolean;
  updatedAt: string;
}

export interface UserWallet {
  uid: string;
  coinBalance: number;
  fireBalance: number;
  idrBalance: number;
  lockedIdrBalance: number;
  energy: number;
  maxEnergy: number;
  totalEarnedCoins: number;
  totalEarnedFire: number;
  totalWithdrawnIdr: number;
  dailyConvertedFireAmount?: number;
  lastConvertedDateKey?: string;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  uid: string;
  category: TransactionCategory;
  direction: TransactionDirection;
  currency: CurrencyType;
  amount: number;
  description: string;
  referenceId: string;
  status?: 'SUCCESS' | 'PENDING' | 'REJECTED';
  balanceBefore?: number;
  balanceAfter?: number;
  createdAt: string;
}

export interface LevelUpgradeOrder {
  orderId: string;
  uid: string;
  username: string;
  currentLevel?: number;
  targetLevel: number;
  levelName: string;
  priceIdr: number;
  paymentMethod: UpgradePaymentMethod;
  paymentReference: string;
  paymentProofImage?: string;
  paymentProofDataUrl?: string;
  paymentProofFileName?: string;
  paidSubmittedAt?: string;
  status: UpgradeOrderStatus;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface GameTask {
  taskId: string;
  title: string;
  description: string;
  category: TaskCategory;
  targetCount: number;
  metricType: TaskMetricType;
  coinReward: number;
  fireReward: number;
  idrReward: number;
  isActive: boolean;
  updatedAt: string;
}

export interface TaskClaim {
  claimId: string;
  uid: string;
  taskId: string;
  taskTitle: string;
  coinReward: number;
  fireReward: number;
  idrReward: number;
  claimedAt: string;
}

export interface RewardCode {
  code: string;
  description: string;
  coinReward: number;
  fireReward: number;
  idrReward: number;
  quota?: number;
  maxClaims: number;
  claimedCount: number;
  expiresAt?: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface RewardCodeClaim {
  claimId: string;
  uid: string;
  code: string;
  coinReward: number;
  fireReward: number;
  idrReward: number;
  claimedAt: string;
}

export type ReferralStatus = 'PENDING' | 'ACTIVE' | 'VERIFIED' | 'UPGRADED' | 'TOPUP' | 'REJECTED';

export interface ReferralRecord {
  referralId: string;
  inviterUid: string;
  inviteeUid: string;
  inviteeUsername: string;
  status: ReferralStatus;
  rewardCoin: number;
  rewardFire: number;
  rewardIdr: number;
  activeRewardClaimed?: boolean;
  topupRewardClaimed?: boolean;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorSubmission {
  submissionId: string;
  uid: string;
  username: string;
  platform: CreatorPlatform;
  contentUrl: string;
  caption: string;
  status: CreatorStatus;
  rewardCoin: number;
  rewardFire: number;
  rewardIdr: number;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface WithdrawalRecord {
  withdrawalId: string;
  uid: string;
  username: string;
  method: EWalletMethod;
  accountNumber: string;
  accountName: string;
  amount: number;
  lockedCoins?: number;
  fireSpent?: number;
  coinsSpent?: number;
  coinDeducted?: number;
  fireDeducted?: number;
  isVipPriority?: boolean;
  status: WithdrawalStatus;
  paymentReference: string;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  uid: string;
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'REWARD';
  category?: 'VIP' | 'WITHDRAWAL' | 'MISSION' | 'EVENT' | 'BROADCAST' | 'SYSTEM';
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}

export type VipOrderStatus = 'PENDING_VERIFICATION' | 'APPROVED' | 'REJECTED';

export interface VipOrderRecord {
  orderId: string;
  uid: string;
  username: string;
  priceIdr: number;
  durationDays: number;
  paymentMethod: UpgradePaymentMethod;
  paymentReference: string;
  paymentProofDataUrl: string;
  paymentProofFileName: string;
  status: VipOrderStatus;
  adminNote: string;
  verifiedBy?: string;
  verifiedAt?: string;
  vipStartedAt?: string;
  vipExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBroadcastRecord {
  broadcastId: string;
  title: string;
  content: string;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailyEventStatus {
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
}

export interface DragonLevelConfig {
  level: number;
  name: string;
  titleBadge: string;
  priceIdr: number; // Real money Rupiah upgrade price (0 for Free level 1)
  requiredCoins: number;
  requiredFire: number;
  tapMultiplier: number;
  perClickCoins?: number;
  perCycleClaimCoins?: number;
  dailyClaimLimit?: number;
  maxEnergy: number;
  dailyFireBonus: number;
  updatedAt: string;
}

export interface GameSettings {
  settingId: string;
  coinsPerTap: number;
  energyCostPerTap: number;
  baseMaxEnergy: number;
  energyRegenPerMinute: number;
  coinToIdrRate: number;
  fireToIdrRate: number;
  coinsPerFireConvert?: number;
  maxDailyFireConvert?: number;
  fireDropChancePercent?: number;
  referralRewardCoin: number;
  referralRewardFire: number;
  referralRewardIdr: number;
  minWithdrawIdr: number;
  maintenanceMode: boolean;
  announcementText: string;
  updatedAt: string;
}

export interface AdminAuditLog {
  id: string;
  adminUid: string;
  adminEmail: string;
  action: string;
  targetId?: string;
  targetUid?: string;
  details: string;
  createdAt: string;
}
