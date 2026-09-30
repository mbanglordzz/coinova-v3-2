import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import {
  getServerDoc,
  setServerDoc,
  deleteServerDoc,
  listServerDocs,
  queryServerDocsByField,
  sanitizeAccountKey,
  resolveServerFirebaseConfig,
  FirestoreServerError,
  SERVER_REALM_MARKER,
} from './src/lib/serverFirestore.js';
import {
  VALID_WITHDRAW_COIN_TIERS,
  WITHDRAWAL_DIAMOND_MAP,
} from './src/config/economy.js';

dotenv.config();

const APP_ROOT_DIR = process.cwd();
const IS_VERCEL_RUNTIME = Boolean(process.env.VERCEL);

export const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '35mb' }));

// Normalize Vercel /api path rewrites & apply same-origin production-safe headers
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With'
    );
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    );
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Handle Vercel rewrite `/api/index?__path=...`, `/api?__path=...`, or direct `/api/...`
  if (req.url) {
    const qIndex = req.url.indexOf('?');
    const pathname = qIndex >= 0 ? req.url.slice(0, qIndex) : req.url;
    const rawQuery = qIndex >= 0 ? req.url.slice(qIndex + 1) : '';
    if (rawQuery.includes('__path=')) {
      const params = new URLSearchParams(rawQuery);
      const rewrittenSubpath = (params.get('__path') || '')
        .replace(/^\/+/, '')
        .replace(/^api\/+/i, '');
      params.delete('__path');
      const remainingQuery = params.toString();
      if (rewrittenSubpath) {
        req.url = `/api/${rewrittenSubpath}${
          remainingQuery ? `?${remainingQuery}` : ''
        }`;
      } else {
        req.url = `${pathname}${remainingQuery ? `?${remainingQuery}` : ''}`;
      }
    } else if (
      !req.url.startsWith('/api') &&
      (IS_VERCEL_RUNTIME ||
        req.url.startsWith('/health') ||
        req.url.startsWith('/auth/') ||
        req.url.startsWith('/admin/') ||
        req.url.startsWith('/game/') ||
        req.url.startsWith('/qris') ||
        req.url.startsWith('/ugc/'))
    ) {
      req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
    }
  }
  next();
});

app.get('/api/health', (_req: Request, res: Response) => {
  const fbCfg = resolveServerFirebaseConfig();
  const admCfg = getAuthoritativeAdminCredentials();
  res.status(200).json({
    ok: true,
    service: 'coinova-api',
    firestoreConfigured: Boolean(
      fbCfg.projectId &&
        fbCfg.databaseId &&
        (fbCfg.apiKey || fbCfg.hasServiceAccount)
    ),
    projectId: fbCfg.projectId,
    databaseId: fbCfg.databaseId,
    adminConfigured: admCfg.configured,
  });
});

// ============================================================================
// SERVER-SIDE FIRESTORE PERSISTENT STORAGE (USERS, STATES, REFERRALS, TX, AUDIT)
// ============================================================================
const DATA_DIR = path.resolve(APP_ROOT_DIR, 'data');
const LEDGER_FILE = path.join(DATA_DIR, 'server_ledger.json');

export interface BugReportRecord {
  reportId: string;
  uid: string;
  username: string;
  description: string;
  featureArea: string;
  appVersion: string;
  hasScreenshot: boolean;
  screenshotFileName?: string;
  screenshotDataUrl?: string;
  status: 'RECEIVED' | 'REVIEWED';
  reportedAt: string;
}

export interface SuspiciousTapRecord {
  eventId: string;
  uid: string;
  username?: string;
  reason: string;
  deltaMs: number;
  tapId: string;
  status: 'FLAGGED' | 'CLEARED' | 'SUSPENDED';
  createdAt: string;
}

export interface ServerEconomicConfig {
  coinsPerTap: number;
  energyCostPerTap: number;
  energyRegenPerMinute: number;
  coinToIdrRate: number;
  coinsPerFireConvert: number;
  maxDailyFireConvert: number;
  minWithdrawIdr: number;
  referralActiveFireReward: number;
  referralTopupCoinReward: number;
  referralTopupFireReward: number;
  referralUpgradeCoinReward: number;
  referralUpgradeFireReward: number;
  updatedAt: string;
}

export interface ServerUserAccountRecord {
  uid: string;
  username: string;
  usernameLower?: string;
  email?: string;
  passwordHash: string;
  referralCode: string;
  referredByCode?: string;
  referredByUid?: string;
  dragonLevel: number;
  status?: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export interface ServerLedgerTransaction {
  id: string;
  uid: string;
  category: string;
  direction: 'CREDIT' | 'DEBIT' | 'HOLD' | 'REFUND';
  currency: 'COIN' | 'FIRE';
  amount: number;
  description: string;
  referenceId: string;
  createdAt: string;
}

export interface ServerAdminAuditEntry {
  auditId: string;
  adminId: string;
  timestamp: string;
  action: string;
  targetUser: string;
  amountOrStatus: string;
  details: string;
}

interface ServerUserState {
  uid: string;
  username?: string;
  referralCode?: string;
  referredByUid?: string;
  referredByCode?: string;
  dragonLevel: number;
  coinBalance: number;
  fireBalance: number;
  lockedIdrBalance: number;
  totalWithdrawnIdr?: number;
  energy: number;
  maxEnergy: number;
  lastEnergyRegenMs: number;
  cycleProgress: number;
  dailyClaimsUsed: number;
  lastClaimDate: string;
  lastConvertDate: string;
  dailyConvertedFire: number;
  dailyStreak?: number;
  lastCheckInDate?: string;
  totalTaps: number;
  status?: 'active' | 'suspended';
  fullName?: string;
  phone?: string;
  defaultEwallet?: string;
  ewalletNumber?: string;
  ewalletAccountName?: string;
  pinHash?: string;
  notificationsEnabled?: boolean;
  claimedInviteTargets?: number[];
  claimedTaskIds?: string[];
  claimedPromoCodes?: string[];
  boundReferralCode?: string;
  apkMissionStatus?: 'NOT_STARTED' | 'WAITING_VERIFICATION' | 'VERIFIED' | 'CLAIMED';
  apkDownloadClickedAt?: string;
  apkInstallToken?: string;
  apkVerifiedAt?: string;
  apkDeviceId?: string;
  telegramUserId?: string;
  telegramUsername?: string;
  telegramLinkedAt?: string;
  telegramChannelVerified?: boolean;
  telegramChannelVerifiedAt?: string;
  vipStatus?: 'NONE' | 'PENDING' | 'ACTIVE' | 'EXPIRED';
  vipStartedAt?: string;
  vipExpiresAt?: string;
  lastMysteryBoxClaimMs?: number;
  lastMysteryBoxClaimAt?: string;
  lastLuckySpinMs?: number;
  lastLuckySpinAt?: string;
  updatedAt: string;
}

export interface ServerWithdrawalRecord {
  withdrawalId: string;
  uid: string;
  username: string;
  method: 'DANA' | 'GoPay' | 'OVO' | 'ShopeePay' | string;
  accountNumber: string;
  accountName: string;
  amount: number;
  lockedCoins?: number;
  coinDeducted: number;
  fireDeducted: number;
  isVipPriority?: boolean;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'REJECTED';
  paymentReference?: string;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerUpgradeOrderRecord {
  orderId: string;
  uid: string;
  username: string;
  targetLevel: number;
  levelName: string;
  priceIdr: number;
  paymentMethod: string;
  paymentReference: string;
  paymentProofDataUrl?: string;
  paymentProofImage?: string;
  paymentProofFileName?: string;
  paidSubmittedAt?: string;
  status: 'WAITING_PAYMENT' | 'PENDING_VERIFICATION' | 'PAID' | 'REJECTED';
  adminNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerCreatorSubmissionRecord {
  submissionId: string;
  uid: string;
  username: string;
  platform: string;
  contentUrl: string;
  caption?: string;
  viewsCount?: number;
  claimedRewardCoin?: number;
  claimedRewardFire?: number;
  claimedRewardIdr?: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rewardCoin: number;
  rewardFire: number;
  rewardIdr: number;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerVipOrderRecord {
  orderId: string;
  uid: string;
  username: string;
  priceIdr: number;
  durationDays: number;
  paymentMethod: 'QRIS' | 'DANA' | 'GoPay' | 'OVO' | 'ShopeePay';
  paymentReference: string;
  paymentProofDataUrl: string;
  paymentProofFileName: string;
  status: 'PENDING_VERIFICATION' | 'APPROVED' | 'REJECTED';
  adminNote: string;
  verifiedBy?: string;
  verifiedAt?: string;
  vipStartedAt?: string;
  vipExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerAdminBroadcastRecord {
  broadcastId: string;
  title: string;
  content: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerNotificationRecord {
  id: string;
  uid: string;
  title: string;
  message: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'REWARD';
  category: 'VIP' | 'WITHDRAWAL' | 'MISSION' | 'EVENT' | 'BROADCAST' | 'SYSTEM';
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DiamondMathChallengeRecord {
  challengeId: string;
  uid: string;
  question: string;
  expectedAnswer: number;
  rewardFire: number;
  consumed?: boolean;
  createdAt: number;
  expiresAt: number;
}

interface ReferralMilestoneState {
  referralId: string;
  inviterUid: string;
  inviteeUid: string;
  inviteeUsername?: string;
  inviterCode?: string;
  rewardCoin?: number;
  rewardFire?: number;
  rewardIdr?: number;
  status: 'PENDING' | 'ACTIVE' | 'VERIFIED' | 'REJECTED';
  activeRewardClaimed: boolean;
  topupRewardClaimed: boolean;
  upgradeRewardClaimed?: boolean;
  createdAt?: string;
  updatedAt: string;
}

interface ServerLedgerData {
  userAccounts?: Record<string, ServerUserAccountRecord>;
  dailyConversions: Record<string, number>;
  dailyClaims: Record<string, number>;
  boundReferrals: Record<string, string>;
  referralMilestones: Record<string, ReferralMilestoneState>;
  processedUpgradeReferralOrders: string[];
  userStates: Record<string, ServerUserState>;
  processedWithdrawals: string[];
  processedDiamondChallenges?: string[];
  bugReports: BugReportRecord[];
  suspiciousTaps: SuspiciousTapRecord[];
  transactions?: ServerLedgerTransaction[];
  adminAuditLogs?: ServerAdminAuditEntry[];
  economicConfig?: ServerEconomicConfig;
}

const DEFAULT_ECONOMIC_CONFIG: ServerEconomicConfig = {
  coinsPerTap: 10,
  energyCostPerTap: 1,
  energyRegenPerMinute: 0,
  coinToIdrRate: 1,
  coinsPerFireConvert: 1000,
  maxDailyFireConvert: 10,
  minWithdrawIdr: 20000,
  referralActiveFireReward: 2,
  referralTopupCoinReward: 25000,
  referralTopupFireReward: 8,
  referralUpgradeCoinReward: 25000,
  referralUpgradeFireReward: 10,
  updatedAt: new Date().toISOString(),
};

let serverEconomicConfig: ServerEconomicConfig = { ...DEFAULT_ECONOMIC_CONFIG };

const userAccountsMap = new Map<string, ServerUserAccountRecord>();
const dailyConversionLedger = new Map<string, number>();
const dailyClaimsLedger = new Map<string, number>();
const boundReferralsMap = new Map<string, string>();
const referralMilestonesMap = new Map<string, ReferralMilestoneState>();
const processedUpgradeReferralOrdersSet = new Set<string>();
const userStateLedger = new Map<string, ServerUserState>();
const processedWithdrawalsSet = new Set<string>();
const processedDiamondChallengesSet = new Set<string>();
const activeDiamondChallengesMap = new Map<string, DiamondMathChallengeRecord>();
const claimedTaskIdsSet = new Set<string>();
const inFlightTaskClaimLocks = new Set<string>();
const inFlightWithdrawUserLocks = new Set<string>();
const inFlightMysteryBoxLocks = new Set<string>();
const inFlightLuckySpinLocks = new Set<string>();
const inFlightVipActionLocks = new Set<string>();
const inFlightAdminWithdrawLocks = new Set<string>();
const vipOrdersMap = new Map<string, ServerVipOrderRecord>();
const serverWithdrawalsMap = new Map<string, ServerWithdrawalRecord>();
const serverUpgradeOrdersMap = new Map<string, ServerUpgradeOrderRecord>();
const serverCreatorSubmissionsMap = new Map<string, ServerCreatorSubmissionRecord>();

interface ServerEventCooldownRecord {
  uid: string;
  lastMysteryBoxClaimMs: number;
  lastMysteryBoxClaimAt: string | null;
  lastLuckySpinMs: number;
  lastLuckySpinAt: string | null;
  updatedAt: string;
}
export interface ServerPromoCodeRecord {
  code: string;
  description?: string;
  coinReward: number;
  fireReward: number;
  quota: number;
  maxClaims: number;
  claimedCount: number;
  expiresAt?: string | null;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerPromoClaimRecord {
  claimId: string;
  code: string;
  uid: string;
  username: string;
  coinReward: number;
  fireReward: number;
  claimedAt: string;
}

const eventCooldownsMap = new Map<string, ServerEventCooldownRecord>();
const adminBroadcastsMap = new Map<string, ServerAdminBroadcastRecord>();
const promoCodesMap = new Map<string, ServerPromoCodeRecord>();
const promoClaimsMap = new Map<string, ServerPromoClaimRecord>();
const inFlightPromoRedeemLocks = new Set<string>();
const serverNotificationsLedger: ServerNotificationRecord[] = [];
const telegramUserIdToUidMap = new Map<string, string>();
const apkInstallTokenToUidMap = new Map<string, string>();
const bugReportsLedger: BugReportRecord[] = [];
const suspiciousTapsLedger: SuspiciousTapRecord[] = [];
const serverTransactionsLedger: ServerLedgerTransaction[] = [];
const adminAuditLogsLedger: ServerAdminAuditEntry[] = [];

// Short-lived anti-spam timing caches
const lastTapTimestampMap = new Map<string, number>();
const recentTapIntervalsMap = new Map<string, number[]>();
const processedTapIds = new Set<string>();

interface UserSessionRecord {
  token: string;
  uid: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}
const activeUserSessions = new Map<string, UserSessionRecord>();
const USER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function hashPassword(password: string): string {
  return crypto
    .createHash('sha256')
    .update(`coinova_usr_${password}`)
    .digest('hex');
}

function getSessionDocId(token: string): string {
  return `sess_${crypto
    .createHash('sha256')
    .update(token)
    .digest('hex')
    .slice(0, 40)}`;
}

async function persistUserAccountToFirestore(
  account: ServerUserAccountRecord
): Promise<void> {
  const usernameLower = account.username.trim().toLowerCase();
  const docId = sanitizeAccountKey(usernameLower);
  const record: ServerUserAccountRecord = {
    ...account,
    usernameLower,
    status: account.status || 'active',
  };
  userAccountsMap.set(usernameLower, record);
  await setServerDoc('server_user_accounts', docId, record);
}

async function loadUserAccountFromFirestore(
  usernameOrEmail: string
): Promise<ServerUserAccountRecord | null> {
  const cleanKey = usernameOrEmail.trim().toLowerCase();
  const lookupKeys =
    cleanKey === 'keylaa' ? ['keylaa.', 'keylaa'] : [cleanKey];

  for (const keyCandidate of lookupKeys) {
    const docId = sanitizeAccountKey(keyCandidate);
    try {
      const docData = await getServerDoc<ServerUserAccountRecord>(
        'server_user_accounts',
        docId,
        true
      );
      if (docData && docData.uid && docData.passwordHash) {
        userAccountsMap.set(
          (docData.usernameLower || docData.username).toLowerCase(),
          docData
        );
        return docData;
      }
    } catch (err) {
      console.error(
        `[COINOVA-AUTH] Firestore account lookup error for ${docId}:`,
        err instanceof Error ? err.message : String(err)
      );
      throw err;
    }

    // If not yet in Firestore, check if it is one of our initial seed accounts (e.g. pepe, Keylaa.)
    const seedAcc = userAccountsMap.get(keyCandidate);
    if (seedAcc && seedAcc.uid && seedAcc.passwordHash) {
      try {
        await persistUserAccountToFirestore(seedAcc);
        const seedState = userStateLedger.get(seedAcc.uid);
        if (seedState) {
          await persistUserStateToFirestore(seedState);
        }
      } catch (err) {
        console.warn(
          `[COINOVA-AUTH] Failed to lazy-seed account ${keyCandidate} to Firestore:`,
          err instanceof Error ? err.message : String(err)
        );
      }
      return seedAcc;
    }
  }

  // Final authoritative lookup by usernameLower/email. This avoids stale per-instance
  // mirrors causing a valid account to appear missing after registration.
  try {
    const field = cleanKey.includes('@') ? 'email' : 'usernameLower';
    const matches = await queryServerDocsByField<ServerUserAccountRecord>(
      'server_user_accounts',
      field,
      cleanKey,
      5,
      true
    );
    if (matches.length > 0) {
      const found = matches[0]!;
      userAccountsMap.set(
        (found.usernameLower || found.username).toLowerCase(),
        found
      );
      return found;
    }
  } catch (err) {
    console.error(
      `[COINOVA-AUTH] Firestore account query error for ${cleanKey}:`,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }

  return null;
}

async function loadUserAccountByUidFromFirestore(
  uid: string
): Promise<ServerUserAccountRecord | null> {
  try {
    const matches = await queryServerDocsByField<ServerUserAccountRecord>(
      'server_user_accounts',
      'uid',
      uid,
      5,
      true
    );
    if (matches.length > 0) {
      const found = matches[0]!;
      userAccountsMap.set(
        (found.usernameLower || found.username).toLowerCase(),
        found
      );
      return found;
    }
  } catch {
    // fallback to cached map
  }
  let matched: ServerUserAccountRecord | null = null;
  userAccountsMap.forEach((acc) => {
    if (acc.uid === uid) matched = acc;
  });
  return matched;
}

async function findInviterByReferralCodeFromFirestore(
  refCode: string
): Promise<ServerUserAccountRecord | null> {
  const cleanCode = refCode.trim().toUpperCase();
  if (!cleanCode) return null;
  try {
    const matches = await queryServerDocsByField<ServerUserAccountRecord>(
      'server_user_accounts',
      'referralCode',
      cleanCode,
      5
    );
    if (matches.length > 0) {
      return matches[0]!;
    }
  } catch {
    // fallback to map
  }
  let found: ServerUserAccountRecord | null = null;
  userAccountsMap.forEach((acc) => {
    if (acc.referralCode.toUpperCase() === cleanCode) {
      found = acc;
    }
  });
  return found;
}

async function persistUserStateToFirestore(
  state: ServerUserState
): Promise<void> {
  userStateLedger.set(state.uid, state);
  await setServerDoc('server_user_states', state.uid, state);
}

async function persistSessionToFirestore(
  token: string,
  uid: string,
  username: string,
  role: 'USER' | 'ADMIN',
  createdAt: number,
  expiresAt: number,
  revoked = false
): Promise<void> {
  const sessionId = getSessionDocId(token);
  await setServerDoc('server_sessions', sessionId, {
    sessionId,
    uid,
    username,
    role,
    revoked,
    createdAt,
    expiresAt,
    updatedAt: new Date().toISOString(),
  });
}

async function isSessionRevokedInFirestore(token: string): Promise<boolean> {
  if (revokedSessionTokens.has(token)) return true;
  try {
    const sessionId = getSessionDocId(token);
    const docData = await getServerDoc<{ revoked?: boolean }>(
      'server_sessions',
      sessionId
    );
    if (docData?.revoked) {
      revokedSessionTokens.add(token);
      return true;
    }
  } catch {
    // ignore transient lookup error
  }
  return false;
}

function recordLedgerTransaction(
  tx: Omit<ServerLedgerTransaction, 'id' | 'createdAt'>,
  skipFirestorePersist = false
): ServerLedgerTransaction {
  const entry: ServerLedgerTransaction = {
    ...tx,
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  serverTransactionsLedger.unshift(entry);
  if (serverTransactionsLedger.length > 500) {
    serverTransactionsLedger.pop();
  }
  if (!skipFirestorePersist) {
    setServerDoc('server_transactions', entry.id, entry).catch((err) => {
      console.warn(
        '[COINOVA-FIRESTORE] Failed to persist transaction:',
        err instanceof Error ? err.message : String(err)
      );
    });
  }
  return entry;
}

function recordAdminAudit(
  adminId: string,
  action: string,
  targetUser: string,
  amountOrStatus: string,
  details: string
): ServerAdminAuditEntry {
  const entry: ServerAdminAuditEntry = {
    auditId: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    adminId,
    timestamp: new Date().toISOString(),
    action,
    targetUser,
    amountOrStatus,
    details,
  };
  adminAuditLogsLedger.unshift(entry);
  if (adminAuditLogsLedger.length > 300) {
    adminAuditLogsLedger.pop();
  }
  setServerDoc('server_admin_audits', entry.auditId, entry).catch((err) => {
    console.warn(
      '[COINOVA-FIRESTORE] Failed to persist admin audit:',
      err instanceof Error ? err.message : String(err)
    );
  });
  return entry;
}

function recordSuspiciousTap(
  uid: string,
  reason: string,
  deltaMs: number,
  tapId: string
): void {
  const event: SuspiciousTapRecord = {
    eventId: `susp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    uid,
    reason,
    deltaMs: Math.max(0, Math.round(deltaMs)),
    tapId: tapId || '-',
    status: 'FLAGGED',
    createdAt: new Date().toISOString(),
  };
  suspiciousTapsLedger.unshift(event);
  if (suspiciousTapsLedger.length > 200) {
    suspiciousTapsLedger.pop();
  }
  setServerDoc('server_suspicious_taps', event.eventId, event).catch(() => {});
}

function applyParsedLedgerData(parsed: Partial<ServerLedgerData>): void {
  if (parsed.userAccounts) {
    Object.entries(parsed.userAccounts).forEach(([k, v]) => {
      if (v && typeof v === 'object') {
        userAccountsMap.set(k.toLowerCase(), {
          ...v,
          usernameLower: k.toLowerCase(),
          status: v.status || 'active',
        });
      }
    });
  }
  if (parsed.dailyConversions) {
    Object.entries(parsed.dailyConversions).forEach(([k, v]) => {
      dailyConversionLedger.set(k, Number(v) || 0);
    });
  }
  if (parsed.dailyClaims) {
    Object.entries(parsed.dailyClaims).forEach(([k, v]) => {
      dailyClaimsLedger.set(k, Number(v) || 0);
    });
  }
  if (parsed.boundReferrals) {
    Object.entries(parsed.boundReferrals).forEach(([k, v]) => {
      if (typeof v === 'string') boundReferralsMap.set(k, v);
    });
  }
  if (parsed.referralMilestones) {
    Object.entries(parsed.referralMilestones).forEach(([k, v]) => {
      if (v && typeof v === 'object') referralMilestonesMap.set(k, v);
    });
  }
  if (Array.isArray(parsed.processedUpgradeReferralOrders)) {
    parsed.processedUpgradeReferralOrders.forEach((id) => {
      if (typeof id === 'string') processedUpgradeReferralOrdersSet.add(id);
    });
  }
  if (parsed.userStates) {
    Object.entries(parsed.userStates).forEach(([k, v]) => {
      if (v && typeof v === 'object') userStateLedger.set(k, v);
    });
  }
  if (Array.isArray(parsed.processedWithdrawals)) {
    parsed.processedWithdrawals.forEach((id) => {
      if (typeof id === 'string') processedWithdrawalsSet.add(id);
    });
  }
  if (Array.isArray(parsed.processedDiamondChallenges)) {
    parsed.processedDiamondChallenges.forEach((id) => {
      if (typeof id === 'string') processedDiamondChallengesSet.add(id);
    });
  }
  if (Array.isArray(parsed.bugReports)) {
    bugReportsLedger.splice(0, bugReportsLedger.length, ...parsed.bugReports);
  }
  if (Array.isArray(parsed.suspiciousTaps)) {
    suspiciousTapsLedger.splice(
      0,
      suspiciousTapsLedger.length,
      ...parsed.suspiciousTaps
    );
  }
  if (Array.isArray(parsed.transactions)) {
    serverTransactionsLedger.splice(
      0,
      serverTransactionsLedger.length,
      ...parsed.transactions
    );
  }
  if (Array.isArray(parsed.adminAuditLogs)) {
    adminAuditLogsLedger.splice(
      0,
      adminAuditLogsLedger.length,
      ...parsed.adminAuditLogs
    );
  }
  if (parsed.economicConfig && typeof parsed.economicConfig === 'object') {
    serverEconomicConfig = {
      ...DEFAULT_ECONOMIC_CONFIG,
      ...parsed.economicConfig,
    };
  }
}

// Read-only initial seed loader from bundled data/server_ledger.json for migration fallback
function loadServerLedger(): void {
  const bundledCandidates = [
    LEDGER_FILE,
    path.resolve(process.cwd(), 'data', 'server_ledger.json'),
  ];

  for (const candidate of bundledCandidates) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<ServerLedgerData>;
        applyParsedLedgerData(parsed);
        break;
      }
    } catch (err) {
      console.warn(
        `[COINOVA-AUTH] Seed migration read skipped for ${candidate}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

// Production persistence uses Firestore directly; never write to server_ledger.json or /tmp
function saveServerLedger(): void {
  // No-op: all state mutations are persisted directly to Firestore collections
}

loadServerLedger();

let firestoreSeedPromise: Promise<void> | null = null;
let lastFirestoreHydrationMs = 0;
let lastAdminAuthSyncMs = 0;

async function ensureAdminConfigSyncedWithFirestore(): Promise<void> {
  const now = Date.now();
  if (now - lastAdminAuthSyncMs < 30000 && cachedFirestoreAdminAuth) {
    return;
  }
  try {
    const envAdmin = getEnvAdminCredentialsOnly();
    if (envAdmin.configured) {
      cachedFirestoreAdminAuth = {
        username: envAdmin.username,
        passwordHash: envAdmin.passwordHash,
        trimmedPasswordHash: envAdmin.trimmedPasswordHash,
        sessionSecret: envAdmin.sessionSecret,
      };
      const existingAdminDoc = await getServerDoc<{
        docKey: string;
        username: string;
        passwordHash: string;
        trimmedPasswordHash: string;
        sessionSecret?: string;
      }>('server_config', 'admin_auth');
      if (
        !existingAdminDoc ||
        existingAdminDoc.username !== envAdmin.username ||
        existingAdminDoc.passwordHash !== envAdmin.passwordHash
      ) {
        await setServerDoc('server_config', 'admin_auth', {
          docKey: 'admin_auth',
          username: envAdmin.username,
          passwordHash: envAdmin.passwordHash,
          trimmedPasswordHash: envAdmin.trimmedPasswordHash,
          sessionSecret: envAdmin.sessionSecret,
          updatedAt: new Date().toISOString(),
        });
      }
      lastAdminAuthSyncMs = now;
    } else {
      const remoteAdminDoc = await getServerDoc<{
        docKey: string;
        username: string;
        passwordHash: string;
        trimmedPasswordHash: string;
        sessionSecret?: string;
      }>('server_config', 'admin_auth');
      if (
        remoteAdminDoc &&
        remoteAdminDoc.username &&
        remoteAdminDoc.passwordHash
      ) {
        cachedFirestoreAdminAuth = {
          username: remoteAdminDoc.username,
          passwordHash: remoteAdminDoc.passwordHash,
          trimmedPasswordHash:
            remoteAdminDoc.trimmedPasswordHash || remoteAdminDoc.passwordHash,
          sessionSecret: remoteAdminDoc.sessionSecret,
        };
        lastAdminAuthSyncMs = now;
      }
    }
  } catch (err) {
    console.warn(
      '[COINOVA-FIRESTORE] Admin config sync warning:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

const PLACEHOLDER_USERNAMES = new Set([
  '',
  'member',
  'guest',
  'player',
  'user_new_0',
  'user_keylaa_pro',
  'anonymous',
  'belum mengatur nama',
]);

function isPlaceholderUsername(name?: string | null): boolean {
  if (!name) return true;
  const clean = String(name).trim().toLowerCase();
  return PLACEHOLDER_USERNAMES.has(clean);
}

function findAccountByUidInMemory(
  uid: string
): ServerUserAccountRecord | undefined {
  for (const acc of userAccountsMap.values()) {
    if (acc && acc.uid === uid) {
      return acc;
    }
  }
  return undefined;
}

function hasUserFinancialOrGameActivity(
  uid: string,
  st?: ServerUserState
): boolean {
  if (!uid || uid === 'user_new_0' || uid === 'user_keylaa_pro') return false;
  if (st) {
    if ((Number(st.coinBalance) || 0) > 0) return true;
    if ((Number(st.fireBalance) || 0) > 0) return true;
    if ((Number(st.lockedIdrBalance) || 0) > 0) return true;
    if ((Number(st.totalWithdrawnIdr) || 0) > 0) return true;
    if ((Number(st.dragonLevel) || 1) > 1) return true;
    if ((Number(st.totalTaps) || 0) > 0) return true;
    if ((Number(st.dailyClaimsUsed) || 0) > 0) return true;
    if ((Number(st.dailyStreak) || 0) > 0) return true;
    if (Array.isArray(st.claimedTaskIds) && st.claimedTaskIds.length > 0) {
      return true;
    }
    if (Array.isArray(st.claimedPromoCodes) && st.claimedPromoCodes.length > 0) {
      return true;
    }
    if (st.vipStatus && st.vipStatus !== 'NONE') return true;
  }
  for (const w of serverWithdrawalsMap.values()) {
    if (w && w.uid === uid) return true;
  }
  for (const o of serverUpgradeOrdersMap.values()) {
    if (o && o.uid === uid) return true;
  }
  for (const v of vipOrdersMap.values()) {
    if (v && v.uid === uid) return true;
  }
  for (const r of referralMilestonesMap.values()) {
    if (r && (r.inviterUid === uid || r.inviteeUid === uid)) return true;
  }
  for (const s of serverCreatorSubmissionsMap.values()) {
    if (s && s.uid === uid) return true;
  }
  for (const t of serverTransactionsLedger) {
    if (t && t.uid === uid) return true;
  }
  return false;
}

function isPhantomUserRecord(
  uid: string,
  acc?: ServerUserAccountRecord,
  st?: ServerUserState
): boolean {
  if (!uid || uid === 'user_new_0' || uid === 'user_keylaa_pro') return true;
  const resolvedName = String(acc?.username || st?.username || '').trim();
  // Any user with a real non-placeholder username (e.g. keyla, kyowu, Rey Kelia, fauzi, etc.) is NEVER phantom
  if (!isPlaceholderUsername(resolvedName) && resolvedName !== uid) {
    return false;
  }
  // If username is "Member" / placeholder / missing, keep ONLY if they have real financial/gameplay data
  if (hasUserFinancialOrGameActivity(uid, st)) {
    return false;
  }
  return true;
}

async function ensureFirestoreSeeded(forceRefresh = false): Promise<void> {
  const now = Date.now();
  // Coalesce repeated refreshes. Admin polling and concurrent requests must not
  // start a second Firestore hydration while the previous one is still fresh/in-flight.
  if (firestoreSeedPromise) {
    const ageMs = now - lastFirestoreHydrationMs;
    if ((!forceRefresh && ageMs < 90_000) || (forceRefresh && ageMs < 5_000)) {
      return firestoreSeedPromise;
    }
  }
  if (!forceRefresh && now - lastFirestoreHydrationMs < 90_000) {
    return;
  }
  firestoreSeedPromise = (async () => {
    try {
      const [
        remoteAccounts,
        remoteStates,
        remoteReferrals,
        econDoc,
        remoteVipOrders,
        remoteBroadcasts,
        remoteNotifications,
        remoteEventCooldowns,
        remoteWithdrawals,
        remoteUpgradeOrders,
        remoteTransactions,
        remoteAdminAudits,
        remoteCreatorSubmissions,
        remotePromoCodes,
        remotePromoClaims,
      ] = await Promise.all([
        listServerDocs<ServerUserAccountRecord>('server_user_accounts', 300, forceRefresh),
        listServerDocs<ServerUserState>('server_user_states', 300, forceRefresh),
        listServerDocs<ReferralMilestoneState & { inviterCode?: string }>(
          'server_referrals',
          300,
          forceRefresh
        ),
        getServerDoc<ServerEconomicConfig & { docKey: string }>(
          'server_config',
          'economic_config',
          forceRefresh
        ),
        listServerDocs<ServerVipOrderRecord>('server_vip_orders', 200, forceRefresh).catch(
          () => [] as ServerVipOrderRecord[]
        ),
        listServerDocs<ServerAdminBroadcastRecord>(
          'server_broadcasts',
          100,
          forceRefresh
        ).catch(() => [] as ServerAdminBroadcastRecord[]),
        listServerDocs<ServerNotificationRecord>(
          'server_notifications',
          300,
          forceRefresh
        ).catch(() => [] as ServerNotificationRecord[]),
        listServerDocs<ServerEventCooldownRecord>(
          'server_event_cooldowns',
          300,
          forceRefresh
        ).catch(() => [] as ServerEventCooldownRecord[]),
        listServerDocs<ServerWithdrawalRecord>(
          'server_withdrawals',
          300,
          forceRefresh
        ).catch(() => [] as ServerWithdrawalRecord[]),
        listServerDocs<ServerUpgradeOrderRecord>(
          'server_upgrade_orders',
          200,
          forceRefresh
        ).catch(() => [] as ServerUpgradeOrderRecord[]),
        listServerDocs<ServerLedgerTransaction>(
          'server_transactions',
          300,
          forceRefresh
        ).catch(() => [] as ServerLedgerTransaction[]),
        listServerDocs<ServerAdminAuditEntry>(
          'server_admin_audits',
          200,
          forceRefresh
        ).catch(() => [] as ServerAdminAuditEntry[]),
        listServerDocs<ServerCreatorSubmissionRecord>(
          'server_creator_submissions',
          200,
          forceRefresh
        ).catch(() => [] as ServerCreatorSubmissionRecord[]),
        listServerDocs<ServerPromoCodeRecord>(
          'server_promo_codes',
          200,
          forceRefresh
        ).catch(() => [] as ServerPromoCodeRecord[]),
        listServerDocs<ServerPromoClaimRecord>(
          'server_promo_claims',
          300,
          forceRefresh
        ).catch(() => [] as ServerPromoClaimRecord[]),
        ensureAdminConfigSyncedWithFirestore(),
      ]);

      for (const pc of remotePromoCodes) {
        if (pc && pc.code) {
          promoCodesMap.set(String(pc.code).toUpperCase(), pc);
        }
      }
      for (const pcl of remotePromoClaims) {
        if (pcl && pcl.claimId) {
          promoClaimsMap.set(pcl.claimId, pcl);
        }
      }

      for (const wd of remoteWithdrawals) {
        if (wd && wd.withdrawalId) {
          serverWithdrawalsMap.set(wd.withdrawalId, wd);
          processedWithdrawalsSet.add(wd.withdrawalId);
        }
      }

      for (const ord of remoteUpgradeOrders) {
        if (ord && ord.orderId) {
          serverUpgradeOrdersMap.set(ord.orderId, ord);
        }
      }

      if (remoteTransactions.length > 0) {
        const existingTxIds = new Set(serverTransactionsLedger.map((t) => t.id));
        for (const tx of remoteTransactions) {
          if (tx && tx.id && !existingTxIds.has(tx.id)) {
            serverTransactionsLedger.push(tx);
            existingTxIds.add(tx.id);
          }
        }
        serverTransactionsLedger.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      }

      if (remoteAdminAudits.length > 0) {
        const existingAudIds = new Set(
          adminAuditLogsLedger.map((a) => a.auditId)
        );
        for (const aud of remoteAdminAudits) {
          if (aud && aud.auditId && !existingAudIds.has(aud.auditId)) {
            adminAuditLogsLedger.push(aud);
            existingAudIds.add(aud.auditId);
          }
        }
        adminAuditLogsLedger.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      }

      for (const sub of remoteCreatorSubmissions) {
        if (sub && sub.submissionId) {
          serverCreatorSubmissionsMap.set(sub.submissionId, sub);
        }
      }

      for (const ref of remoteReferrals) {
        if (ref && ref.referralId) {
          referralMilestonesMap.set(ref.referralId, ref);
          if (ref.inviteeUid && ref.inviterCode) {
            boundReferralsMap.set(ref.inviteeUid, ref.inviterCode);
          }
        }
      }

      for (const vo of remoteVipOrders) {
        if (vo && vo.orderId) {
          vipOrdersMap.set(vo.orderId, vo);
        }
      }

      for (const cd of remoteEventCooldowns) {
        if (cd && cd.uid) {
          const prevCd = eventCooldownsMap.get(cd.uid);
          const mergedMbMs = Math.max(
            0,
            Number(prevCd?.lastMysteryBoxClaimMs || 0),
            Number(cd.lastMysteryBoxClaimMs || 0)
          );
          const mergedLsMs = Math.max(
            0,
            Number(prevCd?.lastLuckySpinMs || 0),
            Number(cd.lastLuckySpinMs || 0)
          );
          eventCooldownsMap.set(cd.uid, {
            uid: cd.uid,
            lastMysteryBoxClaimMs: mergedMbMs,
            lastMysteryBoxClaimAt:
              mergedMbMs > 0 ? new Date(mergedMbMs).toISOString() : null,
            lastLuckySpinMs: mergedLsMs,
            lastLuckySpinAt:
              mergedLsMs > 0 ? new Date(mergedLsMs).toISOString() : null,
            updatedAt: cd.updatedAt || new Date().toISOString(),
          });
        }
      }

      for (const acc of remoteAccounts) {
        if (acc && acc.username && !isPlaceholderUsername(acc.username)) {
          const k = (acc.usernameLower || acc.username).trim().toLowerCase();
          userAccountsMap.set(k, acc);
        }
      }

      const phantomDeletes: Promise<void>[] = [];
      for (const st of remoteStates) {
        if (st && st.uid) {
          const matchedAcc = findAccountByUidInMemory(st.uid);
          if (isPhantomUserRecord(st.uid, matchedAcc, st)) {
            userStateLedger.delete(st.uid);
            phantomDeletes.push(
              deleteServerDoc('server_user_states', st.uid).catch(() => {})
            );
            continue;
          }
          const localSt = userStateLedger.get(st.uid);
          const cdRec = eventCooldownsMap.get(st.uid);
          const bestMbMs = Math.max(
            0,
            Number(localSt?.lastMysteryBoxClaimMs || 0),
            Number(st.lastMysteryBoxClaimMs || 0),
            Number(cdRec?.lastMysteryBoxClaimMs || 0)
          );
          const bestLsMs = Math.max(
            0,
            Number(localSt?.lastLuckySpinMs || 0),
            Number(st.lastLuckySpinMs || 0),
            Number(cdRec?.lastLuckySpinMs || 0)
          );
          const localUpdMs = localSt?.updatedAt
            ? new Date(localSt.updatedAt).getTime()
            : 0;
          const remoteUpdMs = st.updatedAt
            ? new Date(st.updatedAt).getTime()
            : 0;
          const baseSt = { ...localSt, ...st };
          if (matchedAcc?.username && isPlaceholderUsername(baseSt.username)) {
            baseSt.username = matchedAcc.username;
          }
          if (bestMbMs > 0) {
            baseSt.lastMysteryBoxClaimMs = bestMbMs;
            baseSt.lastMysteryBoxClaimAt = new Date(bestMbMs).toISOString();
          }
          if (bestLsMs > 0) {
            baseSt.lastLuckySpinMs = bestLsMs;
            baseSt.lastLuckySpinAt = new Date(bestLsMs).toISOString();
          }
          userStateLedger.set(st.uid, baseSt);
        }
      }

      // Also purge any in-memory phantom states
      Array.from(userStateLedger.entries()).forEach(([uid, st]) => {
        const matchedAcc = findAccountByUidInMemory(uid);
        if (isPhantomUserRecord(uid, matchedAcc, st)) {
          userStateLedger.delete(uid);
          phantomDeletes.push(
            deleteServerDoc('server_user_states', uid).catch(() => {})
          );
        }
      });
      if (phantomDeletes.length > 0) {
        await Promise.all(phantomDeletes).catch(() => {});
      }

      const remoteAccountKeys = new Set(
        remoteAccounts.map((a) =>
          (a.usernameLower || a.username || '').trim().toLowerCase()
        )
      );
      const remoteStateUids = new Set(remoteStates.map((s) => s.uid));

      const seedWrites: Promise<void>[] = [];
      const entries = Array.from(userAccountsMap.entries());
      for (const [usernameLower, acc] of entries) {
        if (isPlaceholderUsername(acc.username)) continue;
        if (!remoteAccountKeys.has(usernameLower)) {
          const docId = sanitizeAccountKey(usernameLower);
          seedWrites.push(
            setServerDoc('server_user_accounts', docId, {
              ...acc,
              usernameLower,
              status: acc.status || 'active',
            })
          );
        }
        const st = userStateLedger.get(acc.uid);
        if (st && !remoteStateUids.has(acc.uid)) {
          seedWrites.push(setServerDoc('server_user_states', acc.uid, st));
        }
      }
      if (seedWrites.length > 0) {
        await Promise.all(seedWrites);
      }

      if (econDoc && econDoc.coinsPerTap) {
        serverEconomicConfig = {
          ...DEFAULT_ECONOMIC_CONFIG,
          ...econDoc,
        };
      }

      for (const bc of remoteBroadcasts) {
        if (bc && bc.broadcastId) {
          adminBroadcastsMap.set(bc.broadcastId, bc);
        }
      }

      if (remoteNotifications.length > 0) {
        const existingNotifIds = new Set(
          serverNotificationsLedger.map((n) => n.id)
        );
        for (const notif of remoteNotifications) {
          if (notif && notif.id && !existingNotifIds.has(notif.id)) {
            serverNotificationsLedger.push(notif);
            existingNotifIds.add(notif.id);
          }
        }
        serverNotificationsLedger.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      }
    } catch (err) {
      console.warn(
        '[COINOVA-FIRESTORE] Initial Firestore seed check warning:',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      lastFirestoreHydrationMs = Date.now();
    }
  })();
  return firestoreSeedPromise;
}

// ============================================================================
// SERVER-SIDE ADMIN CREDENTIAL & SESSION MANAGEMENT (ENV + FIRESTORE HASH)
// ============================================================================
const PERSISTED_SERVER_ADMIN_AUTH = {
  username: 'boyy',
  passwordHash:
    'a9318c1ce69fb5c8cdb8055ce9717a63a11feb1c45b08d39044fbf23bf3238e0',
  trimmedPasswordHash:
    'a9318c1ce69fb5c8cdb8055ce9717a63a11feb1c45b08d39044fbf23bf3238e0',
  sessionSecret: 'COINOVA_SESSION_2026_9fK7xP2mQ8vL4zR6nT1wY5',
};

let cachedFirestoreAdminAuth: {
  username: string;
  passwordHash: string;
  trimmedPasswordHash: string;
  sessionSecret?: string;
} | null = { ...PERSISTED_SERVER_ADMIN_AUTH };

function readRuntimeEnvSecrets(): Record<string, string> {
  const merged: Record<string, string> = {};
  const dotenvPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env.production'),
    path.resolve(APP_ROOT_DIR, '.env'),
    path.resolve(APP_ROOT_DIR, '.env.local'),
  ];
  for (const envPath of dotenvPaths) {
    try {
      if (fs.existsSync(envPath)) {
        const parsedEnv = dotenv.parse(fs.readFileSync(envPath, 'utf-8'));
        for (const [k, v] of Object.entries(parsedEnv)) {
          if (typeof v === 'string' && v.length > 0 && !merged[k]) {
            merged[k] = v;
          }
        }
      }
    } catch {
      // ignore read errors
    }
  }
  try {
    dotenv.config();
  } catch {
    // ignore
  }
  const devEnvCandidates = [
    path.resolve(process.cwd(), '.dev.env.json'),
    path.resolve(APP_ROOT_DIR, '.dev.env.json'),
  ];
  for (const candidatePath of devEnvCandidates) {
    try {
      if (fs.existsSync(candidatePath)) {
        const raw = fs.readFileSync(candidatePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string' && v.length > 0) {
              merged[k] = v;
            }
          }
        }
        break;
      }
    } catch {
      // ignore read errors
    }
  }
  return merged;
}

function getEnvAdminCredentialsOnly(): {
  configured: boolean;
  missingVars: string[];
  username: string;
  passwordHash: string;
  trimmedPasswordHash: string;
  sessionSecret: string;
} {
  const runtimeSecrets = readRuntimeEnvSecrets();

  const rawUsername =
    runtimeSecrets.ADMIN_USERNAME ??
    process.env.ADMIN_USERNAME ??
    runtimeSecrets.COINOVA_ADMIN_USERNAME ??
    process.env.COINOVA_ADMIN_USERNAME ??
    runtimeSecrets.VITE_ADMIN_USERNAME ??
    process.env.VITE_ADMIN_USERNAME ??
    runtimeSecrets.NEXT_PUBLIC_ADMIN_USERNAME ??
    process.env.NEXT_PUBLIC_ADMIN_USERNAME ??
    runtimeSecrets.ADMIN_USER ??
    process.env.ADMIN_USER ??
    '';
  const rawPassword =
    runtimeSecrets.ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    runtimeSecrets.ADMIN_PASSWORD_SALT ||
    process.env.ADMIN_PASSWORD_SALT ||
    runtimeSecrets.COINOVA_ADMIN_PASSWORD ||
    process.env.COINOVA_ADMIN_PASSWORD ||
    runtimeSecrets.VITE_ADMIN_PASSWORD ||
    process.env.VITE_ADMIN_PASSWORD ||
    runtimeSecrets.NEXT_PUBLIC_ADMIN_PASSWORD ||
    process.env.NEXT_PUBLIC_ADMIN_PASSWORD ||
    runtimeSecrets.ADMIN_PASS ||
    process.env.ADMIN_PASS ||
    runtimeSecrets.ADMIN_SECRET ||
    process.env.ADMIN_SECRET ||
    '';
  const rawPasswordHash = (
    runtimeSecrets.ADMIN_PASSWORD_HASH ||
    process.env.ADMIN_PASSWORD_HASH ||
    ''
  ).trim();
  const rawSessionSecret =
    runtimeSecrets.ADMIN_SESSION_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    PERSISTED_SERVER_ADMIN_AUTH.sessionSecret ||
    'coinova_hmac_session_secret_2026';

  const username = String(rawUsername).trim();
  const password = String(rawPassword);
  const trimmedPassword = password.trim();
  const sessionSecret =
    String(rawSessionSecret).trim() || 'coinova_hmac_session_secret_2026';

  const missingVars: string[] = [];
  if (!username) missingVars.push('ADMIN_USERNAME');
  if (!trimmedPassword && !rawPasswordHash) missingVars.push('ADMIN_PASSWORD');

  const configured = Boolean(
    username.length > 0 && (trimmedPassword.length > 0 || rawPasswordHash.length >= 32)
  );
  const passwordHash = configured
    ? rawPasswordHash.length >= 32 && !trimmedPassword
      ? rawPasswordHash
      : crypto
          .createHash('sha256')
          .update(`coinova_adm_${username.toLowerCase()}:${password}`)
          .digest('hex')
    : '';
  const trimmedPasswordHash = configured
    ? rawPasswordHash.length >= 32 && !trimmedPassword
      ? rawPasswordHash
      : crypto
          .createHash('sha256')
          .update(`coinova_adm_${username.toLowerCase()}:${trimmedPassword}`)
          .digest('hex')
    : '';

  return {
    configured,
    missingVars,
    username,
    passwordHash,
    trimmedPasswordHash,
    sessionSecret,
  };
}

function getAuthoritativeAdminCredentials(): {
  configured: boolean;
  missingVars: string[];
  username: string;
  passwordHash: string;
  trimmedPasswordHash: string;
  sessionSecret: string;
} {
  const envCreds = getEnvAdminCredentialsOnly();
  if (envCreds.configured) {
    return envCreds;
  }
  const activeFallback = cachedFirestoreAdminAuth || PERSISTED_SERVER_ADMIN_AUTH;
  if (activeFallback && activeFallback.username && activeFallback.passwordHash) {
    return {
      configured: true,
      missingVars: [],
      username: activeFallback.username,
      passwordHash: activeFallback.passwordHash,
      trimmedPasswordHash:
        activeFallback.trimmedPasswordHash || activeFallback.passwordHash,
      sessionSecret:
        activeFallback.sessionSecret || envCreds.sessionSecret,
    };
  }
  return envCreds;
}

const revokedSessionTokens = new Set<string>();

function signUserSessionToken(
  uid: string,
  username: string,
  issuedAt: number,
  expiresAt: number
): string {
  const { sessionSecret } = getAuthoritativeAdminCredentials();
  const nonce = crypto.randomBytes(12).toString('hex');
  const payloadObj = { u: uid, n: username, i: issuedAt, e: expiresAt, x: nonce };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf-8').toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', sessionSecret)
    .update(`usr_sess:${payloadB64}`)
    .digest('base64url');
  return `cu1.${payloadB64}.${sig}`;
}

function resolveUserSessionFromToken(token: string): UserSessionRecord | null {
  if (!token || revokedSessionTokens.has(token)) return null;
  const cached = activeUserSessions.get(token);
  if (cached) {
    if (Date.now() > cached.expiresAt) {
      activeUserSessions.delete(token);
      return null;
    }
    return cached;
  }

  // Stateless HMAC verification for serverless multi-instance / cold starts
  if (!token.startsWith('cu1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, sig] = parts;
  try {
    const { sessionSecret } = getAuthoritativeAdminCredentials();
    const expectedSig = crypto
      .createHmac('sha256', sessionSecret)
      .update(`usr_sess:${payloadB64}`)
      .digest('base64url');
    const a = Buffer.from(sig, 'utf-8');
    const b = Buffer.from(expectedSig, 'utf-8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    const decoded = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8')
    );
    if (
      !decoded ||
      typeof decoded.u !== 'string' ||
      typeof decoded.n !== 'string' ||
      typeof decoded.e !== 'number'
    ) {
      return null;
    }
    if (Date.now() > decoded.e) {
      return null;
    }
    const restored: UserSessionRecord = {
      token,
      uid: decoded.u,
      username: decoded.n,
      createdAt: Number(decoded.i) || Date.now(),
      expiresAt: decoded.e,
    };
    activeUserSessions.set(token, restored);
    return restored;
  } catch {
    return null;
  }
}

interface AdminSessionRecord {
  token: string;
  username: string;
  credentialFingerprint: string;
  role: 'ADMIN';
  createdAt: number;
  expiresAt: number;
}

const activeAdminSessions = new Map<string, AdminSessionRecord>();

const SESSION_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function signAdminSessionToken(username: string, issuedAt: number): string {
  const { sessionSecret } = getAuthoritativeAdminCredentials();
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${username}:${issuedAt}:${nonce}`;
  const sig = crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifyAdminTokenSignature(token: string): boolean {
  try {
    const { sessionSecret } = getAuthoritativeAdminCredentials();
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 4) return false;
    const [username, issuedAt, nonce, sig] = parts;
    const payload = `${username}:${issuedAt}:${nonce}`;
    const expectedSig = crypto
      .createHmac('sha256', sessionSecret)
      .update(payload)
      .digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expectedSig, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function timingSafeCompareAdminPassword(
  candidateUsername: string,
  candidatePassword: string,
  expectedHashHex: string,
  expectedTrimmedHashHex: string
): boolean {
  if (!expectedHashHex) return false;
  const checkSingle = (pw: string, targetHex: string) => {
    if (!targetHex) return false;
    const candidateHashHex = crypto
      .createHash('sha256')
      .update(`coinova_adm_${candidateUsername.toLowerCase()}:${pw}`)
      .digest('hex');
    const a = Buffer.from(candidateHashHex, 'hex');
    const b = Buffer.from(targetHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  };
  return (
    checkSingle(candidatePassword, expectedHashHex) ||
    checkSingle(candidatePassword.trim(), expectedTrimmedHashHex)
  );
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim();
}

function resolveAdminSessionFromToken(token: string): AdminSessionRecord | null {
  if (!token || revokedSessionTokens.has(token)) return null;
  const creds = getAuthoritativeAdminCredentials();
  if (!creds.configured) return null;

  const existing = activeAdminSessions.get(token);
  if (existing) {
    if (
      existing.role !== 'ADMIN' ||
      existing.username.toLowerCase() !== creds.username.toLowerCase() ||
      existing.credentialFingerprint !== creds.passwordHash ||
      Date.now() > existing.expiresAt ||
      !verifyAdminTokenSignature(token)
    ) {
      activeAdminSessions.delete(token);
      return null;
    }
    return existing;
  }

  // Stateless HMAC verification for serverless cold starts / multiple instances
  if (!verifyAdminTokenSignature(token)) return null;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 4) return null;
    const [username, issuedAtStr] = parts;
    const issuedAt = Number(issuedAtStr);
    if (!Number.isFinite(issuedAt)) return null;
    const expiresAt = issuedAt + SESSION_TTL_MS;
    if (
      username.toLowerCase() !== creds.username.toLowerCase() ||
      Date.now() > expiresAt
    ) {
      return null;
    }
    const restored: AdminSessionRecord = {
      token,
      username: creds.username,
      credentialFingerprint: creds.passwordHash,
      role: 'ADMIN',
      createdAt: issuedAt,
      expiresAt,
    };
    activeAdminSessions.set(token, restored);
    return restored;
  } catch {
    return null;
  }
}

async function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      ok: false,
      error: 'Sesi Admin tidak valid. Silakan login kembali.',
    });
    return;
  }

  // Reject if a regular user token is used on an admin endpoint
  if (activeUserSessions.has(token) || token.startsWith('cu1.')) {
    res.status(401).json({
      ok: false,
      error: 'Akses ditolak.',
    });
    return;
  }

  await ensureAdminConfigSyncedWithFirestore();
  if (await isSessionRevokedInFirestore(token)) {
    res.status(401).json({
      ok: false,
      error: 'Sesi Admin telah berakhir. Silakan login kembali.',
    });
    return;
  }

  const session = resolveAdminSessionFromToken(token);
  if (!session) {
    res.status(401).json({
      ok: false,
      error: 'Sesi Admin tidak valid atau telah berakhir.',
    });
    return;
  }

  next();
}

// ============================================================================
// CENTRALIZED SERVER ECONOMY CONSTANTS (SINGLE SOURCE OF TRUTH)
// ============================================================================
const MIN_LEVEL_FOR_CONVERSION = 4; // Hanya Level 4 (Pro) & Level 5 (Ultimate)

// Single Source of Truth Level Tap Multipliers & Koin/Tap
// Base = 10 Koin/Tap:
// Level 1: 1x  -> +10 Koin/Tap
// Level 2: 2x  -> +20 Koin/Tap
// Level 3: 5x  -> +50 Koin/Tap
// Level 4: 30x -> +300 Koin/Tap (Pro)
// Level 5: 50x -> +500 Koin/Tap (Ultimate)
const LEVEL_TAP_MULTIPLIERS: Record<number, number> = {
  1: 1,
  2: 2,
  3: 5,
  4: 30,
  5: 50,
};

const LEVEL_MAX_ENERGY: Record<number, number> = {
  1: 200,
  2: 400,
  3: 800,
  4: 5000,
  5: 10000,
};

const LEVEL_DAILY_CLAIM_LIMITS: Record<number, number> = {
  1: 200,
  2: 400,
  3: 800,
  4: 5000,
  5: 10000,
};

const OFFICIAL_LEVEL_PRICES: Record<number, number> = {
  2: 25000,
  3: 50000,
  4: 100000,
  5: 200000,
};

// Server-authoritative Mission Rewards (Never trust reward amounts sent from client)
interface ServerMissionRewardDef {
  taskId: string;
  title: string;
  coinReward: number;
  fireReward: number;
}

const SERVER_MISSION_REWARDS: Record<string, ServerMissionRewardDef> = {
  vp_join_channel: {
    taskId: 'vp_join_channel',
    title: 'Bergabung Saluran COINOVA',
    coinReward: 5000,
    fireReward: 2,
  },
  vp_install_apk: {
    taskId: 'vp_install_apk',
    title: 'Install APK',
    coinReward: 5000,
    fireReward: 0,
  },
  vp_level_bonus: {
    taskId: 'vp_level_bonus',
    title: 'Bonus Level (Pro)',
    coinReward: 0,
    fireReward: 60,
  },
  vp_invite_5: {
    taskId: 'vp_invite_5',
    title: 'Mengundang 5 Teman',
    coinReward: 25000,
    fireReward: 10,
  },
  vp_claims_2500: {
    taskId: 'vp_claims_2500',
    title: 'Klaim 2500 Kali',
    coinReward: 20000,
    fireReward: 3,
  },
};

function resolveServerMissionReward(taskId: string): ServerMissionRewardDef | null {
  const cleanId = String(taskId || '').trim();
  if (SERVER_MISSION_REWARDS[cleanId]) {
    return SERVER_MISSION_REWARDS[cleanId];
  }
  if (/^vp_invite_5_\d+$/.test(cleanId)) {
    const targetNum = Number(cleanId.replace('vp_invite_5_', '')) || 5;
    return {
      taskId: cleanId,
      title: `Mengundang ${targetNum} Teman`,
      coinReward: 25000,
      fireReward: 10,
    };
  }
  return null;
}

const OFFICIAL_TELEGRAM_CHANNEL_URL =
  process.env.TELEGRAM_CHANNEL_URL || 'https://t.me/CoinovaOfficiall';
const OFFICIAL_TELEGRAM_CHANNEL_ID =
  process.env.TELEGRAM_CHANNEL_ID || '@CoinovaOfficiall';

function resolveTelegramBotToken(): string {
  const runtimeSecrets = readRuntimeEnvSecrets();
  return String(
    runtimeSecrets.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || ''
  ).trim();
}

function resolveApkDownloadUrl(): string {
  const runtimeSecrets = readRuntimeEnvSecrets();
  return (
    String(
      runtimeSecrets.COINOVA_APK_DOWNLOAD_URL ||
        process.env.COINOVA_APK_DOWNLOAD_URL ||
        runtimeSecrets.VITE_APK_DOWNLOAD_URL ||
        process.env.VITE_APK_DOWNLOAD_URL ||
        'https://coinova.app/download/coinova-latest.apk'
    ).trim() || 'https://coinova.app/download/coinova-latest.apk'
  );
}

function resolveApkVerifySecret(): string {
  const runtimeSecrets = readRuntimeEnvSecrets();
  return String(
    runtimeSecrets.APK_VERIFY_SECRET ||
      process.env.APK_VERIFY_SECRET ||
      'coinova_apk_verify_secret_2026'
  ).trim();
}

function createApkInstallTokenForUser(uid: string): string {
  const secret = resolveApkVerifySecret();
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`apk_install:${uid}`)
    .digest('hex')
    .slice(0, 24);
  return `apk_${Buffer.from(uid, 'utf-8').toString('base64url')}.${sig}`;
}

function verifyApkInstallTokenSignature(token: string, expectedUid?: string): string | null {
  const clean = String(token || '').trim();
  if (!clean.startsWith('apk_') || !clean.includes('.')) return null;
  const [prefixAndUidB64, sig] = clean.split('.');
  const uidB64 = prefixAndUidB64.slice(4);
  if (!uidB64 || !sig) return null;
  try {
    const decodedUid = Buffer.from(uidB64, 'base64url').toString('utf-8');
    if (!decodedUid) return null;
    if (expectedUid && decodedUid !== expectedUid) return null;
    const secret = resolveApkVerifySecret();
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`apk_install:${decodedUid}`)
      .digest('hex')
      .slice(0, 24);
    const a = Buffer.from(sig, 'utf-8');
    const b = Buffer.from(expectedSig, 'utf-8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    return decodedUid;
  } catch {
    return null;
  }
}

async function verifyTelegramChannelMembershipOnServer(
  telegramUserId: string
): Promise<{
  joined: boolean;
  status: string;
  username?: string;
  errorMessage: string;
}> {
  const NOT_JOINED_MSG =
    '❌ Kamu belum bergabung ke channel Telegram. Bergabung terlebih dahulu lalu tekan Verifikasi.';
  const cleanUserId = String(telegramUserId || '').trim();
  if (!/^\d{4,20}$/.test(cleanUserId)) {
    return {
      joined: false,
      status: 'unlinked',
      errorMessage:
        '❌ Kamu belum bergabung ke channel Telegram. Bergabung terlebih dahulu lalu tekan Verifikasi.',
    };
  }

  const botToken = resolveTelegramBotToken();
  if (!botToken || botToken === 'YOUR_TELEGRAM_BOT_TOKEN') {
    return {
      joined: false,
      status: 'bot_unconfigured',
      errorMessage: NOT_JOINED_MSG,
    };
  }

  const rawChannel = OFFICIAL_TELEGRAM_CHANNEL_ID.trim();
  const chatId =
    rawChannel.startsWith('@') || rawChannel.startsWith('-')
      ? rawChannel
      : `@${rawChannel
          .replace(/^https?:\/\/t\.me\//i, '')
          .replace(/^@+/, '')
          .split('/')[0]}`;

  try {
    const url = `https://api.telegram.org/bot${encodeURIComponent(
      botToken
    )}/getChatMember?chat_id=${encodeURIComponent(
      chatId
    )}&user_id=${encodeURIComponent(cleanUserId)}`;
    const tgRes = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const tgJson = (await tgRes.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: {
        status?: string;
        user?: {
          id?: number;
          username?: string;
          first_name?: string;
        };
      };
    } | null;

    if (!tgRes.ok || !tgJson || !tgJson.ok || !tgJson.result) {
      return {
        joined: false,
        status: 'not_member',
        errorMessage: NOT_JOINED_MSG,
      };
    }

    const memberStatus = String(tgJson.result.status || '').toLowerCase();
    // Strictly allowed statuses: member, administrator, creator
    // Statuses 'left' and 'kicked' (and any others) are NOT considered joined
    if (
      memberStatus === 'member' ||
      memberStatus === 'administrator' ||
      memberStatus === 'creator'
    ) {
      return {
        joined: true,
        status: memberStatus,
        username: tgJson.result.user?.username,
        errorMessage: '',
      };
    }

    return {
      joined: false,
      status: memberStatus || 'left',
      errorMessage: NOT_JOINED_MSG,
    };
  } catch (err) {
    console.warn(
      '[COINOVA-TELEGRAM] getChatMember request failed:',
      err instanceof Error ? err.message : String(err)
    );
    return {
      joined: false,
      status: 'error',
      errorMessage: NOT_JOINED_MSG,
    };
  }
}

function getRewardPerTapForLevel(level: number): number {
  const cleanLevel = Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));
  const baseCoins = Math.max(1, Math.floor(serverEconomicConfig.coinsPerTap || 10));
  const multiplier = LEVEL_TAP_MULTIPLIERS[cleanLevel] || 1;
  return baseCoins * multiplier;
}

function getServerTodayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeIndoPhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+62')) {
    return '0' + digits.slice(3);
  }
  if (digits.startsWith('62')) {
    return '0' + digits.slice(2);
  }
  return digits.replace(/\D/g, '');
}

function isValidEWalletNumber(phone: string): boolean {
  return /^08\d{8,13}$/.test(phone);
}

/**
 * Retrieves or initializes authoritative server-side user state and applies
 * Core Energy is server-authoritative and NEVER regenerates automatically.
 * Also keeps `dragonLevel` synchronized with the user's authoritative level.
 */
function getOrSyncServerUserState(
  uid: string,
  hint?: Partial<ServerUserState>,
  allowInsertToLedger = true
): ServerUserState {
  const today = getServerTodayKey();
  const nowMs = Date.now();
  const existing = userStateLedger.get(uid);
  const matchedAcc = findAccountByUidInMemory(uid);

  if (!existing) {
    const initLevel = Math.max(
      1,
      Math.min(
        5,
        Math.floor(Number(hint?.dragonLevel || matchedAcc?.dragonLevel || 1))
      )
    );
    const maxEnergy = LEVEL_MAX_ENERGY[initLevel] || 200;
    const initEnergy =
      hint?.energy !== undefined
        ? Math.min(maxEnergy, Math.max(0, Math.floor(Number(hint.energy))))
        : maxEnergy;
    const initClaims =
      hint?.lastClaimDate === today
        ? Math.max(0, Math.floor(Number(hint?.dailyClaimsUsed ?? 0)))
        : 0;
    const initConverted =
      hint?.lastConvertDate === today
        ? Math.max(0, Math.floor(Number(hint?.dailyConvertedFire ?? 0)))
        : 0;

    const resolvedUsername =
      (!isPlaceholderUsername(hint?.username) ? hint?.username : undefined) ||
      matchedAcc?.username ||
      '';

    const created: ServerUserState = {
      uid,
      username: resolvedUsername,
      referralCode: matchedAcc?.referralCode || hint?.referralCode,
      referredByUid: matchedAcc?.referredByUid || hint?.referredByUid,
      referredByCode: matchedAcc?.referredByCode || hint?.referredByCode,
      dragonLevel: initLevel,
      coinBalance: Math.max(
        0,
        Math.floor(Number(hint?.coinBalance ?? 0))
      ),
      fireBalance: Math.max(0, Math.floor(Number(hint?.fireBalance ?? 0))),
      lockedIdrBalance: Math.max(
        0,
        Math.floor(Number(hint?.lockedIdrBalance ?? 0))
      ),
      energy: initEnergy,
      maxEnergy,
      lastEnergyRegenMs: nowMs,
      cycleProgress: 0,
      dailyClaimsUsed: initClaims,
      lastClaimDate: today,
      lastConvertDate: today,
      dailyConvertedFire: initConverted,
      totalTaps: Math.max(0, Math.floor(Number(hint?.totalTaps ?? 0))),
      updatedAt: new Date(nowMs).toISOString(),
    };
    // Only insert into userStateLedger if this is a registered user or explicit persistence is allowed
    if (
      allowInsertToLedger &&
      (Boolean(matchedAcc) || !isPhantomUserRecord(uid, matchedAcc, created))
    ) {
      userStateLedger.set(uid, created);
    }
    return created;
  }

  if (matchedAcc?.username && isPlaceholderUsername(existing.username)) {
    existing.username = matchedAcc.username;
  } else if (
    hint?.username &&
    !isPlaceholderUsername(hint.username) &&
    isPlaceholderUsername(existing.username)
  ) {
    existing.username = hint.username;
  }

  // Sync dragonLevel from authoritative account record only (never let client hints overwrite server level)
  if (matchedAcc?.dragonLevel && matchedAcc.dragonLevel > existing.dragonLevel) {
    existing.dragonLevel = matchedAcc.dragonLevel;
    existing.maxEnergy = LEVEL_MAX_ENERGY[existing.dragonLevel] || existing.maxEnergy;
  }

  // Apply daily resets if date changed
  if (existing.lastClaimDate !== today) {
    existing.lastClaimDate = today;
    existing.dailyClaimsUsed = 0;
  }
  if (existing.lastConvertDate !== today) {
    existing.lastConvertDate = today;
    existing.dailyConvertedFire = 0;
  }

  // Ensure maxEnergy matches user's authoritative level
  const authMaxEnergy = LEVEL_MAX_ENERGY[existing.dragonLevel] || 200;
  existing.maxEnergy = authMaxEnergy;

  // IMPORTANT: never increase energy because time elapsed. Energy changes only
  // through a valid tap spend or an approved level upgrade.

  return existing;
}

async function loadAndSyncServerUserStateFromFirestore(
  uid: string,
  hint?: Partial<ServerUserState>,
  readOnly = false
): Promise<ServerUserState> {
  const localBefore = userStateLedger.get(uid);
  const memCooldown = eventCooldownsMap.get(uid);
  const matchedAcc = findAccountByUidInMemory(uid);
  let foundRemoteState = false;
  try {
    // Critical player state is read in STRICT mode. A Firestore outage/429 must
    // never be interpreted as an empty wallet or fresh full Energy state.
    const [remoteState, remoteCooldown] = await Promise.all([
      getServerDoc<ServerUserState>('server_user_states', uid, true, true),
      getServerDoc<ServerEventCooldownRecord>(
        'server_event_cooldowns',
        sanitizeAccountKey(uid),
        true
      ).catch(() => null),
    ]);

    const bestMysteryBoxMs = Math.max(
      0,
      Number(localBefore?.lastMysteryBoxClaimMs || 0),
      Number(remoteState?.lastMysteryBoxClaimMs || 0),
      Number(memCooldown?.lastMysteryBoxClaimMs || 0),
      Number(remoteCooldown?.lastMysteryBoxClaimMs || 0)
    );
    const bestLuckySpinMs = Math.max(
      0,
      Number(localBefore?.lastLuckySpinMs || 0),
      Number(remoteState?.lastLuckySpinMs || 0),
      Number(memCooldown?.lastLuckySpinMs || 0),
      Number(remoteCooldown?.lastLuckySpinMs || 0)
    );

    if (bestMysteryBoxMs > 0 || bestLuckySpinMs > 0) {
      eventCooldownsMap.set(uid, {
        uid,
        lastMysteryBoxClaimMs: bestMysteryBoxMs,
        lastMysteryBoxClaimAt:
          bestMysteryBoxMs > 0
            ? new Date(bestMysteryBoxMs).toISOString()
            : null,
        lastLuckySpinMs: bestLuckySpinMs,
        lastLuckySpinAt:
          bestLuckySpinMs > 0 ? new Date(bestLuckySpinMs).toISOString() : null,
        updatedAt: new Date().toISOString(),
      });
    }

    if (
      remoteState &&
      remoteState.uid &&
      !isPhantomUserRecord(uid, matchedAcc, remoteState)
    ) {
      foundRemoteState = true;
      // Firestore is authoritative for persisted player state.
      // Do not let stale in-memory state overwrite a newer/authoritative remote snapshot.
      const merged: ServerUserState = {
        ...(localBefore || {}),
        ...remoteState,
      };
      if (matchedAcc?.username && isPlaceholderUsername(merged.username)) {
        merged.username = matchedAcc.username;
      }
      if (bestMysteryBoxMs > 0) {
        merged.lastMysteryBoxClaimMs = bestMysteryBoxMs;
        merged.lastMysteryBoxClaimAt = new Date(bestMysteryBoxMs).toISOString();
      }
      if (bestLuckySpinMs > 0) {
        merged.lastLuckySpinMs = bestLuckySpinMs;
        merged.lastLuckySpinAt = new Date(bestLuckySpinMs).toISOString();
      }
      userStateLedger.set(uid, merged);
    }
  } catch (error) {
    // NEVER synthesize a new 0-coin/full-energy wallet when the authoritative
    // state read failed. Use an already-hydrated in-memory snapshot if available;
    // otherwise fail the request so the client can keep its current UI state.
    if (localBefore) {
      return getOrSyncServerUserState(uid, undefined, false);
    }
    throw error;
  }
  if (!foundRemoteState && matchedAcc && !localBefore) {
    throw new FirestoreServerError(
      'Data state game akun tidak ditemukan. COINOVA tidak akan mereset saldo secara otomatis.',
      503,
      'USER_STATE_MISSING'
    );
  }

  const canPersist =
    !readOnly || Boolean(matchedAcc) || Boolean(localBefore) || foundRemoteState;
  const state = getOrSyncServerUserState(uid, hint, canPersist);
  const latestCd = eventCooldownsMap.get(uid);
  if (latestCd) {
    if (latestCd.lastMysteryBoxClaimMs > Number(state.lastMysteryBoxClaimMs || 0)) {
      state.lastMysteryBoxClaimMs = latestCd.lastMysteryBoxClaimMs;
      state.lastMysteryBoxClaimAt =
        latestCd.lastMysteryBoxClaimAt ||
        new Date(latestCd.lastMysteryBoxClaimMs).toISOString();
    }
    if (latestCd.lastLuckySpinMs > Number(state.lastLuckySpinMs || 0)) {
      state.lastLuckySpinMs = latestCd.lastLuckySpinMs;
      state.lastLuckySpinAt =
        latestCd.lastLuckySpinAt ||
        new Date(latestCd.lastLuckySpinMs).toISOString();
    }
  }
  if (!readOnly && canPersist && !isPhantomUserRecord(uid, matchedAcc, state)) {
    await persistUserStateToFirestore(state);
  }
  return state;
}

// Pre-launch clean reset: do not seed any mock or default user accounts on startup
function ensureDefaultUserSeeded(): void {
  // No-op: Total Users starts strictly at 0
}
ensureDefaultUserSeeded();

// ============================================================================
// 1. USER AUTHENTICATION ROUTES: REGISTER, LOGIN, SESSION, LOGOUT
// ============================================================================
const handleUserRegister = async (req: Request, res: Response) => {
  try {
    const rawUsername = String(req.body?.username || '').trim();
    const rawEmail = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const confirmPassword = String(
      req.body?.confirmPassword ?? req.body?.password ?? ''
    );
    const referralCodeInput = String(req.body?.referralCodeInput || '')
      .trim()
      .toUpperCase();

    if (rawUsername.length < 3 || rawUsername.length > 32) {
      console.warn(
        `[COINOVA-AUTH] Register validation failed: invalid username length (${rawUsername.length}).`
      );
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Username wajib diisi antara 3 hingga 32 karakter.',
      });
      return;
    }
    if (password.length < 4) {
      console.warn(
        `[COINOVA-AUTH] Register validation failed for user "${rawUsername}": password too short.`
      );
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Password wajib minimal 4 karakter.',
      });
      return;
    }
    if (password !== confirmPassword) {
      console.warn(
        `[COINOVA-AUTH] Register validation failed for user "${rawUsername}": password confirmation mismatch.`
      );
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Konfirmasi password tidak cocok dengan password.',
      });
      return;
    }

    const key = rawUsername.toLowerCase();
    const existingAccount = await loadUserAccountFromFirestore(key);
    if (existingAccount) {
      console.warn(
        `[COINOVA-AUTH] Register rejected: username "${rawUsername}" already exists.`
      );
      res.status(409).json({
        ok: false,
        code: 'USERNAME_TAKEN',
        error: 'Username sudah terdaftar. Silakan gunakan menu LOGIN.',
      });
      return;
    }

    // Optional referral binding on registration
    let referredByCode: string | undefined;
    let referredByUid: string | undefined;
    if (referralCodeInput) {
      const inviterAcc =
        await findInviterByReferralCodeFromFirestore(referralCodeInput);
      if (inviterAcc) {
        referredByCode = inviterAcc.referralCode.toUpperCase();
        referredByUid = inviterAcc.uid;
      }
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const uid = `usr_${now}_${crypto.randomBytes(3).toString('hex')}`;
    const referralCode = crypto.randomBytes(3).toString('hex').toUpperCase();

    const newAccount: ServerUserAccountRecord = {
      uid,
      username: rawUsername,
      usernameLower: key,
      email: rawEmail || undefined,
      passwordHash: hashPassword(password),
      referralCode,
      referredByCode,
      referredByUid,
      dragonLevel: 1,
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    // Force strictly zeroed initial state for every newly registered account
    const today = getServerTodayKey();
    const cleanState: ServerUserState = {
      uid,
      username: rawUsername,
      dragonLevel: 1,
      coinBalance: 0,
      fireBalance: 0,
      lockedIdrBalance: 0,
      energy: LEVEL_MAX_ENERGY[1],
      maxEnergy: LEVEL_MAX_ENERGY[1],
      lastEnergyRegenMs: now,
      cycleProgress: 0,
      dailyClaimsUsed: 0,
      lastClaimDate: today,
      lastConvertDate: today,
      dailyConvertedFire: 0,
      totalTaps: 0,
      boundReferralCode: referredByCode,
      updatedAt: nowIso,
    };

    const expiresAt = now + USER_SESSION_TTL_MS;
    const token = signUserSessionToken(uid, rawUsername, now, expiresAt);
    const session: UserSessionRecord = {
      token,
      uid,
      username: rawUsername,
      createdAt: now,
      expiresAt,
    };
    activeUserSessions.set(token, session);

    const writePromises: Promise<void>[] = [
      persistUserAccountToFirestore(newAccount),
      persistUserStateToFirestore(cleanState),
      persistSessionToFirestore(
        token,
        uid,
        rawUsername,
        'USER',
        now,
        expiresAt,
        false
      ),
    ];

    if (referredByCode && referredByUid && referredByUid !== uid) {
      boundReferralsMap.set(uid, referredByCode);
      const refId = `ref_${referredByUid}_${uid}`;
      const refRecord: ReferralMilestoneState = {
        referralId: refId,
        inviterUid: referredByUid,
        inviteeUid: uid,
        inviteeUsername: rawUsername,
        inviterCode: referredByCode,
        rewardCoin: serverEconomicConfig.referralTopupCoinReward || 25000,
        rewardFire: serverEconomicConfig.referralActiveFireReward || 2,
        rewardIdr: serverEconomicConfig.referralTopupCoinReward || 25000,
        status: 'PENDING',
        activeRewardClaimed: false,
        topupRewardClaimed: false,
        upgradeRewardClaimed: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      referralMilestonesMap.set(refId, refRecord);
      writePromises.push(setServerDoc('server_referrals', refId, refRecord));
    }

    await Promise.all(writePromises);

    res.json({
      ok: true,
      token,
      session,
      user: {
        uid: newAccount.uid,
        username: newAccount.username,
        email: newAccount.email || '',
        referralCode: newAccount.referralCode,
        referredByCode: newAccount.referredByCode,
        referredByUid: newAccount.referredByUid,
        dragonLevel: 1,
        coinBalance: 0,
        fireBalance: 0,
        energy: LEVEL_MAX_ENERGY[1],
        maxEnergy: LEVEL_MAX_ENERGY[1],
        totalTaps: 0,
        dailyClaimsUsed: 0,
        role: 'player',
        expiresAt: session.expiresAt,
      },
      state: {
        ...cleanState,
        idrBalance: 0,
        rewardPerTap: getRewardPerTapForLevel(1),
      },
    });
  } catch (err) {
    console.error(
      '[COINOVA-AUTH] Unexpected error during user registration:',
      err instanceof Error ? err.message : String(err)
    );
    if (err instanceof FirestoreServerError) {
      res.status(err.statusCode || 503).json({
        ok: false,
        code: 'BACKEND_CONFIG_ERROR',
        error: `Konfigurasi database server (Firestore) bermasalah (${err.code}). Periksa environment variable Firebase di server.`,
      });
      return;
    }
    res.status(500).json({
      ok: false,
      code: 'SERVER_ERROR',
      error: 'Gagal memproses pendaftaran akun di server.',
    });
  }
};

app.post('/api/auth/register', handleUserRegister);
app.post('/api/auth/user-register', handleUserRegister);

const handleUserLogin = async (req: Request, res: Response) => {
  try {
    const rawInput = String(req.body?.username || req.body?.email || '').trim();
    const password = String(req.body?.password || '');

    if (!rawInput) {
      console.warn('[COINOVA-AUTH] Login rejected: empty username/email.');
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Username atau email wajib diisi.',
      });
      return;
    }
    if (!password || password.length < 4) {
      console.warn(
        `[COINOVA-AUTH] Login rejected for "${rawInput}": password shorter than 4 chars.`
      );
      res.status(400).json({
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Password wajib diisi (minimal 4 karakter).',
      });
      return;
    }

    const account = await loadUserAccountFromFirestore(rawInput);

    if (!account) {
      console.warn(
        `[COINOVA-AUTH] Login failed: account "${rawInput}" not found (loaded accounts=${userAccountsMap.size}).`
      );
      res.status(401).json({
        ok: false,
        code: 'ACCOUNT_NOT_FOUND',
        error: 'Akun tidak ditemukan. Silakan daftar melalui tab REGISTER.',
      });
      return;
    }

    const candidateHash = hashPassword(password);
    if (account.passwordHash !== candidateHash) {
      console.warn(
        `[COINOVA-AUTH] Login failed: invalid password for user "${account.username}".`
      );
      res.status(401).json({
        ok: false,
        code: 'INVALID_CREDENTIALS',
        error: 'Password yang Anda masukkan salah.',
      });
      return;
    }

    const now = Date.now();
    const expiresAt = now + USER_SESSION_TTL_MS;
    const token = signUserSessionToken(
      account.uid,
      account.username,
      now,
      expiresAt
    );
    const session: UserSessionRecord = {
      token,
      uid: account.uid,
      username: account.username,
      createdAt: now,
      expiresAt,
    };
    activeUserSessions.set(token, session);

    const state = await loadAndSyncServerUserStateFromFirestore(account.uid, {
      username: account.username,
      dragonLevel: account.dragonLevel,
      coinBalance: 0,
      fireBalance: 0,
    });

    await persistSessionToFirestore(
      token,
      account.uid,
      account.username,
      'USER',
      now,
      expiresAt,
      false
    );

    res.json({
      ok: true,
      token,
      session,
      user: {
        uid: account.uid,
        username: account.username,
        email: account.email || '',
        referralCode: account.referralCode,
        referredByCode: account.referredByCode,
        referredByUid: account.referredByUid,
        dragonLevel: state.dragonLevel,
        coinBalance: state.coinBalance,
        fireBalance: state.fireBalance,
        energy: state.energy,
        maxEnergy: state.maxEnergy,
        totalTaps: state.totalTaps,
        dailyClaimsUsed: state.dailyClaimsUsed,
        role: 'player',
        expiresAt: session.expiresAt,
      },
      state: {
        ...state,
        idrBalance: state.coinBalance,
        rewardPerTap: getRewardPerTapForLevel(state.dragonLevel),
      },
    });
  } catch (err) {
    console.error(
      '[COINOVA-AUTH] Unexpected error during user login:',
      err instanceof Error ? err.message : String(err)
    );
    if (err instanceof FirestoreServerError) {
      res.status(err.statusCode || 503).json({
        ok: false,
        code: 'BACKEND_CONFIG_ERROR',
        error: `Konfigurasi database server (Firestore) bermasalah (${err.code}). Periksa environment variable Firebase di server.`,
      });
      return;
    }
    res.status(500).json({
      ok: false,
      code: 'SERVER_ERROR',
      error: 'Gagal memproses login di server.',
    });
  }
};

app.post('/api/auth/login', handleUserLogin);
app.post('/api/auth/user-login', handleUserLogin);

const handleGetUserSession = async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'Sesi pengguna tidak ditemukan.' });
    return;
  }
  await ensureAdminConfigSyncedWithFirestore();
  if (await isSessionRevokedInFirestore(token)) {
    activeUserSessions.delete(token);
    res.status(401).json({ ok: false, error: 'Sesi pengguna telah berakhir.' });
    return;
  }
  const session = resolveUserSessionFromToken(token);
  if (!session || Date.now() > session.expiresAt) {
    if (session) activeUserSessions.delete(token);
    res.status(401).json({ ok: false, error: 'Sesi pengguna telah berakhir.' });
    return;
  }
  const matchedAccount =
    (await loadUserAccountFromFirestore(session.username).catch(() => null)) ||
    (await loadUserAccountByUidFromFirestore(session.uid)) ||
    undefined;
  let state: ServerUserState;
  try {
    state = await loadAndSyncServerUserStateFromFirestore(session.uid, {
      username: session.username,
      dragonLevel: matchedAccount?.dragonLevel,
    });
  } catch (error) {
    console.error('[COINOVA-AUTH] Authoritative user-state restore failed:', error instanceof Error ? error.message : String(error));
    res.status(503).json({
      ok: false,
      code: 'USER_STATE_UNAVAILABLE',
      error: 'Data akun belum dapat diverifikasi dari server. Saldo tidak diubah dan tidak direset.',
    });
    return;
  }
  res.json({
    ok: true,
    user: {
      uid: session.uid,
      username: session.username,
      email: matchedAccount?.email || '',
      referralCode: matchedAccount?.referralCode,
      referredByCode: matchedAccount?.referredByCode,
      dragonLevel: state.dragonLevel,
      coinBalance: state.coinBalance,
      fireBalance: state.fireBalance,
      energy: state.energy,
      maxEnergy: state.maxEnergy,
      totalTaps: state.totalTaps,
      dailyClaimsUsed: state.dailyClaimsUsed,
      role: 'player',
      expiresAt: session.expiresAt,
    },
    state: {
      ...state,
      idrBalance: state.coinBalance,
      rewardPerTap: getRewardPerTapForLevel(state.dragonLevel),
    },
  });
};

app.get('/api/auth/session', handleGetUserSession);
app.get('/api/auth/user-session', handleGetUserSession);

const handleUserLogout = async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  if (token) {
    const existing = resolveUserSessionFromToken(token);
    activeUserSessions.delete(token);
    revokedSessionTokens.add(token);
    try {
      await persistSessionToFirestore(
        token,
        existing?.uid || 'revoked_user',
        existing?.username || 'user',
        'USER',
        existing?.createdAt || Date.now(),
        existing?.expiresAt || Date.now(),
        true
      );
    } catch {
      // ignore transient error
    }
  }
  res.json({ ok: true, message: 'Sesi pengguna berhasil dihentikan.' });
};

app.post('/api/auth/logout', handleUserLogout);
app.post('/api/auth/user-logout', handleUserLogout);

// ============================================================================
// 2. ADMIN AUTHENTICATION ROUTES (ENVIRONMENT SECRETS + FIRESTORE HASH)
// ============================================================================
app.post('/api/admin/login', async (req: Request, res: Response) => {
  try {
    await ensureAdminConfigSyncedWithFirestore();

    const creds = getAuthoritativeAdminCredentials();
    if (!creds.configured) {
      console.error(
        `[COINOVA-AUTH] Admin login failed due to missing environment variable(s): ${creds.missingVars.join(', ')}`
      );
      res.status(503).json({
        ok: false,
        code: 'BACKEND_CONFIG_ERROR',
        error: `Konfigurasi environment variable admin belum diset di server (${creds.missingVars.join(', ')}).`,
      });
      return;
    }

    const now = Date.now();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    const isUsernameValid =
      username.length > 0 &&
      username.toLowerCase() === creds.username.toLowerCase();
    const isPasswordValid = timingSafeCompareAdminPassword(
      creds.username,
      password,
      creds.passwordHash,
      creds.trimmedPasswordHash
    );

    if (!isUsernameValid || !isPasswordValid) {
      console.warn(
        `[COINOVA-AUTH] Admin login rejected: invalid credentials for username="${username || '<empty>'}".`
      );
      res.status(401).json({
        ok: false,
        error: 'Username atau password admin salah.',
      });
      return;
    }

    const token = signAdminSessionToken(creds.username, now);
    const session: AdminSessionRecord = {
      token,
      username: creds.username,
      credentialFingerprint: creds.passwordHash,
      role: 'ADMIN',
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    activeAdminSessions.set(token, session);

    const auditEntry = recordAdminAudit(
      creds.username,
      'ADMIN_LOGIN',
      creds.username,
      'SUCCESS',
      'Admin berhasil login ke COINOVA Security Portal'
    );
    await Promise.all([
      persistSessionToFirestore(
        token,
        'admin_root',
        creds.username,
        'ADMIN',
        now,
        session.expiresAt,
        false
      ),
      setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry),
    ]);

    res.json({
      ok: true,
      token,
      admin: {
        uid: 'admin_root',
        username: session.username,
        role: session.role,
        expiresAt: session.expiresAt,
      },
    });
  } catch (err) {
    console.error(
      '[COINOVA-AUTH] Admin login internal error:',
      err instanceof Error ? err.message : String(err)
    );
    res.status(500).json({
      ok: false,
      error: 'Server admin sedang bermasalah. Coba lagi.',
    });
  }
});

app.get('/api/admin/session', requireAdminAuth, (req: Request, res: Response) => {
  const token = extractBearerToken(req)!;
  const session = resolveAdminSessionFromToken(token)!;
  res.json({
    ok: true,
    admin: {
      uid: 'admin_root',
      username: session.username,
      role: session.role,
      expiresAt: session.expiresAt,
    },
  });
});

app.post('/api/admin/logout', async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  if (token) {
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token);
    if (session) {
      const auditEntry = recordAdminAudit(
        session.username,
        'ADMIN_LOGOUT',
        session.username,
        'LOGGED_OUT',
        'Admin mengakhiri sesi'
      );
      await setServerDoc(
        'server_admin_audits',
        auditEntry.auditId,
        auditEntry
      ).catch(() => {});
    }
    activeAdminSessions.delete(token);
    revokedSessionTokens.add(token);
    await persistSessionToFirestore(
      token,
      'admin_root',
      session?.username || 'admin',
      'ADMIN',
      session?.createdAt || Date.now(),
      session?.expiresAt || Date.now(),
      true
    ).catch(() => {});
  }
  res.json({ ok: true });
});

app.post(
  '/api/admin/action',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const action = String(req.body?.action || 'ADMIN_ACTION');
    const targetUser = String(req.body?.targetUser || '-');
    const amountOrStatus = String(req.body?.amountOrStatus || 'AUTHORIZED');

    const auditEntry = recordAdminAudit(
      session.username,
      action,
      targetUser,
      amountOrStatus,
      `Authorized admin action: ${action}`
    );
    await setServerDoc(
      'server_admin_audits',
      auditEntry.auditId,
      auditEntry
    ).catch(() => {});

    res.json({
      ok: true,
      authorizedBy: session.username,
      role: session.role,
      action,
      timestamp: new Date().toISOString(),
    });
  }
);

// ============================================================================
// ADMIN ECONOMIC CONFIG & FRAUD REVIEW ENDPOINTS
// ============================================================================
app.get(
  '/api/admin/economic-config',
  requireAdminAuth,
  (_req: Request, res: Response) => {
    res.json({
      ok: true,
      config: serverEconomicConfig,
    });
  }
);

app.post(
  '/api/admin/economic-config',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const body = req.body || {};
    serverEconomicConfig = {
      coinsPerTap: Math.max(
        1,
        Math.floor(Number(body.coinsPerTap ?? serverEconomicConfig.coinsPerTap))
      ),
      energyCostPerTap: Math.max(
        1,
        Math.floor(
          Number(body.energyCostPerTap ?? serverEconomicConfig.energyCostPerTap)
        )
      ),
      energyRegenPerMinute: 0,
      coinToIdrRate: 1,
      coinsPerFireConvert: Math.max(
        100,
        Math.floor(
          Number(
            body.coinsPerFireConvert ??
              serverEconomicConfig.coinsPerFireConvert
          )
        )
      ),
      maxDailyFireConvert: Math.max(
        1,
        Math.floor(
          Number(
            body.maxDailyFireConvert ??
              serverEconomicConfig.maxDailyFireConvert
          )
        )
      ),
      minWithdrawIdr: Math.max(
        10000,
        Math.floor(
          Number(body.minWithdrawIdr ?? serverEconomicConfig.minWithdrawIdr)
        )
      ),
      referralActiveFireReward: Math.max(
        0,
        Math.floor(
          Number(
            body.referralActiveFireReward ??
              serverEconomicConfig.referralActiveFireReward
          )
        )
      ),
      referralTopupCoinReward: Math.max(
        0,
        Math.floor(
          Number(
            body.referralTopupCoinReward ??
              serverEconomicConfig.referralTopupCoinReward
          )
        )
      ),
      referralTopupFireReward: Math.max(
        0,
        Math.floor(
          Number(
            body.referralTopupFireReward ??
              serverEconomicConfig.referralTopupFireReward
          )
        )
      ),
      referralUpgradeCoinReward: Math.max(
        0,
        Math.floor(
          Number(
            body.referralUpgradeCoinReward ??
              serverEconomicConfig.referralUpgradeCoinReward
          )
        )
      ),
      referralUpgradeFireReward: Math.max(
        0,
        Math.floor(
          Number(
            body.referralUpgradeFireReward ??
              serverEconomicConfig.referralUpgradeFireReward
          )
        )
      ),
      updatedAt: new Date().toISOString(),
    };

    const auditEntry = recordAdminAudit(
      session.username,
      'UPDATE_ECONOMIC_CONFIG',
      'GLOBAL',
      `baseTap=${serverEconomicConfig.coinsPerTap}`,
      'Updated global economic config'
    );
    await Promise.all([
      setServerDoc('server_config', 'economic_config', {
        docKey: 'economic_config',
        ...serverEconomicConfig,
      }),
      setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry),
    ]).catch(() => {});

    res.json({
      ok: true,
      config: serverEconomicConfig,
    });
  }
);

// ============================================================================
// DYNAMIC ADMIN QRIS STORAGE & ENDPOINTS (PERSISTENT IN FIRESTORE + SERVER DISK)
// ============================================================================
export interface ServerQrisConfig {
  hasQris: boolean;
  imageDataUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  updatedBy: string;
  updatedAt: string;
}

const QRIS_CONFIG_FILE = path.join(DATA_DIR, 'qris_config.json');
const QRIS_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const QRIS_CHUNK_CHAR_SIZE = 650000; // Safe under Firestore 1 MB document limit
const ALLOWED_QRIS_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

let cachedServerQrisConfig: ServerQrisConfig | null = null;
let lastQrisFirestoreCheckMs = 0;

function loadQrisConfigFromDisk(): ServerQrisConfig | null {
  try {
    if (fs.existsSync(QRIS_CONFIG_FILE)) {
      const raw = fs.readFileSync(QRIS_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<ServerQrisConfig>;
      if (parsed && typeof parsed === 'object') {
        const hasValidImage = Boolean(
          parsed.hasQris &&
            typeof parsed.imageDataUrl === 'string' &&
            parsed.imageDataUrl.startsWith('data:image/')
        );
        return {
          hasQris: hasValidImage,
          imageDataUrl: hasValidImage ? String(parsed.imageDataUrl) : '',
          fileName: hasValidImage ? String(parsed.fileName || 'qris.png') : '',
          mimeType: hasValidImage ? String(parsed.mimeType || 'image/png') : '',
          fileSize: hasValidImage ? Number(parsed.fileSize || 0) : 0,
          updatedBy: String(parsed.updatedBy || ''),
          updatedAt: String(parsed.updatedAt || ''),
        };
      }
    }
  } catch {
    // ignore read errors
  }
  return null;
}

function saveQrisConfigToDisk(cfg: ServerQrisConfig): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(QRIS_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch {
    // ignore on read-only serverless filesystems
  }
}

async function persistQrisConfigToFirestore(cfg: ServerQrisConfig): Promise<void> {
  cachedServerQrisConfig = cfg;
  lastQrisFirestoreCheckMs = Date.now();
  saveQrisConfigToDisk(cfg);

  const nowIso = cfg.updatedAt || new Date().toISOString();
  if (!cfg.hasQris || !cfg.imageDataUrl) {
    await setServerDoc('server_config', 'qris_config', {
      docKey: 'qris_config',
      hasQris: false,
      imageDataUrl: '',
      fileName: '',
      mimeType: '',
      fileSize: 0,
      chunkCount: 0,
      updatedBy: cfg.updatedBy || 'admin',
      updatedAt: nowIso,
    });
    return;
  }

  if (cfg.imageDataUrl.length <= QRIS_CHUNK_CHAR_SIZE) {
    await setServerDoc('server_config', 'qris_config', {
      docKey: 'qris_config',
      hasQris: true,
      imageDataUrl: cfg.imageDataUrl,
      fileName: cfg.fileName,
      mimeType: cfg.mimeType,
      fileSize: cfg.fileSize,
      chunkCount: 0,
      updatedBy: cfg.updatedBy || 'admin',
      updatedAt: nowIso,
    });
    return;
  }

  const chunks: string[] = [];
  for (let i = 0; i < cfg.imageDataUrl.length; i += QRIS_CHUNK_CHAR_SIZE) {
    chunks.push(cfg.imageDataUrl.slice(i, i + QRIS_CHUNK_CHAR_SIZE));
  }

  await Promise.all(
    chunks.map((chunkData, idx) =>
      setServerDoc('server_config', `qris_chunk_${idx}`, {
        docKey: `qris_chunk_${idx}`,
        chunkIndex: idx,
        chunkData,
        updatedAt: nowIso,
      })
    )
  );

  await setServerDoc('server_config', 'qris_config', {
    docKey: 'qris_config',
    hasQris: true,
    imageDataUrl: '',
    fileName: cfg.fileName,
    mimeType: cfg.mimeType,
    fileSize: cfg.fileSize,
    chunkCount: chunks.length,
    updatedBy: cfg.updatedBy || 'admin',
    updatedAt: nowIso,
  });
}

async function loadAuthoritativeQrisConfig(
  forceRefresh = false
): Promise<ServerQrisConfig> {
  const now = Date.now();
  if (
    cachedServerQrisConfig &&
    !forceRefresh &&
    now - lastQrisFirestoreCheckMs < 2000
  ) {
    return cachedServerQrisConfig;
  }

  try {
    const metaDoc = await getServerDoc<{
      docKey: string;
      hasQris?: boolean;
      imageDataUrl?: string;
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
      chunkCount?: number;
      updatedBy?: string;
      updatedAt?: string;
    }>('server_config', 'qris_config');

    if (metaDoc && typeof metaDoc.hasQris === 'boolean') {
      if (!metaDoc.hasQris) {
        const emptyCfg: ServerQrisConfig = {
          hasQris: false,
          imageDataUrl: '',
          fileName: '',
          mimeType: '',
          fileSize: 0,
          updatedBy: String(metaDoc.updatedBy || ''),
          updatedAt: String(metaDoc.updatedAt || ''),
        };
        cachedServerQrisConfig = emptyCfg;
        lastQrisFirestoreCheckMs = now;
        saveQrisConfigToDisk(emptyCfg);
        return emptyCfg;
      }

      if (
        cachedServerQrisConfig &&
        cachedServerQrisConfig.hasQris &&
        cachedServerQrisConfig.imageDataUrl &&
        metaDoc.updatedAt &&
        cachedServerQrisConfig.updatedAt === metaDoc.updatedAt
      ) {
        lastQrisFirestoreCheckMs = now;
        return cachedServerQrisConfig;
      }

      let fullImageDataUrl = String(metaDoc.imageDataUrl || '');
      const chunkCount = Math.max(0, Math.floor(Number(metaDoc.chunkCount || 0)));
      if (!fullImageDataUrl && chunkCount > 0 && chunkCount <= 16) {
        const chunkDocs = await Promise.all(
          Array.from({ length: chunkCount }, (_, idx) =>
            getServerDoc<{ chunkData?: string }>(
              'server_config',
              `qris_chunk_${idx}`
            )
          )
        );
        fullImageDataUrl = chunkDocs
          .map((c) => String(c?.chunkData || ''))
          .join('');
      }

      const hasValidImage = Boolean(
        fullImageDataUrl && fullImageDataUrl.startsWith('data:image/')
      );
      const loadedCfg: ServerQrisConfig = {
        hasQris: hasValidImage,
        imageDataUrl: hasValidImage ? fullImageDataUrl : '',
        fileName: hasValidImage ? String(metaDoc.fileName || 'qris.png') : '',
        mimeType: hasValidImage ? String(metaDoc.mimeType || 'image/png') : '',
        fileSize: hasValidImage ? Number(metaDoc.fileSize || 0) : 0,
        updatedBy: String(metaDoc.updatedBy || ''),
        updatedAt: String(metaDoc.updatedAt || ''),
      };
      cachedServerQrisConfig = loadedCfg;
      lastQrisFirestoreCheckMs = now;
      saveQrisConfigToDisk(loadedCfg);
      return loadedCfg;
    }
  } catch {
    // fallback to disk / memory cache if Firestore is temporarily unreachable
  }

  if (cachedServerQrisConfig) {
    return cachedServerQrisConfig;
  }

  const diskCfg = loadQrisConfigFromDisk();
  if (diskCfg) {
    cachedServerQrisConfig = diskCfg;
    return diskCfg;
  }

  const defaultEmpty: ServerQrisConfig = {
    hasQris: false,
    imageDataUrl: '',
    fileName: '',
    mimeType: '',
    fileSize: 0,
    updatedBy: '',
    updatedAt: '',
  };
  cachedServerQrisConfig = defaultEmpty;
  return defaultEmpty;
}

function hasValidImageMagicBytes(buf: Buffer, mimeType: string): boolean {
  if (buf.length < 12) return false;
  if (mimeType === 'image/png') {
    return (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    );
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return (
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

const handleGetActiveQris = async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const cfg = await loadAuthoritativeQrisConfig(true);
  res.json({
    ok: true,
    qris: {
      hasQris: Boolean(cfg.hasQris && cfg.imageDataUrl),
      imageDataUrl: cfg.hasQris && cfg.imageDataUrl ? cfg.imageDataUrl : null,
      fileName: cfg.fileName || '',
      mimeType: cfg.mimeType || '',
      fileSize: cfg.fileSize || 0,
      updatedBy: cfg.updatedBy || '',
      updatedAt: cfg.updatedAt || null,
    },
  });
};

app.get('/api/qris', handleGetActiveQris);
app.get('/api/game/qris', handleGetActiveQris);
app.get('/api/admin/qris', requireAdminAuth, handleGetActiveQris);

app.post(
  '/api/admin/qris',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    try {
      const token = extractBearerToken(req)!;
      const session =
        activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
      const rawDataUrl = String(req.body?.imageDataUrl || '').trim();
      const rawFileName = String(req.body?.fileName || 'qris-coinova.png').trim();

      if (!rawDataUrl) {
        res.status(400).json({
          ok: false,
          error: 'Silakan pilih file gambar QRIS terlebih dahulu.',
        });
        return;
      }

      const match = /^data:([^;]+);base64,(.+)$/s.exec(rawDataUrl);
      if (!match) {
        res.status(400).json({
          ok: false,
          error:
            'Format gambar QRIS tidak valid. Gunakan file PNG, JPG, JPEG, atau WebP.',
        });
        return;
      }

      const mimeType = match[1].toLowerCase().trim();
      const base64Data = match[2].trim();

      if (!ALLOWED_QRIS_MIMES.has(mimeType)) {
        res.status(400).json({
          ok: false,
          error:
            'Format file tidak didukung. Hanya gambar PNG, JPG, JPEG, atau WebP yang diperbolehkan.',
        });
        return;
      }

      if (rawFileName && !/\.(png|jpe?g|webp)$/i.test(rawFileName)) {
        res.status(400).json({
          ok: false,
          error:
            'Ekstensi file tidak didukung. Gunakan file .png, .jpg, .jpeg, atau .webp.',
        });
        return;
      }

      const binaryBuffer = Buffer.from(base64Data, 'base64');
      if (binaryBuffer.length === 0) {
        res.status(400).json({
          ok: false,
          error: 'File gambar QRIS kosong atau rusak.',
        });
        return;
      }

      if (binaryBuffer.length > QRIS_MAX_BYTES) {
        res.status(400).json({
          ok: false,
          error:
            'Ukuran file QRIS melebihi batas maksimal 5 MB. Gunakan gambar berukuran maksimal 5 MB.',
        });
        return;
      }

      if (!hasValidImageMagicBytes(binaryBuffer, mimeType)) {
        res.status(400).json({
          ok: false,
          error:
            'File yang diunggah bukan gambar PNG, JPG, JPEG, atau WebP yang valid.',
        });
        return;
      }

      const normalizedMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
      const cleanFileName =
        rawFileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) ||
        'qris-coinova.png';
      const nowIso = new Date().toISOString();

      const nextConfig: ServerQrisConfig = {
        hasQris: true,
        imageDataUrl: `data:${normalizedMime};base64,${base64Data}`,
        fileName: cleanFileName,
        mimeType: normalizedMime,
        fileSize: binaryBuffer.length,
        updatedBy: session.username,
        updatedAt: nowIso,
      };

      await persistQrisConfigToFirestore(nextConfig);

      const auditEntry = recordAdminAudit(
        session.username,
        'UPDATE_QRIS',
        'GLOBAL_QRIS',
        cleanFileName,
        `Admin menyimpan gambar QRIS pembayaran baru (${cleanFileName}, ${Math.round(
          binaryBuffer.length / 1024
        )} KB)`
      );
      await setServerDoc(
        'server_admin_audits',
        auditEntry.auditId,
        auditEntry
      ).catch(() => {});

      res.json({
        ok: true,
        message: 'QRIS pembayaran berhasil disimpan dan diaktifkan.',
        qris: {
          hasQris: true,
          imageDataUrl: nextConfig.imageDataUrl,
          fileName: nextConfig.fileName,
          mimeType: nextConfig.mimeType,
          fileSize: nextConfig.fileSize,
          updatedBy: nextConfig.updatedBy,
          updatedAt: nextConfig.updatedAt,
        },
      });
    } catch (err) {
      console.error('[COINOVA-QRIS] Save QRIS error:', err);
      res.status(500).json({
        ok: false,
        error: 'Gagal menyimpan QRIS ke server. Silakan coba lagi.',
      });
    }
  }
);

const handleDeleteActiveQris = async (req: Request, res: Response) => {
  try {
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const nowIso = new Date().toISOString();

    const clearedConfig: ServerQrisConfig = {
      hasQris: false,
      imageDataUrl: '',
      fileName: '',
      mimeType: '',
      fileSize: 0,
      updatedBy: session.username,
      updatedAt: nowIso,
    };

    await persistQrisConfigToFirestore(clearedConfig);

    const auditEntry = recordAdminAudit(
      session.username,
      'DELETE_QRIS',
      'GLOBAL_QRIS',
      'REMOVED',
      'Admin menghapus gambar QRIS pembayaran aktif'
    );
    await setServerDoc(
      'server_admin_audits',
      auditEntry.auditId,
      auditEntry
    ).catch(() => {});

    res.json({
      ok: true,
      message: 'QRIS pembayaran berhasil dihapus.',
      qris: {
        hasQris: false,
        imageDataUrl: null,
        fileName: '',
        mimeType: '',
        fileSize: 0,
        updatedBy: session.username,
        updatedAt: nowIso,
      },
    });
  } catch (err) {
    console.error('[COINOVA-QRIS] Delete QRIS error:', err);
    res.status(500).json({
      ok: false,
      error: 'Gagal menghapus QRIS dari server. Silakan coba lagi.',
    });
  }
};

app.delete('/api/admin/qris', requireAdminAuth, handleDeleteActiveQris);
app.post('/api/admin/qris/delete', requireAdminAuth, handleDeleteActiveQris);

app.get(
  '/api/admin/fraud-review',
  requireAdminAuth,
  (_req: Request, res: Response) => {
    res.json({
      ok: true,
      events: suspiciousTapsLedger.slice(0, 100),
    });
  }
);

app.post(
  '/api/admin/fraud-review/resolve',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const eventId = String(req.body?.eventId || '').trim();
    const status = String(req.body?.status || 'CLEARED') as
      | 'FLAGGED'
      | 'CLEARED'
      | 'SUSPENDED';
    const item = suspiciousTapsLedger.find((e) => e.eventId === eventId);
    if (!item) {
      res.status(404).json({ ok: false, error: 'Event tidak ditemukan.' });
      return;
    }
    item.status = status;
    const auditEntry = recordAdminAudit(
      session.username,
      'FRAUD_REVIEW_RESOLVE',
      item.uid,
      status,
      `Resolved suspicious tap event ${eventId} -> ${status}`
    );
    await Promise.all([
      setServerDoc('server_suspicious_taps', item.eventId, item),
      setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry),
    ]).catch(() => {});
    res.json({ ok: true, event: item });
  }
);

app.get(
  '/api/admin/overview',
  requireAdminAuth,
  async (_req: Request, res: Response) => {
    await ensureFirestoreSeeded(true);
    const serverUsers: any[] = [];
    const serverWallets: any[] = [];
    const serverProfiles: any[] = [];
    const seenUids = new Set<string>();

    userAccountsMap.forEach((acc) => {
      if (acc.uid === 'user_keylaa_pro' || acc.uid === 'user_new_0') return;
      if (isPlaceholderUsername(acc.username)) return;
      seenUids.add(acc.uid);
      const st = getOrSyncServerUserState(acc.uid, {
        username: acc.username,
        dragonLevel: acc.dragonLevel,
      });
      const vipInfo = resolveUserVipState(st);
      const userStatus = st.status || acc.status || 'active';
      const cleanName = !isPlaceholderUsername(st.username)
        ? st.username!
        : acc.username;
      serverUsers.push({
        uid: acc.uid,
        username: cleanName,
        avatarUrl: '',
        referralCode: st.referralCode || acc.referralCode,
        referredByUid: st.referredByUid || acc.referredByUid,
        referredByCode: st.referredByCode || acc.referredByCode || st.boundReferralCode,
        dragonLevel: st.dragonLevel,
        totalTaps: st.totalTaps,
        dailyStreak: st.dailyStreak || 0,
        lastCheckInDate: st.lastCheckInDate || 'none',
        lastConvertDate: st.lastConvertDate,
        dailyConvertedFire: st.dailyConvertedFire,
        cycleProgress: 0,
        dailyClaimsUsed: st.dailyClaimsUsed,
        lastClaimDate: st.lastClaimDate,
        isVip: vipInfo.isVip,
        vipStatus: vipInfo.vipStatus,
        vipStartedAt: vipInfo.vipStartedAt || undefined,
        vipExpiresAt: vipInfo.vipExpiresAt || undefined,
        role: 'player',
        status: userStatus,
        createdAt: acc.createdAt,
        updatedAt: st.updatedAt,
      });
      serverWallets.push({
        uid: acc.uid,
        coinBalance: st.coinBalance,
        fireBalance: st.fireBalance,
        idrBalance: st.coinBalance,
        lockedIdrBalance: st.lockedIdrBalance,
        energy: st.energy,
        maxEnergy: st.maxEnergy,
        totalEarnedCoins: st.coinBalance,
        totalEarnedFire: st.fireBalance,
        totalWithdrawnIdr: st.totalWithdrawnIdr || 0,
        updatedAt: st.updatedAt,
      });
      serverProfiles.push({
        uid: acc.uid,
        fullName: st.fullName || cleanName,
        phone: st.phone || st.ewalletNumber || '',
        defaultEwallet: st.defaultEwallet || 'DANA',
        ewalletNumber: st.ewalletNumber || '',
        ewalletAccountName: st.ewalletAccountName || st.fullName || cleanName,
        pinHash: st.pinHash || '',
        notificationsEnabled: st.notificationsEnabled ?? true,
        updatedAt: st.updatedAt,
      });
    });

    userStateLedger.forEach((st, uid) => {
      if (seenUids.has(uid) || uid === 'user_keylaa_pro' || uid === 'user_new_0') {
        return;
      }
      const matchedAcc = findAccountByUidInMemory(uid);
      if (isPhantomUserRecord(uid, matchedAcc, st)) {
        return;
      }
      seenUids.add(uid);
      const vipInfo = resolveUserVipState(st);
      const displayUsername = !isPlaceholderUsername(st.username)
        ? st.username!
        : 'Belum mengatur nama';
      serverUsers.push({
        uid: st.uid,
        username: displayUsername,
        avatarUrl: '',
        referralCode: st.referralCode || uid.slice(-6).toUpperCase(),
        referredByUid: st.referredByUid,
        referredByCode: st.referredByCode || st.boundReferralCode,
        dragonLevel: st.dragonLevel,
        totalTaps: st.totalTaps,
        dailyStreak: st.dailyStreak || 0,
        lastCheckInDate: st.lastCheckInDate || 'none',
        lastConvertDate: st.lastConvertDate,
        dailyConvertedFire: st.dailyConvertedFire,
        cycleProgress: 0,
        dailyClaimsUsed: st.dailyClaimsUsed,
        lastClaimDate: st.lastClaimDate,
        isVip: vipInfo.isVip,
        vipStatus: vipInfo.vipStatus,
        vipStartedAt: vipInfo.vipStartedAt || undefined,
        vipExpiresAt: vipInfo.vipExpiresAt || undefined,
        role: 'player',
        status: st.status || 'active',
        createdAt: st.updatedAt,
        updatedAt: st.updatedAt,
      });
      serverWallets.push({
        uid: st.uid,
        coinBalance: st.coinBalance,
        fireBalance: st.fireBalance,
        idrBalance: st.coinBalance,
        lockedIdrBalance: st.lockedIdrBalance,
        energy: st.energy,
        maxEnergy: st.maxEnergy,
        totalEarnedCoins: st.coinBalance,
        totalEarnedFire: st.fireBalance,
        totalWithdrawnIdr: st.totalWithdrawnIdr || 0,
        updatedAt: st.updatedAt,
      });
      serverProfiles.push({
        uid: st.uid,
        fullName: st.fullName || displayUsername,
        phone: st.phone || st.ewalletNumber || '',
        defaultEwallet: st.defaultEwallet || 'DANA',
        ewalletNumber: st.ewalletNumber || '',
        ewalletAccountName:
          st.ewalletAccountName || st.fullName || displayUsername,
        pinHash: st.pinHash || '',
        notificationsEnabled: st.notificationsEnabled ?? true,
        updatedAt: st.updatedAt,
      });
    });

    const sortedWithdrawals = Array.from(serverWithdrawalsMap.values()).sort(
      (a, b) => {
        const aPending = a.status === 'PENDING' || a.status === 'PROCESSING' ? 1 : 0;
        const bPending = b.status === 'PENDING' || b.status === 'PROCESSING' ? 1 : 0;
        if (aPending !== bPending) return bPending - aPending;
        const aVip = a.isVipPriority ? 1 : 0;
        const bVip = b.isVipPriority ? 1 : 0;
        if (aPending && aVip !== bVip) return bVip - aVip;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    );

    const sortedUpgradeOrders = Array.from(serverUpgradeOrdersMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const sortedReferrals = Array.from(referralMilestonesMap.values())
      .map((r) => {
        const inviteeSt = userStateLedger.get(r.inviteeUid);
        const inviteeAcc = findAccountByUidInMemory(r.inviteeUid);
        return {
          ...r,
          inviterCode: r.inviterCode || '',
          inviteeUsername:
            r.inviteeUsername ||
            inviteeAcc?.username ||
            inviteeSt?.username ||
            r.inviteeUid,
          rewardCoin: r.rewardCoin ?? (serverEconomicConfig.referralTopupCoinReward || 25000),
          rewardFire: r.rewardFire ?? (serverEconomicConfig.referralActiveFireReward || 2),
          rewardIdr: r.rewardIdr ?? (serverEconomicConfig.referralTopupCoinReward || 25000),
          createdAt: r.createdAt || r.updatedAt,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt || b.updatedAt).getTime() -
          new Date(a.createdAt || a.updatedAt).getTime()
      );

    const sortedCreatorSubmissions = Array.from(
      serverCreatorSubmissionsMap.values()
    ).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const sortedVipOrders = Array.from(vipOrdersMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const normalizedWithdrawals = sortedWithdrawals.map((w) => {
      const matchedAcc = findAccountByUidInMemory(w.uid);
      const matchedSt = userStateLedger.get(w.uid);
      const resolvedUsername =
        (!isPlaceholderUsername(w.username) ? w.username : undefined) ||
        matchedAcc?.username ||
        (!isPlaceholderUsername(matchedSt?.username)
          ? matchedSt?.username
          : undefined) ||
        w.accountName ||
        w.uid;
      return {
        ...w,
        username: resolvedUsername,
        id: w.withdrawalId,
        withdrawalId: w.withdrawalId,
      };
    });

    const totalUsers = serverUsers.length;
    const activeUsers = serverUsers.filter((u) => u.status !== 'suspended').length;
    const suspendedUsers = serverUsers.filter((u) => u.status === 'suspended').length;
    const totalWithdrawals = normalizedWithdrawals.length;
    const pendingWithdrawals = normalizedWithdrawals.filter(
      (w) => w.status === 'PENDING' || w.status === 'PROCESSING'
    ).length;
    const totalTransactions = serverTransactionsLedger.length;
    const totalCoins = serverWallets.reduce(
      (acc, w) => acc + (Number(w.coinBalance) || 0),
      0
    );
    const totalDiamonds = serverWallets.reduce(
      (acc, w) => acc + (Number(w.fireBalance) || 0),
      0
    );

    const overviewStats = {
      totalUsers,
      activeUsers,
      suspendedUsers,
      totalWithdrawals,
      pendingWithdrawals,
      totalTransactions,
      totalCoins,
      totalDiamonds,
    };

    const sortedPromoCodes = Array.from(promoCodesMap.values()).sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime()
    );
    const sortedPromoClaims = Array.from(promoClaimsMap.values()).sort(
      (a, b) =>
        new Date(b.claimedAt || 0).getTime() -
        new Date(a.claimedAt || 0).getTime()
    );
    const syncedRewardCodes = sortedPromoCodes.map((pc) => ({
      code: pc.code,
      description: pc.description || `Kode Redeem ${pc.code}`,
      coinReward: Number(pc.coinReward || 0),
      fireReward: Number(pc.fireReward || 0),
      idrReward: Number(pc.coinReward || 0),
      maxClaims: Number(pc.quota || pc.maxClaims || 100),
      claimedCount: Number(pc.claimedCount || 0),
      expiresAt: pc.expiresAt || undefined,
      isActive: Boolean(pc.isActive),
      updatedAt: pc.updatedAt || pc.createdAt || new Date().toISOString(),
    }));

    res.json({
      ok: true,
      resetVersion: SERVER_REALM_MARKER,
      ...overviewStats,
      overview: overviewStats,
      users: serverUsers,
      wallets: serverWallets,
      profiles: serverProfiles,
      withdrawals: normalizedWithdrawals,
      recentWithdrawals: normalizedWithdrawals,
      upgradeOrders: sortedUpgradeOrders,
      referrals: sortedReferrals,
      creatorSubmissions: sortedCreatorSubmissions,
      vipOrders: sortedVipOrders,
      promoCodes: sortedPromoCodes,
      promoClaims: sortedPromoClaims,
      rewardCodes: syncedRewardCodes,
      transactions: serverTransactionsLedger.slice(0, 300),
      recentTransactions: serverTransactionsLedger.slice(0, 300),
      economicConfig: serverEconomicConfig,
      auditLogs: adminAuditLogsLedger.slice(0, 200).map((a) => ({
        id: a.auditId,
        adminUid: a.adminId,
        adminEmail: a.adminId,
        action: a.action,
        targetUid: a.targetUser,
        details: `${a.details} (${a.amountOrStatus})`,
        createdAt: a.timestamp,
      })),
    });
  }
);

const handleAdminWithdrawalAction = async (req: Request, res: Response) => {
  await ensureFirestoreSeeded();
  const token = extractBearerToken(req)!;
  const session =
    activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
  const withdrawalId = String(req.body?.withdrawalId || req.body?.id || '').trim();
  const nextStatus = String(
    req.body?.nextStatus || req.body?.status || ''
  ).trim() as 'PROCESSING' | 'PAID' | 'REJECTED';
  const paymentReference = String(req.body?.paymentReference || '').trim();
  const adminNote = String(req.body?.adminNote || '').trim();

  if (
    !withdrawalId ||
    !['PROCESSING', 'PAID', 'REJECTED'].includes(nextStatus)
  ) {
    res.status(400).json({
      ok: false,
      error: 'Parameter verifikasi withdrawal tidak valid.',
    });
    return;
  }

    if (inFlightAdminWithdrawLocks.has(withdrawalId)) {
      res.status(409).json({
        ok: false,
        error: 'Penarikan ini sedang diproses. Mohon tunggu sebentar.',
      });
      return;
    }

    inFlightAdminWithdrawLocks.add(withdrawalId);
    try {
      let wdRecord = serverWithdrawalsMap.get(withdrawalId);
      if (!wdRecord) {
        const remoteWd = await getServerDoc<ServerWithdrawalRecord>(
          'server_withdrawals',
          withdrawalId
        ).catch(() => null);
        if (remoteWd && remoteWd.withdrawalId) {
          wdRecord = remoteWd;
          serverWithdrawalsMap.set(withdrawalId, wdRecord);
        }
      }

      if (!wdRecord) {
        res.status(404).json({
          ok: false,
          error: 'Data penarikan tidak ditemukan di server.',
        });
        return;
      }

      if (wdRecord.status === 'PAID' || wdRecord.status === 'REJECTED') {
        res.status(409).json({
          ok: false,
          error: `Penarikan ini sudah selesai diproses sebelumnya (${wdRecord.status}).`,
        });
        return;
      }

      const nowIso = new Date().toISOString();
      const userState = await loadAndSyncServerUserStateFromFirestore(
        wdRecord.uid
      );
      const writes: Promise<void>[] = [];

      wdRecord.status = nextStatus;
      if (paymentReference) {
        wdRecord.paymentReference = paymentReference;
      }
      if (adminNote) {
        wdRecord.adminNote = adminNote;
      }
      wdRecord.updatedAt = nowIso;
      serverWithdrawalsMap.set(withdrawalId, wdRecord);
      writes.push(setServerDoc('server_withdrawals', withdrawalId, wdRecord));

      if (nextStatus === 'PAID') {
        userState.lockedIdrBalance = Math.max(
          0,
          userState.lockedIdrBalance - wdRecord.amount
        );
        userState.totalWithdrawnIdr = Math.max(
          0,
          (userState.totalWithdrawnIdr || 0) + wdRecord.amount
        );
        userState.updatedAt = nowIso;
        userStateLedger.set(userState.uid, userState);
        writes.push(persistUserStateToFirestore(userState));

        const txEntry = recordLedgerTransaction({
          uid: wdRecord.uid,
          category: 'WITHDRAWAL',
          direction: 'DEBIT',
          currency: 'COIN',
          amount: wdRecord.amount,
          description: `Penarikan E-Wallet ${wdRecord.method} (${wdRecord.accountNumber}) Berhasil Dicairkan (PAID) — Ref: ${paymentReference || '-'}`,
          referenceId: withdrawalId,
        });
        writes.push(setServerDoc('server_transactions', txEntry.id, txEntry));

        const notif = pushServerNotification(
          wdRecord.uid,
          '✅ Penarikan Berhasil Dicairkan (PAID)',
          `Penarikan ${wdRecord.amount.toLocaleString('id-ID')} Koin ke ${wdRecord.method} (${wdRecord.accountNumber}) telah berhasil dikirim. Ref: ${paymentReference || '-'}.`,
          'SUCCESS',
          'WITHDRAWAL'
        );
        writes.push(setServerDoc('server_notifications', notif.id, notif));
      } else if (nextStatus === 'REJECTED') {
        const refundCoins = wdRecord.coinDeducted || wdRecord.amount;
        const refundFire = wdRecord.fireDeducted || 0;
        userState.lockedIdrBalance = Math.max(
          0,
          userState.lockedIdrBalance - wdRecord.amount
        );
        userState.coinBalance = Math.max(
          0,
          userState.coinBalance + refundCoins
        );
        userState.fireBalance = Math.max(0, userState.fireBalance + refundFire);
        userState.updatedAt = nowIso;
        userStateLedger.set(userState.uid, userState);
        writes.push(persistUserStateToFirestore(userState));

        const txEntry = recordLedgerTransaction({
          uid: wdRecord.uid,
          category: 'WITHDRAWAL',
          direction: 'REFUND',
          currency: 'COIN',
          amount: refundCoins,
          description: `Pengembalian Saldo Penarikan Ditolak (+${refundCoins.toLocaleString('id-ID')} Koin & +${refundFire} Diamond): ${adminNote || 'Ditolak Admin'}`,
          referenceId: withdrawalId,
        });
        writes.push(setServerDoc('server_transactions', txEntry.id, txEntry));

        const notif = pushServerNotification(
          wdRecord.uid,
          '⚠️ Penarikan Ditolak & Saldo Dikembalikan',
          `Penarikan ${wdRecord.amount.toLocaleString('id-ID')} Koin ke ${wdRecord.method} ditolak (${adminNote || 'Data belum sesuai'}). Saldo +${refundCoins.toLocaleString('id-ID')} Koin & +${refundFire} Diamond telah dikembalikan ke akun Anda.`,
          'WARNING',
          'WITHDRAWAL'
        );
        writes.push(setServerDoc('server_notifications', notif.id, notif));
      } else if (nextStatus === 'PROCESSING') {
        const notif = pushServerNotification(
          wdRecord.uid,
          '⏳ Penarikan Sedang Diproses',
          `Penarikan ${wdRecord.amount.toLocaleString('id-ID')} Koin ke ${wdRecord.method} (${wdRecord.accountNumber}) sedang dalam proses pencairan oleh Admin.`,
          'INFO',
          'WITHDRAWAL'
        );
        writes.push(setServerDoc('server_notifications', notif.id, notif));
      }

      const auditEntry = recordAdminAudit(
        session.username,
        `WITHDRAWAL_${nextStatus}`,
        wdRecord.uid,
        `${wdRecord.amount.toLocaleString('id-ID')} Koin (${nextStatus})`,
        `Processed withdrawal ${withdrawalId} (${wdRecord.method} ${wdRecord.accountNumber}) -> ${nextStatus}`
      );
      writes.push(
        setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry)
      );

      await Promise.all(writes).catch(() => {});

      res.json({
        ok: true,
        withdrawal: {
          ...wdRecord,
          id: wdRecord.withdrawalId,
        },
        coinBalance: userState.coinBalance,
        fireBalance: userState.fireBalance,
        lockedIdrBalance: userState.lockedIdrBalance,
      });
    } finally {
      inFlightAdminWithdrawLocks.delete(withdrawalId);
    }
};

app.post('/api/admin/withdrawals/action', requireAdminAuth, handleAdminWithdrawalAction);
app.post('/api/admin/withdrawal/process', requireAdminAuth, handleAdminWithdrawalAction);

app.post(
  '/api/admin/user/toggle-status',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const targetUid = String(req.body?.targetUid || '').trim();
    const nextStatus = String(req.body?.status || 'active').trim() as
      | 'active'
      | 'suspended';

    if (!targetUid || !['active', 'suspended'].includes(nextStatus)) {
      res.status(400).json({ ok: false, error: 'Parameter status user tidak valid.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const st = await loadAndSyncServerUserStateFromFirestore(targetUid);
    st.status = nextStatus;
    st.updatedAt = nowIso;
    userStateLedger.set(targetUid, st);

    const writes: Promise<void>[] = [persistUserStateToFirestore(st)];
    const acc = await loadUserAccountByUidFromFirestore(targetUid);
    if (acc) {
      acc.status = nextStatus;
      acc.updatedAt = nowIso;
      writes.push(persistUserAccountToFirestore(acc));
    }

    const auditEntry = recordAdminAudit(
      session.username,
      nextStatus === 'suspended' ? 'SUSPEND_USER' : 'ACTIVATE_USER',
      targetUid,
      nextStatus.toUpperCase(),
      `Status akun ${targetUid} diubah menjadi ${nextStatus.toUpperCase()}`
    );
    writes.push(setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry));
    await Promise.all(writes).catch(() => {});

    res.json({
      ok: true,
      uid: targetUid,
      status: nextStatus,
    });
  }
);

app.post(
  '/api/admin/user/adjust-balance',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const targetUid = String(req.body?.targetUid || req.body?.uid || '').trim();
    const currency = String(req.body?.currency || 'COIN').trim();
    let delta = Math.floor(Number(req.body?.delta || 0));
    if (!delta && req.body?.amount !== undefined) {
      const amt = Math.floor(Number(req.body.amount || 0));
      const mode = String(req.body?.mode || 'ADD').toUpperCase();
      delta = mode === 'SUB' || mode === 'SUBTRACT' ? -Math.abs(amt) : Math.abs(amt);
    }
    const reason = String(req.body?.reason || 'Penyesuaian Saldo Admin').trim();

    if (!targetUid || !delta) {
      res.status(400).json({ ok: false, error: 'Data penyesuaian saldo tidak valid.' });
      return;
    }

    const st = await loadAndSyncServerUserStateFromFirestore(targetUid);
    if (currency === 'FIRE') {
      st.fireBalance = Math.max(0, st.fireBalance + delta);
    } else {
      st.coinBalance = Math.max(0, st.coinBalance + delta);
    }
    st.updatedAt = new Date().toISOString();
    userStateLedger.set(targetUid, st);

    const txEntry = recordLedgerTransaction({
      uid: targetUid,
      category: 'ADMIN_ADJUST',
      direction: delta >= 0 ? 'CREDIT' : 'DEBIT',
      currency: currency === 'FIRE' ? 'FIRE' : 'COIN',
      amount: Math.abs(delta),
      description: `${reason} (${delta >= 0 ? '+' : ''}${delta.toLocaleString('id-ID')} ${currency === 'FIRE' ? 'Diamond' : 'Koin'})`,
      referenceId: `adm_adj_${Date.now()}`,
    });

    const auditEntry = recordAdminAudit(
      session.username,
      'WALLET_ADJUSTMENT',
      targetUid,
      `${delta >= 0 ? '+' : ''}${delta} ${currency === 'FIRE' ? 'Diamond' : 'Koin'}`,
      reason
    );
    await Promise.all([
      persistUserStateToFirestore(st),
      setServerDoc('server_transactions', txEntry.id, txEntry),
      setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry),
    ]).catch(() => {});

    res.json({
      ok: true,
      uid: targetUid,
      coinBalance: st.coinBalance,
      fireBalance: st.fireBalance,
    });
  }
);

// ============================================================================
// ADMIN-ONLY REFERRAL MILESTONE & UPGRADE REFERRAL REWARD ENDPOINT
// ============================================================================
app.post(
  '/api/admin/referral/process',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const referralId = String(req.body?.referralId || '').trim();
    const inviterUid = String(req.body?.inviterUid || '').trim();
    const inviteeUid = String(req.body?.inviteeUid || '').trim();
    const targetMilestone = String(req.body?.milestone || '').trim() as
      | 'ACTIVE'
      | 'VERIFIED'
      | 'UPGRADE'
      | 'REJECTED';

    if (!referralId || !inviterUid) {
      res.status(400).json({ ok: false, error: 'Data referral tidak lengkap.' });
      return;
    }

    if (
      !['ACTIVE', 'VERIFIED', 'UPGRADE', 'REJECTED'].includes(targetMilestone)
    ) {
      res
        .status(400)
        .json({ ok: false, error: 'Status milestone referral tidak valid.' });
      return;
    }

    if (inviterUid === inviteeUid) {
      res.status(400).json({
        ok: false,
        error: 'Self-referral terdeteksi dan ditolak oleh sistem.',
      });
      return;
    }

    const remoteRef = await getServerDoc<ReferralMilestoneState>(
      'server_referrals',
      referralId
    ).catch(() => null);
    const existing: ReferralMilestoneState =
      remoteRef ||
      referralMilestonesMap.get(referralId) || {
        referralId,
        inviterUid,
        inviteeUid,
        status: 'PENDING',
        activeRewardClaimed: false,
        topupRewardClaimed: false,
        upgradeRewardClaimed: false,
        updatedAt: new Date().toISOString(),
      };

    let awardedCoins = 0;
    let awardedFire = 0;
    let ledgerCategory = 'REFERRAL';

    if (targetMilestone === 'REJECTED') {
      existing.status = 'REJECTED';
    } else if (targetMilestone === 'ACTIVE') {
      if (existing.activeRewardClaimed) {
        res.status(409).json({
          ok: false,
          error:
            'Milestone Teman Aktif (Diamond) sudah pernah diberikan sebelumnya.',
        });
        return;
      }
      awardedCoins = 0;
      awardedFire = serverEconomicConfig.referralActiveFireReward;
      existing.activeRewardClaimed = true;
      if (existing.status !== 'VERIFIED') {
        existing.status = 'ACTIVE';
      }
      ledgerCategory = 'REFERRAL_ACTIVE';
    } else if (targetMilestone === 'VERIFIED') {
      if (existing.topupRewardClaimed) {
        res.status(409).json({
          ok: false,
          error:
            'Milestone Top-Up Referral (Koin + Diamond) sudah pernah diberikan sebelumnya.',
        });
        return;
      }
      awardedCoins = serverEconomicConfig.referralTopupCoinReward;
      awardedFire = existing.activeRewardClaimed
        ? serverEconomicConfig.referralTopupFireReward
        : serverEconomicConfig.referralActiveFireReward +
          serverEconomicConfig.referralTopupFireReward;
      existing.activeRewardClaimed = true;
      existing.topupRewardClaimed = true;
      existing.status = 'VERIFIED';
      ledgerCategory = 'REFERRAL_TOPUP';
    } else if (targetMilestone === 'UPGRADE') {
      if (existing.upgradeRewardClaimed) {
        res.status(409).json({
          ok: false,
          error:
            'Reward Referral Upgrade Level untuk teman ini sudah pernah diberikan.',
        });
        return;
      }
      awardedCoins = serverEconomicConfig.referralUpgradeCoinReward;
      awardedFire = serverEconomicConfig.referralUpgradeFireReward;
      existing.activeRewardClaimed = true;
      existing.topupRewardClaimed = true;
      existing.upgradeRewardClaimed = true;
      existing.status = 'VERIFIED';
      ledgerCategory = 'REFERRAL_UPGRADE';
    }

    existing.updatedAt = new Date().toISOString();
    referralMilestonesMap.set(referralId, existing);

    const inviterState = await loadAndSyncServerUserStateFromFirestore(inviterUid);
    inviterState.coinBalance = Math.max(
      0,
      inviterState.coinBalance + awardedCoins
    );
    inviterState.fireBalance = Math.max(
      0,
      inviterState.fireBalance + awardedFire
    );
    inviterState.updatedAt = existing.updatedAt;
    userStateLedger.set(inviterUid, inviterState);

    const writes: Promise<void>[] = [
      setServerDoc('server_referrals', referralId, existing),
      persistUserStateToFirestore(inviterState),
    ];

    if (awardedCoins > 0 || awardedFire > 0) {
      const txEntry = recordLedgerTransaction({
        uid: inviterUid,
        category: ledgerCategory,
        direction: 'CREDIT',
        currency: awardedCoins > 0 ? 'COIN' : 'FIRE',
        amount: awardedCoins > 0 ? awardedCoins : awardedFire,
        description: `${ledgerCategory} (${inviteeUid}): +${awardedCoins.toLocaleString('id-ID')} Koin & +${awardedFire} Diamond`,
        referenceId: referralId,
      });
      writes.push(setServerDoc('server_transactions', txEntry.id, txEntry));
    }

    const auditEntry = recordAdminAudit(
      session.username,
      `REFERRAL_${targetMilestone}`,
      inviterUid,
      `+${awardedCoins} Koin / +${awardedFire} Diamond`,
      `Processed referral ${referralId} (${inviteeUid}) -> ${targetMilestone}`
    );
    writes.push(setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry));
    await Promise.all(writes).catch(() => {});

    res.json({
      ok: true,
      referralId,
      status: existing.status,
      activeRewardClaimed: existing.activeRewardClaimed,
      topupRewardClaimed: existing.topupRewardClaimed,
      upgradeRewardClaimed: Boolean(existing.upgradeRewardClaimed),
      awardedCoins,
      awardedFire,
      awardedIdr: awardedCoins,
      updatedAt: existing.updatedAt,
    });
  }
);

// ============================================================================
// ADMIN UPGRADE ORDER REVIEW + AUTOMATIC REFERRAL UPGRADE REWARD
// ============================================================================
const handleAdminUpgradeVerify = async (req: Request, res: Response) => {
  const token = extractBearerToken(req)!;
  const session =
    activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
  const orderId = String(req.body?.orderId || '').trim();
  const uid = String(req.body?.uid || '').trim();
  const targetLevel = Math.max(
    2,
    Math.min(5, Math.floor(Number(req.body?.targetLevel || 2)))
  );
  const nextStatus = String(
    req.body?.nextStatus || req.body?.status || ''
  ).trim() as 'PAID' | 'REJECTED';
  const inviterUid = String(req.body?.inviterUid || '').trim();
  const referralId = String(req.body?.referralId || '').trim();

  if (!orderId || !uid || !['PAID', 'REJECTED'].includes(nextStatus)) {
    res
      .status(400)
      .json({ ok: false, error: 'Data review order upgrade tidak valid.' });
    return;
  }

  const nowIso = new Date().toISOString();
  let referralBonusAwarded = false;
  let referralAwardedCoins = 0;
  let referralAwardedFire = 0;
  const writes: Promise<void>[] = [];

  const existingOrd = serverUpgradeOrdersMap.get(orderId);
  if (existingOrd && (existingOrd.status === 'PAID' || existingOrd.status === 'REJECTED')) {
    res.status(409).json({
      ok: false,
      error: `Order upgrade ini sudah diproses sebelumnya (${existingOrd.status}).`,
    });
    return;
  }

  const userState = await loadAndSyncServerUserStateFromFirestore(uid);
  const LEVEL_DAILY_FIRE_BONUS: Record<number, number> = {
    2: 3,
    3: 8,
    4: 60,
    5: 150,
  };

  if (existingOrd) {
    existingOrd.status = nextStatus;
    existingOrd.adminNote =
      String(req.body?.adminNote || '').trim() ||
      (nextStatus === 'PAID'
        ? `Pembayaran diverifikasi Admin. Level ${targetLevel} aktif.`
        : 'Bukti pembayaran ditolak oleh Admin.');
    existingOrd.updatedAt = nowIso;
    serverUpgradeOrdersMap.set(orderId, existingOrd);
    writes.push(setServerDoc('server_upgrade_orders', orderId, existingOrd));
  }

  if (nextStatus === 'PAID') {
    const levelFireBonus = LEVEL_DAILY_FIRE_BONUS[targetLevel] || 0;
    if (targetLevel > userState.dragonLevel) {
      userState.dragonLevel = targetLevel;
      userState.maxEnergy = LEVEL_MAX_ENERGY[targetLevel] || userState.maxEnergy;
      userState.energy = userState.maxEnergy;
    }
    if (levelFireBonus > 0) {
      userState.fireBalance = Math.max(0, userState.fireBalance + levelFireBonus);
    }
    userState.updatedAt = nowIso;
    userStateLedger.set(uid, userState);
    writes.push(persistUserStateToFirestore(userState));

    // Update account record if present
    const accByUid = await loadUserAccountByUidFromFirestore(uid);
    if (accByUid && targetLevel > accByUid.dragonLevel) {
      accByUid.dragonLevel = targetLevel;
      accByUid.updatedAt = nowIso;
      writes.push(persistUserAccountToFirestore(accByUid));
    }

    const effectiveInviterUid =
      inviterUid || userState.referredByUid || accByUid?.referredByUid || '';

    // D. TEMAN MELAKUKAN UPGRADE LEVEL -> Inviter gets KOIN + DIAMOND once per orderId
    if (
      effectiveInviterUid &&
      effectiveInviterUid !== uid &&
      !processedUpgradeReferralOrdersSet.has(orderId)
    ) {
      processedUpgradeReferralOrdersSet.add(orderId);
      referralAwardedCoins = serverEconomicConfig.referralUpgradeCoinReward;
      referralAwardedFire = serverEconomicConfig.referralUpgradeFireReward;
      referralBonusAwarded = true;

      const inviterState = await loadAndSyncServerUserStateFromFirestore(
        effectiveInviterUid
      );
      inviterState.coinBalance = Math.max(
        0,
        inviterState.coinBalance + referralAwardedCoins
      );
      inviterState.fireBalance = Math.max(
        0,
        inviterState.fireBalance + referralAwardedFire
      );
      inviterState.updatedAt = nowIso;
      userStateLedger.set(effectiveInviterUid, inviterState);
      writes.push(persistUserStateToFirestore(inviterState));

      const txEntry = recordLedgerTransaction({
        uid: effectiveInviterUid,
        category: 'REFERRAL_UPGRADE',
        direction: 'CREDIT',
        currency: 'COIN',
        amount: referralAwardedCoins,
        description: `REFERRAL_UPGRADE (${userState.username || uid} -> Lv.${targetLevel}): +${referralAwardedCoins.toLocaleString('id-ID')} Koin & +${referralAwardedFire} Diamond`,
        referenceId: orderId,
      });
      writes.push(setServerDoc('server_transactions', txEntry.id, txEntry));

      const resolvedRefId = referralId || `ref_${effectiveInviterUid}_${uid}`;
      const refMilestone: ReferralMilestoneState =
        referralMilestonesMap.get(resolvedRefId) || {
          referralId: resolvedRefId,
          inviterUid: effectiveInviterUid,
          inviteeUid: uid,
          inviteeUsername: userState.username || uid,
          status: 'VERIFIED',
          activeRewardClaimed: true,
          topupRewardClaimed: true,
          upgradeRewardClaimed: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
      refMilestone.status = 'VERIFIED';
      refMilestone.activeRewardClaimed = true;
      refMilestone.topupRewardClaimed = true;
      refMilestone.upgradeRewardClaimed = true;
      refMilestone.updatedAt = nowIso;
      referralMilestonesMap.set(resolvedRefId, refMilestone);
      writes.push(setServerDoc('server_referrals', resolvedRefId, refMilestone));
    }
  }

  const auditEntry = recordAdminAudit(
    session.username,
    `UPGRADE_ORDER_${nextStatus}`,
    uid,
    `Lv.${targetLevel} (${nextStatus})`,
    `Reviewed upgrade order ${orderId} -> ${nextStatus}`
  );
  writes.push(setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry));
  await Promise.all(writes).catch(() => {});

  res.json({
    ok: true,
    orderId,
    nextStatus,
    referralBonusAwarded,
    referralRewardGranted: referralBonusAwarded,
    referralAwardedCoins,
    referralAwardedFire,
    inviterUid,
    updatedAt: nowIso,
  });
};

app.post('/api/admin/upgrade-order/review', requireAdminAuth, handleAdminUpgradeVerify);
app.post('/api/admin/upgrade/verify', requireAdminAuth, handleAdminUpgradeVerify);

app.get(
  '/api/admin/bug-reports',
  requireAdminAuth,
  async (_req: Request, res: Response) => {
    try {
      const remoteBugs = await listServerDocs<BugReportRecord>(
        'server_bug_reports',
        50
      );
      if (remoteBugs.length > 0) {
        res.json({ ok: true, reports: remoteBugs });
        return;
      }
    } catch {
      // fallback to memory
    }
    res.json({
      ok: true,
      reports: bugReportsLedger.slice(0, 50),
    });
  }
);

// ============================================================================
// AUTHORITATIVE USER STATE SYNC ENDPOINTS (ANTI-REFRESH BYPASS)
// ============================================================================
app.post('/api/game/sync-state', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  if (!uid) {
    res.status(400).json({ ok: false, error: 'UID tidak valid.' });
    return;
  }

  // Read authoritative state from server/Firestore without allowing client payload to overwrite balances
  const state = await loadAndSyncServerUserStateFromFirestore(
    uid,
    undefined,
    true
  );

  const vipInfo = resolveUserVipState(state);
  res.json({
    ok: true,
    state: {
      ...state,
      isVip: vipInfo.isVip,
      vipStatus: vipInfo.vipStatus,
      vipStartedAt: vipInfo.vipStartedAt,
      vipExpiresAt: vipInfo.vipExpiresAt,
      idrBalance: state.coinBalance,
      rewardPerTap: getRewardPerTapForLevel(state.dragonLevel),
    },
  });
});

const handleGetGameState = async (req: Request, res: Response) => {
  await ensureFirestoreSeeded();
  const uid = String(req.params.uid || req.query.uid || '').trim();
  if (!uid || uid === 'user_new_0') {
    res.status(400).json({ ok: false, error: 'UID tidak valid.' });
    return;
  }
  // Read-only state lookup: never create a phantom database user for unknown UIDs and never overwrite level from query
  let state: ServerUserState;
  try {
    state = await loadAndSyncServerUserStateFromFirestore(
      uid,
      undefined,
      true
    );
  } catch (error) {
    console.error('[COINOVA-STATE] Authoritative state read failed:', error instanceof Error ? error.message : String(error));
    res.status(503).json({
      ok: false,
      code: 'USER_STATE_UNAVAILABLE',
      error: 'Data akun belum dapat dibaca dari server. Saldo tidak direset.',
    });
    return;
  }
  const matchedAcc = findAccountByUidInMemory(uid);
  const resolvedUsername =
    (!isPlaceholderUsername(state.username) ? state.username : undefined) ||
    matchedAcc?.username ||
    '';
  const resolvedReferralCode =
    state.referralCode ||
    matchedAcc?.referralCode ||
    uid.slice(-6).toUpperCase();
  const vipInfo = resolveUserVipState(state);

  const userWithdrawals = Array.from(serverWithdrawalsMap.values())
    .filter((w) => w.uid === uid)
    .map((w) => ({
      ...w,
      username: resolvedUsername || w.username || w.accountName || uid,
      id: w.withdrawalId,
      withdrawalId: w.withdrawalId,
    }))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  const userUpgradeOrders = Array.from(serverUpgradeOrdersMap.values())
    .filter((o) => o.uid === uid)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  const userTransactions = serverTransactionsLedger
    .filter((t) => t.uid === uid)
    .slice(0, 100);

  const userReferrals = Array.from(referralMilestonesMap.values())
    .filter((r) => r.inviterUid === uid || r.inviteeUid === uid)
    .map((r) => {
      const inviteeSt = userStateLedger.get(r.inviteeUid);
      const inviteeAcc = findAccountByUidInMemory(r.inviteeUid);
      return {
        ...r,
        inviterCode: r.inviterCode || '',
        inviteeUsername:
          r.inviteeUsername ||
          inviteeAcc?.username ||
          inviteeSt?.username ||
          r.inviteeUid,
        rewardCoin:
          r.rewardCoin ?? (serverEconomicConfig.referralTopupCoinReward || 25000),
        rewardFire:
          r.rewardFire ?? (serverEconomicConfig.referralActiveFireReward || 2),
        rewardIdr:
          r.rewardIdr ?? (serverEconomicConfig.referralTopupCoinReward || 25000),
        createdAt: r.createdAt || r.updatedAt,
      };
    });

  const userCreatorSubmissions = Array.from(
    serverCreatorSubmissionsMap.values()
  ).filter((s) => s.uid === uid);

  const syncedRewardCodes = Array.from(promoCodesMap.values()).map((pc) => ({
    code: pc.code,
    description: pc.description || `Kode Redeem ${pc.code}`,
    coinReward: Number(pc.coinReward || 0),
    fireReward: Number(pc.fireReward || 0),
    idrReward: Number(pc.coinReward || 0),
    maxClaims: Number(pc.quota || 100),
    claimedCount: Number(pc.claimedCount || 0),
    expiresAt: pc.expiresAt || undefined,
    isActive: Boolean(pc.isActive),
    updatedAt: pc.updatedAt || new Date().toISOString(),
  }));

  res.json({
    ok: true,
    resetVersion: SERVER_REALM_MARKER,
    energy: state.energy,
    maxEnergy: state.maxEnergy,
    coinBalance: state.coinBalance,
    fireBalance: state.fireBalance,
    lockedIdrBalance: state.lockedIdrBalance,
    dragonLevel: state.dragonLevel,
    dailyClaimsUsed: state.dailyClaimsUsed,
    dailyStreak: state.dailyStreak || 0,
    lastCheckInDate: state.lastCheckInDate || 'none',
    status: state.status || matchedAcc?.status || 'active',
    isVip: vipInfo.isVip,
    vipStatus: vipInfo.vipStatus,
    vipStartedAt: vipInfo.vipStartedAt,
    vipExpiresAt: vipInfo.vipExpiresAt,
    rewardPerTap: getRewardPerTapForLevel(state.dragonLevel),
    withdrawals: userWithdrawals,
    upgradeOrders: userUpgradeOrders,
    transactions: userTransactions,
    referrals: userReferrals,
    creatorSubmissions: userCreatorSubmissions,
    rewardCodes: syncedRewardCodes,
    economicConfig: serverEconomicConfig,
    settings: serverEconomicConfig,
    user: {
      uid: state.uid,
      username: resolvedUsername || state.username || '',
      referralCode: resolvedReferralCode,
      referredByUid: state.referredByUid || matchedAcc?.referredByUid,
      referredByCode:
        state.referredByCode ||
        matchedAcc?.referredByCode ||
        state.boundReferralCode,
      dragonLevel: state.dragonLevel,
      totalTaps: state.totalTaps || 0,
      status: state.status || matchedAcc?.status || 'active',
      dailyStreak: state.dailyStreak || 0,
      lastCheckInDate: state.lastCheckInDate || 'none',
      lastConvertDate: state.lastConvertDate || 'none',
      dailyConvertedFire: state.dailyConvertedFire || 0,
      dailyClaimsUsed: state.dailyClaimsUsed,
      lastClaimDate: state.lastClaimDate || getServerTodayKey(),
      isVip: vipInfo.isVip,
      vipStatus: vipInfo.vipStatus,
      vipStartedAt: vipInfo.vipStartedAt,
      vipExpiresAt: vipInfo.vipExpiresAt,
    },
    wallet: {
      uid: state.uid,
      coinBalance: state.coinBalance,
      fireBalance: state.fireBalance,
      idrBalance: state.coinBalance,
      lockedIdrBalance: state.lockedIdrBalance,
      totalWithdrawnIdr: state.totalWithdrawnIdr || 0,
      energy: state.energy,
      maxEnergy: state.maxEnergy,
    },
    profile: {
      uid: state.uid,
      fullName: state.fullName || resolvedUsername || '',
      phone: state.phone || state.ewalletNumber || '',
      defaultEwallet: state.defaultEwallet || 'DANA',
      ewalletNumber: state.ewalletNumber || '',
      ewalletAccountName:
        state.ewalletAccountName || state.fullName || resolvedUsername || '',
      pinHash: state.pinHash || '',
      notificationsEnabled: state.notificationsEnabled ?? true,
      updatedAt: state.updatedAt,
    },
    state: {
      ...state,
      username: resolvedUsername || state.username,
      isVip: vipInfo.isVip,
      vipStatus: vipInfo.vipStatus,
      vipStartedAt: vipInfo.vipStartedAt,
      vipExpiresAt: vipInfo.vipExpiresAt,
      idrBalance: state.coinBalance,
      rewardPerTap: getRewardPerTapForLevel(state.dragonLevel),
    },
  });
};

app.get('/api/game/state', handleGetGameState);
app.get('/api/game/state/:uid', handleGetGameState);

// ============================================================================
// 5 & 6. SERVER-SIDE TAP REWARD & CORE ENERGY ENGINE (SINGLE SOURCE OF TRUTH)
// ============================================================================
app.post('/api/game/tap', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  const tapId = String(req.body?.tapId || req.body?.nonce || '').trim();
  const clientTimestamp = Number(req.body?.clientTimestamp || Date.now());
  const requestedTapCount = Math.max(
    1,
    Math.min(50, Math.floor(Number(req.body?.tapCount) || 1))
  );

  if (!uid || !tapId) {
    res.status(400).json({
      ok: false,
      allowed: false,
      error: 'Sesi atau identitas request tap tidak valid.',
    });
    return;
  }

  const nowMs = Date.now();

  // 1. Anti-replay timestamp validation (reject requests older than 60s or from future)
  if (Math.abs(nowMs - clientTimestamp) > 60000) {
    recordSuspiciousTap(
      uid,
      'Timestamp request di luar batas wajar (Anti-Replay)',
      Math.abs(nowMs - clientTimestamp),
      tapId
    );
    res.status(400).json({
      ok: false,
      allowed: false,
      error: 'Request tap kedaluwarsa (Anti-Replay).',
    });
    return;
  }

  // 2. Idempotency / Duplicate request protection
  if (processedTapIds.has(tapId)) {
    recordSuspiciousTap(uid, 'Duplikasi nonce/tapId terdeteksi', 0, tapId);
    res.status(409).json({
      ok: false,
      allowed: false,
      duplicate: true,
      error: 'Tap sudah diproses.',
    });
    return;
  }
  processedTapIds.add(tapId);
  if (processedTapIds.size > 5000) {
    const firstKey = processedTapIds.values().next().value;
    if (firstKey) processedTapIds.delete(firstKey);
  }

  // 3. Rate & robotic timing validation (Anti Auto-Clicker)
  const prevTapMs = lastTapTimestampMap.get(uid) || 0;
  const deltaMs = nowMs - prevTapMs;
  const hasExplicitIntervals = Array.isArray(req.body?.tapIntervals);
  if (
    requestedTapCount === 1 &&
    !hasExplicitIntervals &&
    prevTapMs > 0 &&
    deltaMs < 20
  ) {
    recordSuspiciousTap(
      uid,
      `Frekuensi tap terlalu cepat (${deltaMs}ms < 20ms)`,
      deltaMs,
      tapId
    );
    res.status(429).json({
      ok: false,
      allowed: false,
      rateLimited: true,
      error: 'Ketukan terlalu cepat, terdeteksi aktivitas tidak wajar.',
    });
    return;
  }

  const clientIntervals: number[] = hasExplicitIntervals
    ? req.body.tapIntervals
        .map((n: unknown) => Number(n))
        .filter((n: number) => Number.isFinite(n) && n > 0 && n < 2000)
    : prevTapMs > 0 && deltaMs < 1000 && requestedTapCount === 1
    ? [deltaMs]
    : [];

  if (clientIntervals.length > 0) {
    const intervals = recentTapIntervalsMap.get(uid) || [];
    for (const iv of clientIntervals) {
      if (iv < 20) {
        recordSuspiciousTap(
          uid,
          `Frekuensi tap terlalu cepat (${iv}ms < 20ms)`,
          iv,
          tapId
        );
        res.status(429).json({
          ok: false,
          allowed: false,
          rateLimited: true,
          error: 'Ketukan terlalu cepat, terdeteksi aktivitas tidak wajar.',
        });
        return;
      }
      intervals.push(iv);
      if (intervals.length > 10) intervals.shift();
    }
    recentTapIntervalsMap.set(uid, intervals);

    if (intervals.length === 10) {
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const maxDiff = Math.max(...intervals.map((v) => Math.abs(v - avg)));
      if (avg < 140 && maxDiff <= 2) {
        recordSuspiciousTap(
          uid,
          `Pola interval konstan auto-clicker terdeteksi (avg ${Math.round(avg)}ms)`,
          deltaMs,
          tapId
        );
        res.status(429).json({
          ok: false,
          allowed: false,
          rateLimited: true,
          error: 'Terdeteksi pola auto-clicker otomatis. Tap ditolak.',
        });
        return;
      }
    }
  }
  lastTapTimestampMap.set(uid, nowMs);

  const clientLevel = Math.max(
    1,
    Math.min(5, Math.floor(Number(req.body?.dragonLevel || 1)))
  );

  // Always hydrate the authoritative persisted state before a wallet mutation.
  // This prevents a warm Vercel instance with stale memory from overwriting a newer
  // balance/energy snapshot created by another instance.
  try {
    const remoteState = await getServerDoc<ServerUserState>(
      'server_user_states',
      uid,
      true,
      true
    );
    if (remoteState && remoteState.uid) {
      userStateLedger.set(uid, remoteState);
    }
  } catch (error) {
    // Never mutate a wallet from a stale in-memory snapshot when the authoritative
    // Firestore state cannot be read. A transient DB error must be a safe 503, not a reset.
    console.error('[COINOVA-TAP] Authoritative state read failed:', error instanceof Error ? error.message : String(error));
    res.status(503).json({
      ok: false,
      allowed: false,
      error: 'Server sedang memverifikasi saldo akun. Tap tidak diproses dan saldo tidak diubah. Coba lagi sebentar.',
    });
    return;
  }

  const userState = getOrSyncServerUserState(uid, {
    dragonLevel: clientLevel,
  });

  // 4. Authoritative Core Energy check (cap batch to available energy)
  const costPerSingleTap = Math.max(
    1,
    serverEconomicConfig.energyCostPerTap || 1
  );
  const maxAffordableTaps = Math.floor(userState.energy / costPerSingleTap);
  if (maxAffordableTaps <= 0) {
    res.status(400).json({
      ok: false,
      allowed: false,
      energy: userState.energy,
      energyRemaining: userState.energy,
      maxEnergy: userState.maxEnergy,
      coinBalance: userState.coinBalance,
      error:
        'Core Energy habis. Upgrade level untuk mendapatkan kapasitas tap berikutnya.',
    });
    return;
  }

  const tapCount = Math.min(requestedTapCount, maxAffordableTaps);
  const energyCost = costPerSingleTap * tapCount;

  // 5. Strictly server-determined Coin reward based on user's level + VIP +10% play multiplier
  const dragonLevel = userState.dragonLevel;
  const baseRewardPerTap = getRewardPerTapForLevel(dragonLevel);
  const vipTapInfo = resolveUserVipState(userState);
  const rewardPerTap = vipTapInfo.isVip
    ? Math.max(1, Math.round(baseRewardPerTap * 1.1))
    : baseRewardPerTap;
  const coinsEarned = rewardPerTap * tapCount;

  let diamondChallenge: {
    challengeId: string;
    question: string;
    rewardFire: number;
  } | null = null;
  const writes: Promise<void>[] = [];

  // Random check on Tap Coin (~12% chance) to spawn a Math Challenge for Diamond
  const roll = crypto.randomInt(100);
  if (roll < 12) {
    // Keep the challenge intentionally simple and deterministic:
    // addition only. No subtraction or multiplication.
    const a = crypto.randomInt(2, 16);
    const b = crypto.randomInt(2, 16);
    const opSymbol = '+';
    const expectedAnswer = a + b;

    const rewardFire = crypto.randomInt(100) < 75 ? 1 : 2;
    const challengeId = `dch_${uid}_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
    const question = `${a} ${opSymbol} ${b} = ?`;

    activeDiamondChallengesMap.forEach((ch, key) => {
      if (nowMs > ch.expiresAt || ch.uid === uid) {
        activeDiamondChallengesMap.delete(key);
      }
    });

    const challengeRecord: DiamondMathChallengeRecord & {
      consumed?: boolean;
      updatedAt?: string;
    } = {
      challengeId,
      uid,
      question,
      expectedAnswer,
      rewardFire,
      consumed: false,
      createdAt: nowMs,
      expiresAt: nowMs + 5 * 60 * 1000,
      updatedAt: new Date(nowMs).toISOString(),
    };
    activeDiamondChallengesMap.set(challengeId, challengeRecord);
    writes.push(
      setServerDoc('server_diamond_challenges', challengeId, challengeRecord)
    );

    diamondChallenge = {
      challengeId,
      question,
      rewardFire,
    };
  }

  userState.energy = Math.max(0, userState.energy - energyCost);
  userState.lastEnergyRegenMs = nowMs;
  userState.coinBalance = Math.max(0, userState.coinBalance + coinsEarned);
  userState.totalTaps = Math.max(0, userState.totalTaps + tapCount);
  userState.updatedAt = new Date(nowMs).toISOString();

  userStateLedger.set(uid, userState);

  recordLedgerTransaction(
    {
      uid,
      category: 'TAP_REWARD',
      direction: 'CREDIT',
      currency: 'COIN',
      amount: coinsEarned,
      description: `Tap Reward Lv.${dragonLevel} (${tapCount}x): +${coinsEarned.toLocaleString('id-ID')} Koin`,
      referenceId: tapId,
    },
    true
  );

  writes.push(persistUserStateToFirestore(userState));
  await Promise.all(writes).catch(() => {});

  res.json({
    ok: true,
    allowed: true,
    dragonLevel,
    tapCount,
    rewardPerTap,
    coinsEarned,
    coinsAwarded: coinsEarned,
    fireEarned: 0,
    diamondChallenge,
    idrEarned: coinsEarned,
    energySpent: energyCost,
    energy: userState.energy,
    energyRemaining: userState.energy,
    maxEnergy: userState.maxEnergy,
    coinBalance: userState.coinBalance,
    fireBalance: userState.fireBalance,
    idrBalance: userState.coinBalance,
    totalTaps: userState.totalTaps,
    timestamp: userState.updatedAt,
  });
});

// ============================================================================
// SERVER-VALIDATED DIAMOND MATH CHALLENGE ENDPOINT (ANTI-SPAM / SINGLE-USE)
// ============================================================================
app.post(
  '/api/game/diamond-challenge/verify',
  async (req: Request, res: Response) => {
    const uid = String(req.body?.uid || '').trim();
    const challengeId = String(req.body?.challengeId || '').trim();
    const rawAnswer = req.body?.answer;

    if (!uid || !challengeId) {
      res.status(400).json({
        ok: false,
        error: 'Data challenge tidak valid.',
      });
      return;
    }

    if (processedDiamondChallengesSet.has(challengeId)) {
      res.status(409).json({
        ok: false,
        alreadyProcessed: true,
        error: 'Challenge ini sudah pernah dijawab.',
      });
      return;
    }

    let challenge:
      | (DiamondMathChallengeRecord & { consumed?: boolean; updatedAt?: string })
      | undefined = activeDiamondChallengesMap.get(challengeId);
    if (!challenge) {
      const remoteCh = await getServerDoc<
        DiamondMathChallengeRecord & { consumed?: boolean; updatedAt?: string }
      >('server_diamond_challenges', challengeId).catch(() => null);
      if (remoteCh) {
        if (remoteCh.consumed) {
          processedDiamondChallengesSet.add(challengeId);
          res.status(409).json({
            ok: false,
            alreadyProcessed: true,
            error: 'Challenge ini sudah pernah dijawab.',
          });
          return;
        }
        challenge = remoteCh;
      }
    }

    if (!challenge || challenge.uid !== uid) {
      res.status(404).json({
        ok: false,
        error: 'Challenge tidak ditemukan atau sudah kedaluwarsa.',
      });
      return;
    }

    activeDiamondChallengesMap.delete(challengeId);
    processedDiamondChallengesSet.add(challengeId);
    if (processedDiamondChallengesSet.size > 2000) {
      const oldest = processedDiamondChallengesSet.values().next().value;
      if (oldest) processedDiamondChallengesSet.delete(oldest);
    }

    const nowMs = Date.now();
    await setServerDoc('server_diamond_challenges', challengeId, {
      ...challenge,
      consumed: true,
      updatedAt: new Date(nowMs).toISOString(),
    }).catch(() => {});

    if (nowMs > challenge.expiresAt) {
      res.status(400).json({
        ok: false,
        correct: false,
        rewardFire: 0,
        error: 'Waktu menjawab challenge sudah habis.',
      });
      return;
    }

    const parsedAnswer = Number(String(rawAnswer ?? '').trim());
    const isCorrect =
      Number.isFinite(parsedAnswer) &&
      String(rawAnswer ?? '').trim() !== '' &&
      parsedAnswer === challenge.expectedAnswer;

    const userState = await loadAndSyncServerUserStateFromFirestore(uid);

    if (!isCorrect) {
      res.json({
        ok: true,
        correct: false,
        rewardFire: 0,
        fireBalance: userState.fireBalance,
        message: 'Jawaban salah. Diamond tidak didapat.',
      });
      return;
    }

    const rewardFire = Math.max(1, Math.floor(challenge.rewardFire));
    userState.fireBalance = Math.max(0, userState.fireBalance + rewardFire);
    userState.updatedAt = new Date(nowMs).toISOString();
    userStateLedger.set(uid, userState);

    const txEntry = recordLedgerTransaction({
      uid,
      category: 'REWARD',
      direction: 'CREDIT',
      currency: 'FIRE',
      amount: rewardFire,
      description: `Bonus Diamond Challenge (${challenge.question.replace('= ?', `= ${challenge.expectedAnswer}`)}): +${rewardFire} Diamond`,
      referenceId: challengeId,
    });

    await Promise.all([
      persistUserStateToFirestore(userState),
      setServerDoc('server_transactions', txEntry.id, txEntry),
    ]).catch(() => {});

    res.json({
      ok: true,
      correct: true,
      rewardFire,
      fireBalance: userState.fireBalance,
      message: `Benar! +${rewardFire} Diamond 💎`,
    });
  }
);

// ============================================================================
// MISSION STATUS, APK INSTALL VERIFICATION, TELEGRAM BOT API VERIFICATION & CLAIM
// ============================================================================
app.get('/api/game/missions/status/:uid', async (req: Request, res: Response) => {
  const uid = String(req.params.uid || '').trim();
  if (!uid) {
    res.status(400).json({ ok: false, error: 'UID tidak valid.' });
    return;
  }
  const userState = await loadAndSyncServerUserStateFromFirestore(uid);
  const claimedTaskList = Array.isArray(userState.claimedTaskIds)
    ? userState.claimedTaskIds
    : [];
  const isApkClaimed = claimedTaskList.includes('vp_install_apk');
  const isTelegramClaimed = claimedTaskList.includes('vp_join_channel');

  res.json({
    ok: true,
    uid,
    apkDownloadUrl: resolveApkDownloadUrl(),
    telegramChannelUrl: OFFICIAL_TELEGRAM_CHANNEL_URL,
    telegramChannelId: OFFICIAL_TELEGRAM_CHANNEL_ID,
    apkMissionStatus: isApkClaimed
      ? 'CLAIMED'
      : userState.apkMissionStatus || 'NOT_STARTED',
    apkDownloadClickedAt: userState.apkDownloadClickedAt || null,
    apkVerifiedAt: userState.apkVerifiedAt || null,
    apkInstallToken: userState.apkInstallToken || null,
    telegramUserId: userState.telegramUserId || '',
    telegramUsername: userState.telegramUsername || '',
    telegramChannelVerified: Boolean(
      isTelegramClaimed || userState.telegramChannelVerified
    ),
    claimedTaskIds: claimedTaskList,
    claimedInviteTargets: userState.claimedInviteTargets || [],
  });
});

app.post('/api/game/apk/start-download', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  if (!uid) {
    res.status(400).json({ ok: false, error: 'UID tidak valid.' });
    return;
  }

  const userState = await loadAndSyncServerUserStateFromFirestore(uid);
  const claimedTaskList = Array.isArray(userState.claimedTaskIds)
    ? userState.claimedTaskIds
    : [];
  const nowIso = new Date().toISOString();
  const installToken =
    userState.apkInstallToken || createApkInstallTokenForUser(uid);

  apkInstallTokenToUidMap.set(installToken, uid);
  userState.apkInstallToken = installToken;
  userState.apkDownloadClickedAt = userState.apkDownloadClickedAt || nowIso;

  if (claimedTaskList.includes('vp_install_apk')) {
    userState.apkMissionStatus = 'CLAIMED';
  } else if (userState.apkMissionStatus !== 'VERIFIED') {
    userState.apkMissionStatus = 'WAITING_VERIFICATION';
  }
  userState.updatedAt = nowIso;
  userStateLedger.set(uid, userState);

  const baseApkUrl = resolveApkDownloadUrl();
  const separator = baseApkUrl.includes('?') ? '&' : '?';
  const downloadUrlWithCallback = `${baseApkUrl}${separator}uid=${encodeURIComponent(
    uid
  )}&install_token=${encodeURIComponent(installToken)}`;

  await Promise.all([
    persistUserStateToFirestore(userState),
    setServerDoc('server_apk_installs', sanitizeAccountKey(uid), {
      uid,
      installToken,
      status: userState.apkMissionStatus,
      downloadClickedAt: userState.apkDownloadClickedAt,
      verifiedAt: userState.apkVerifiedAt || null,
      updatedAt: nowIso,
    }),
  ]).catch(() => {});

  res.json({
    ok: true,
    uid,
    apkDownloadUrl: baseApkUrl,
    downloadUrlWithCallback,
    installToken,
    apkMissionStatus: userState.apkMissionStatus,
    message:
      'Unduhan APK dicatat. Status misi: Menunggu Verifikasi instalasi dari aplikasi APK COINOVA.',
  });
});

const handleApkVerifyCallback = async (req: Request, res: Response) => {
  const rawUid = String(req.body?.uid || req.query?.uid || '').trim();
  const installToken = String(
    req.body?.installToken ||
      req.body?.install_token ||
      req.query?.installToken ||
      req.query?.install_token ||
      ''
  ).trim();
  const deviceId = String(
    req.body?.deviceId || req.body?.device_id || req.query?.device_id || ''
  ).trim();
  const callbackSecret = String(
    req.body?.secret ||
      req.headers['x-apk-verify-secret'] ||
      req.query?.secret ||
      ''
  ).trim();

  const verifiedUidFromToken = verifyApkInstallTokenSignature(
    installToken,
    rawUid || undefined
  );
  const expectedSecret = resolveApkVerifySecret();
  const isSecretAuthorized =
    Boolean(callbackSecret) &&
    callbackSecret.length > 0 &&
    callbackSecret === expectedSecret;

  const targetUid = verifiedUidFromToken || (isSecretAuthorized ? rawUid : '');
  if (!targetUid) {
    res.status(403).json({
      ok: false,
      error:
        'Token konfirmasi instalasi APK tidak valid atau belum terverifikasi.',
    });
    return;
  }

  // Require either valid signed installToken issued by start-download AND (callback secret or native APK user-agent / deviceId)
  if (!isSecretAuthorized && !deviceId) {
    res.status(400).json({
      ok: false,
      error:
        'Konfirmasi instalasi APK membutuhkan callback dari aplikasi APK (device_id / secret).',
    });
    return;
  }

  const userState = await loadAndSyncServerUserStateFromFirestore(targetUid);
  const claimedTaskList = Array.isArray(userState.claimedTaskIds)
    ? userState.claimedTaskIds
    : [];
  const nowIso = new Date().toISOString();

  userState.apkVerifiedAt = userState.apkVerifiedAt || nowIso;
  if (deviceId) {
    userState.apkDeviceId = deviceId.slice(0, 120);
  }
  if (!claimedTaskList.includes('vp_install_apk')) {
    userState.apkMissionStatus = 'VERIFIED';
  } else {
    userState.apkMissionStatus = 'CLAIMED';
  }
  userState.updatedAt = nowIso;
  userStateLedger.set(targetUid, userState);

  await Promise.all([
    persistUserStateToFirestore(userState),
    setServerDoc('server_apk_installs', sanitizeAccountKey(targetUid), {
      uid: targetUid,
      installToken: userState.apkInstallToken || installToken,
      deviceId: userState.apkDeviceId || deviceId || null,
      status: userState.apkMissionStatus,
      downloadClickedAt: userState.apkDownloadClickedAt || nowIso,
      verifiedAt: userState.apkVerifiedAt,
      updatedAt: nowIso,
    }),
  ]).catch(() => {});

  res.json({
    ok: true,
    uid: targetUid,
    apkMissionStatus: userState.apkMissionStatus,
    verifiedAt: userState.apkVerifiedAt,
    message: 'Instalasi APK COINOVA berhasil diverifikasi oleh server.',
  });
};

app.post('/api/game/apk/verify-callback', handleApkVerifyCallback);
app.get('/api/game/apk/verify-callback', handleApkVerifyCallback);

app.post('/api/game/telegram/link', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  const rawTelegramUserId = String(req.body?.telegramUserId || '')
    .trim()
    .replace(/[^\d]/g, '');
  const rawTelegramUsername = String(req.body?.telegramUsername || '')
    .trim()
    .replace(/^@+/, '')
    .slice(0, 64);

  if (!uid) {
    res.status(400).json({ ok: false, error: 'UID pengguna tidak valid.' });
    return;
  }

  if (!/^\d{4,20}$/.test(rawTelegramUserId)) {
    res.status(400).json({
      ok: false,
      error:
        'Masukkan Telegram User ID berupa angka yang valid (contoh: 123456789). Anda bisa melihat ID Telegram Anda melalui @userinfobot di Telegram.',
    });
    return;
  }

  // Enforce 1 Telegram User ID per 1 COINOVA user account
  const existingOwnerMem = telegramUserIdToUidMap.get(rawTelegramUserId);
  if (existingOwnerMem && existingOwnerMem !== uid) {
    res.status(409).json({
      ok: false,
      error:
        'Akun Telegram ini sudah dihubungkan ke akun COINOVA lain. Gunakan akun Telegram milik Anda sendiri.',
    });
    return;
  }

  const remoteLink = await getServerDoc<{
    telegramUserId: string;
    uid: string;
  }>('server_telegram_links', `tg_${rawTelegramUserId}`).catch(() => null);
  if (remoteLink && remoteLink.uid && remoteLink.uid !== uid) {
    telegramUserIdToUidMap.set(rawTelegramUserId, remoteLink.uid);
    res.status(409).json({
      ok: false,
      error:
        'Akun Telegram ini sudah dihubungkan ke akun COINOVA lain. Gunakan akun Telegram milik Anda sendiri.',
    });
    return;
  }

  const nowIso = new Date().toISOString();
  const userState = await loadAndSyncServerUserStateFromFirestore(uid);
  userState.telegramUserId = rawTelegramUserId;
  if (rawTelegramUsername) {
    userState.telegramUsername = rawTelegramUsername;
  }
  userState.telegramLinkedAt = nowIso;
  userState.updatedAt = nowIso;
  userStateLedger.set(uid, userState);
  telegramUserIdToUidMap.set(rawTelegramUserId, uid);

  await Promise.all([
    persistUserStateToFirestore(userState),
    setServerDoc('server_telegram_links', `tg_${rawTelegramUserId}`, {
      telegramUserId: rawTelegramUserId,
      telegramUsername: rawTelegramUsername || null,
      uid,
      linkedAt: nowIso,
      updatedAt: nowIso,
    }),
  ]).catch(() => {});

  res.json({
    ok: true,
    uid,
    telegramUserId: rawTelegramUserId,
    telegramUsername: userState.telegramUsername || '',
    linkedAt: nowIso,
    message: `ID Telegram (${rawTelegramUserId}) berhasil dihubungkan ke akun COINOVA.`,
  });
});

app.post(
  '/api/game/telegram/verify-channel',
  async (req: Request, res: Response) => {
    const uid = String(req.body?.uid || '').trim();
    const inputTelegramUserId = String(req.body?.telegramUserId || '')
      .trim()
      .replace(/[^\d]/g, '');
    const inputTelegramUsername = String(req.body?.telegramUsername || '')
      .trim()
      .replace(/^@+/, '')
      .slice(0, 64);

    if (!uid) {
      res.status(400).json({ ok: false, error: 'UID pengguna tidak valid.' });
      return;
    }

    const taskId = 'vp_join_channel';
    const dedupKey = `${uid}__${taskId}`;

    // Concurrency & idempotency guard BEFORE any async call
    if (inFlightTaskClaimLocks.has(dedupKey)) {
      res.status(409).json({
        ok: false,
        error: 'Verifikasi sedang diproses. Mohon tunggu sebentar.',
      });
      return;
    }

    inFlightTaskClaimLocks.add(dedupKey);
    try {
      const userState = await loadAndSyncServerUserStateFromFirestore(uid);
      const claimedTaskList = Array.isArray(userState.claimedTaskIds)
        ? userState.claimedTaskIds
        : [];
      const claimDocId = `claim_${sanitizeAccountKey(uid)}_${sanitizeAccountKey(taskId)}`;

      if (
        claimedTaskIdsSet.has(dedupKey) ||
        claimedTaskList.includes(taskId)
      ) {
        claimedTaskIdsSet.add(dedupKey);
        res.status(409).json({
          ok: false,
          alreadyClaimed: true,
          error: 'Misi Bergabung Saluran Telegram ini sudah pernah diklaim sebelumnya.',
        });
        return;
      }

      const existingClaimDoc = await getServerDoc<{ claimId: string }>(
        'server_task_claims',
        claimDocId
      ).catch(() => null);
      if (existingClaimDoc) {
        claimedTaskIdsSet.add(dedupKey);
        if (!claimedTaskList.includes(taskId)) {
          userState.claimedTaskIds = [...claimedTaskList, taskId];
          await persistUserStateToFirestore(userState).catch(() => {});
        }
        res.status(409).json({
          ok: false,
          alreadyClaimed: true,
          error: 'Misi Bergabung Saluran Telegram ini sudah pernah diklaim sebelumnya.',
        });
        return;
      }

      const effectiveTelegramUserId =
        inputTelegramUserId || userState.telegramUserId || '';
      if (!/^\d{4,20}$/.test(effectiveTelegramUserId)) {
        res.status(400).json({
          ok: false,
          verified: false,
          error:
            'Silakan hubungkan ID akun Telegram Anda terlebih dahulu (contoh: 123456789) sebelum menekan Verifikasi.',
        });
        return;
      }

      // Check Telegram ID uniqueness across users
      const existingOwnerMem = telegramUserIdToUidMap.get(effectiveTelegramUserId);
      if (existingOwnerMem && existingOwnerMem !== uid) {
        res.status(409).json({
          ok: false,
          verified: false,
          error:
            'ID Telegram ini sudah digunakan oleh akun COINOVA lain.',
        });
        return;
      }
      const remoteLink = await getServerDoc<{
        telegramUserId: string;
        uid: string;
      }>('server_telegram_links', `tg_${effectiveTelegramUserId}`).catch(
        () => null
      );
      if (remoteLink && remoteLink.uid && remoteLink.uid !== uid) {
        telegramUserIdToUidMap.set(effectiveTelegramUserId, remoteLink.uid);
        res.status(409).json({
          ok: false,
          verified: false,
          error:
            'ID Telegram ini sudah digunakan oleh akun COINOVA lain.',
        });
        return;
      }

      // Save linked Telegram User ID first
      const nowIso = new Date().toISOString();
      userState.telegramUserId = effectiveTelegramUserId;
      if (inputTelegramUsername) {
        userState.telegramUsername = inputTelegramUsername;
      }
      userState.telegramLinkedAt = userState.telegramLinkedAt || nowIso;
      telegramUserIdToUidMap.set(effectiveTelegramUserId, uid);

      // Server-side Telegram Bot API getChatMember verification
      const checkResult = await verifyTelegramChannelMembershipOnServer(
        effectiveTelegramUserId
      );

      if (!checkResult.joined) {
        await persistUserStateToFirestore(userState).catch(() => {});
        res.status(400).json({
          ok: false,
          verified: false,
          memberStatus: checkResult.status,
          error:
            '❌ Kamu belum bergabung ke channel Telegram. Bergabung terlebih dahulu lalu tekan Verifikasi.',
        });
        return;
      }

      // Membership verified! Award server-configured reward once and mark mission completed (+10% VIP bonus if active)
      const missionDef = SERVER_MISSION_REWARDS.vp_join_channel;
      const vipTgInfo = resolveUserVipState(userState);
      const coinReward = vipTgInfo.isVip
        ? Math.max(1, Math.round(missionDef.coinReward * 1.1))
        : missionDef.coinReward;
      const fireReward = missionDef.fireReward;

      claimedTaskIdsSet.add(dedupKey);
      userState.telegramChannelVerified = true;
      userState.telegramChannelVerifiedAt = nowIso;
      if (checkResult.username && !userState.telegramUsername) {
        userState.telegramUsername = checkResult.username;
      }
      userState.claimedTaskIds = [...claimedTaskList, taskId];
      userState.coinBalance = Math.max(0, userState.coinBalance + coinReward);
      userState.fireBalance = Math.max(0, userState.fireBalance + fireReward);
      userState.updatedAt = nowIso;
      userStateLedger.set(uid, userState);

      const txEntry = recordLedgerTransaction({
        uid,
        category: 'TASK',
        direction: 'CREDIT',
        currency: 'COIN',
        amount: coinReward,
        description: `Verifikasi & Klaim Misi (${missionDef.title}): +${coinReward.toLocaleString('id-ID')} Koin & +${fireReward} Diamond`,
        referenceId: claimDocId,
      });

      await Promise.all([
        persistUserStateToFirestore(userState),
        setServerDoc('server_telegram_links', `tg_${effectiveTelegramUserId}`, {
          telegramUserId: effectiveTelegramUserId,
          telegramUsername: userState.telegramUsername || null,
          uid,
          verified: true,
          memberStatus: checkResult.status,
          linkedAt: userState.telegramLinkedAt,
          verifiedAt: nowIso,
          updatedAt: nowIso,
        }),
        setServerDoc('server_task_claims', claimDocId, {
          claimId: claimDocId,
          uid,
          taskId,
          taskTitle: missionDef.title,
          coinReward,
          fireReward,
          telegramUserId: effectiveTelegramUserId,
          memberStatus: checkResult.status,
          claimedAt: nowIso,
        }),
        setServerDoc('server_transactions', txEntry.id, txEntry),
      ]).catch(() => {});

      res.json({
        ok: true,
        verified: true,
        alreadyClaimed: false,
        taskId,
        memberStatus: checkResult.status,
        telegramUserId: effectiveTelegramUserId,
        telegramUsername: userState.telegramUsername || '',
        coinReward,
        fireReward,
        coinBalance: userState.coinBalance,
        fireBalance: userState.fireBalance,
        claimedTaskIds: userState.claimedTaskIds,
        message: '✅ Keanggotaan Telegram terverifikasi.',
      });
    } finally {
      inFlightTaskClaimLocks.delete(dedupKey);
    }
  }
);

app.post('/api/game/claim-task', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  const taskId = String(req.body?.taskId || '').trim();
  const targetMilestone = Math.max(
    0,
    Math.floor(Number(req.body?.targetMilestone || 0))
  );

  if (!uid || !taskId) {
    res.status(400).json({ ok: false, error: 'Data klaim misi tidak lengkap.' });
    return;
  }

  // Strictly resolve reward from server configuration — NEVER trust client reward amounts
  const missionDef = resolveServerMissionReward(taskId);
  if (!missionDef) {
    res.status(400).json({
      ok: false,
      error: 'ID misi tidak dikenali oleh konfigurasi server.',
    });
    return;
  }

  const dedupKey = `${uid}__${taskId}`;

  // Synchronous concurrency lock + memory idempotency check BEFORE any await
  // Prevents race conditions when 2 simultaneous requests arrive
  if (inFlightTaskClaimLocks.has(dedupKey) || claimedTaskIdsSet.has(dedupKey)) {
    res.status(409).json({
      ok: false,
      alreadyClaimed: true,
      error: 'Target misi ini sudah pernah diklaim sebelumnya.',
    });
    return;
  }

  inFlightTaskClaimLocks.add(dedupKey);
  try {
    const userState = await loadAndSyncServerUserStateFromFirestore(uid);
    const claimedTaskList = Array.isArray(userState.claimedTaskIds)
      ? userState.claimedTaskIds
      : [];
    const claimDocId = `claim_${sanitizeAccountKey(uid)}_${sanitizeAccountKey(taskId)}`;

    if (claimedTaskIdsSet.has(dedupKey) || claimedTaskList.includes(taskId)) {
      claimedTaskIdsSet.add(dedupKey);
      res.status(409).json({
        ok: false,
        alreadyClaimed: true,
        error: 'Target misi ini sudah pernah diklaim sebelumnya.',
      });
      return;
    }

    // Persistent unique constraint check in Firestore server_task_claims
    const existingClaimDoc = await getServerDoc<{ claimId: string }>(
      'server_task_claims',
      claimDocId
    ).catch(() => null);
    if (existingClaimDoc) {
      claimedTaskIdsSet.add(dedupKey);
      if (!claimedTaskList.includes(taskId)) {
        userState.claimedTaskIds = [...claimedTaskList, taskId];
        await persistUserStateToFirestore(userState).catch(() => {});
      }
      res.status(409).json({
        ok: false,
        alreadyClaimed: true,
        error: 'Target misi ini sudah pernah diklaim sebelumnya.',
      });
      return;
    }

    if (targetMilestone > 0) {
      const claimedTargets = Array.isArray(userState.claimedInviteTargets)
        ? userState.claimedInviteTargets
        : [];
      if (claimedTargets.includes(targetMilestone)) {
        res.status(409).json({
          ok: false,
          alreadyClaimed: true,
          error: `Target ${targetMilestone} teman sudah pernah diklaim.`,
        });
        return;
      }
    }

    // Mission-specific server-side verification checks
    if (taskId === 'vp_join_channel') {
      const tgUserId = String(
        req.body?.telegramUserId || userState.telegramUserId || ''
      )
        .trim()
        .replace(/[^\d]/g, '');
      const tgCheck = await verifyTelegramChannelMembershipOnServer(tgUserId);
      if (!tgCheck.joined) {
        res.status(400).json({
          ok: false,
          verified: false,
          error:
            '❌ Kamu belum bergabung ke channel Telegram. Bergabung terlebih dahulu lalu tekan Verifikasi.',
        });
        return;
      }
      userState.telegramUserId = tgUserId;
      userState.telegramChannelVerified = true;
      userState.telegramChannelVerifiedAt = new Date().toISOString();
    } else if (taskId === 'vp_install_apk') {
      if (userState.apkMissionStatus !== 'VERIFIED') {
        res.status(400).json({
          ok: false,
          apkMissionStatus: userState.apkMissionStatus || 'NOT_STARTED',
          error:
            userState.apkMissionStatus === 'WAITING_VERIFICATION'
              ? 'Status misi Install APK masih Menunggu Verifikasi. Reward +5.000 Koin hanya diberikan setelah instalasi APK terverifikasi oleh server.'
              : 'Silakan tekan tombol INSTALL APK terlebih dahulu dan selesaikan instalasi aplikasi.',
        });
        return;
      }
      userState.apkMissionStatus = 'CLAIMED';
    } else if (taskId === 'vp_level_bonus') {
      if (userState.dragonLevel < 2) {
        res.status(400).json({
          ok: false,
          error: 'Syarat level untuk Bonus Level belum terpenuhi.',
        });
        return;
      }
    } else if (taskId === 'vp_claims_2500') {
      const effectiveClaims = Math.max(
        userState.dailyClaimsUsed || 0,
        Math.floor((userState.totalTaps || 0) / 10)
      );
      if (effectiveClaims < 2500) {
        res.status(400).json({
          ok: false,
          error: `Progress klaim belum mencapai 2.500 (${effectiveClaims}/2500).`,
        });
        return;
      }
    }

    const vipTaskInfo = resolveUserVipState(userState);
    const coinReward = vipTaskInfo.isVip
      ? Math.max(1, Math.round(missionDef.coinReward * 1.1))
      : missionDef.coinReward;
    const fireReward = missionDef.fireReward;
    const nowIso = new Date().toISOString();

    if (targetMilestone > 0) {
      const claimedTargets = Array.isArray(userState.claimedInviteTargets)
        ? userState.claimedInviteTargets
        : [];
      userState.claimedInviteTargets = [...claimedTargets, targetMilestone];
    }

    claimedTaskIdsSet.add(dedupKey);
    userState.claimedTaskIds = [...claimedTaskList, taskId];
    userState.coinBalance = Math.max(0, userState.coinBalance + coinReward);
    userState.fireBalance = Math.max(0, userState.fireBalance + fireReward);
    userState.updatedAt = nowIso;
    userStateLedger.set(uid, userState);

    const txEntry = recordLedgerTransaction({
      uid,
      category: 'TASK',
      direction: 'CREDIT',
      currency: coinReward > 0 ? 'COIN' : 'FIRE',
      amount: coinReward > 0 ? coinReward : fireReward,
      description: `Klaim Misi (${missionDef.title}): +${coinReward.toLocaleString('id-ID')} Koin${fireReward > 0 ? ` & +${fireReward} Diamond` : ''}`,
      referenceId: claimDocId,
    });

    await Promise.all([
      persistUserStateToFirestore(userState),
      setServerDoc('server_task_claims', claimDocId, {
        claimId: claimDocId,
        uid,
        taskId,
        taskTitle: missionDef.title,
        targetMilestone: targetMilestone || 0,
        coinReward,
        fireReward,
        claimedAt: nowIso,
      }),
      setServerDoc('server_transactions', txEntry.id, txEntry),
    ]).catch(() => {});

    res.json({
      ok: true,
      taskId,
      targetMilestone,
      coinReward,
      fireReward,
      coinBalance: userState.coinBalance,
      fireBalance: userState.fireBalance,
      claimedTaskIds: userState.claimedTaskIds,
      claimedInviteTargets: userState.claimedInviteTargets || [],
    });
  } finally {
    inFlightTaskClaimLocks.delete(dedupKey);
  }
});

// ============================================================================
// SERVER-SIDE REWARD SYNC ENDPOINTS (CYBER VAULT, CHECKIN, TASK, GIFT CODE)
// ============================================================================
app.post('/api/game/claim-cycle', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  if (!uid) {
    res.status(400).json({ ok: false, error: 'UID tidak valid.' });
    return;
  }
  const userState = await loadAndSyncServerUserStateFromFirestore(uid);
  const maxDailyClaims = LEVEL_DAILY_CLAIM_LIMITS[userState.dragonLevel] || 200;
  if (userState.dailyClaimsUsed >= maxDailyClaims) {
    res.status(400).json({
      ok: false,
      error: `Kuota klaim Cyber Vault harian (${maxDailyClaims}) sudah tercapai.`,
    });
    return;
  }
  const bonusCoins = getRewardPerTapForLevel(userState.dragonLevel) * 10;
  const bonusFire = crypto.randomInt(100) < 25 ? 1 : 0;
  userState.coinBalance = Math.max(0, userState.coinBalance + bonusCoins);
  userState.fireBalance = Math.max(0, userState.fireBalance + bonusFire);
  userState.dailyClaimsUsed += 1;
  userState.updatedAt = new Date().toISOString();
  userStateLedger.set(uid, userState);
  const txEntry = recordLedgerTransaction({
    uid,
    category: 'CYBER_VAULT',
    direction: 'CREDIT',
    currency: 'COIN',
    amount: bonusCoins,
    description: `Klaim Cyber Vault 10/10 Tap: +${bonusCoins.toLocaleString('id-ID')} Koin${bonusFire > 0 ? ` & +${bonusFire} Diamond` : ''}`,
    referenceId: String(req.body?.cycleId || `cyc_${Date.now()}`),
  });
  await Promise.all([
    persistUserStateToFirestore(userState),
    setServerDoc('server_transactions', txEntry.id, txEntry),
  ]).catch(() => {});
  res.json({
    ok: true,
    bonusCoins,
    bonusFire,
    coinBalance: userState.coinBalance,
    fireBalance: userState.fireBalance,
    dailyClaimsUsed: userState.dailyClaimsUsed,
    transaction: txEntry,
  });
});

app.post('/api/game/claim-checkin', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  const requestedCoins = Math.max(0, Math.min(5000, Math.floor(Number(req.body?.coinReward || 500))));
  const requestedFire = Math.max(0, Math.min(10, Math.floor(Number(req.body?.fireReward || 1))));
  if (!uid) {
    res.status(400).json({ ok: false, error: 'UID tidak valid.' });
    return;
  }
  const today = getServerTodayKey();
  const userState = await loadAndSyncServerUserStateFromFirestore(uid);
  if (userState.lastCheckInDate === today) {
    res.status(409).json({
      ok: false,
      alreadyClaimed: true,
      error: 'Anda sudah klaim Absensi Harian hari ini.',
    });
    return;
  }
  const nextStreak = ((userState.dailyStreak || 0) % 7) + 1;
  userState.dailyStreak = nextStreak;
  userState.lastCheckInDate = today;
  userState.coinBalance = Math.max(0, userState.coinBalance + requestedCoins);
  userState.fireBalance = Math.max(0, userState.fireBalance + requestedFire);
  userState.updatedAt = new Date().toISOString();
  userStateLedger.set(uid, userState);

  const txEntry = recordLedgerTransaction({
    uid,
    category: 'REWARD',
    direction: 'CREDIT',
    currency: 'COIN',
    amount: requestedCoins,
    description: `Daily Check-In Hari ke-${nextStreak} (+${requestedCoins.toLocaleString('id-ID')} Koin & +${requestedFire} Diamond)`,
    referenceId: `checkin_${today}`,
  });

  await Promise.all([
    persistUserStateToFirestore(userState),
    setServerDoc('server_transactions', txEntry.id, txEntry),
  ]).catch(() => {});

  res.json({
    ok: true,
    dailyStreak: nextStreak,
    lastCheckInDate: today,
    coinBalance: userState.coinBalance,
    fireBalance: userState.fireBalance,
  });
});

app.post('/api/game/checkin/claim', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  const requestedCoins = Math.max(0, Math.min(5000, Math.floor(Number(req.body?.coinReward || 500))));
  const requestedFire = Math.max(0, Math.min(10, Math.floor(Number(req.body?.fireReward || 1))));
  if (!uid) {
    res.status(400).json({ ok: false, error: 'UID tidak valid.' });
    return;
  }
  const today = getServerTodayKey();
  const userState = await loadAndSyncServerUserStateFromFirestore(uid);
  if (userState.lastCheckInDate === today) {
    res.status(400).json({
      ok: false,
      alreadyClaimed: true,
      error: 'Anda sudah klaim Absensi Harian hari ini.',
    });
    return;
  }
  const nextStreak = ((userState.dailyStreak || 0) % 7) + 1;
  userState.dailyStreak = nextStreak;
  userState.lastCheckInDate = today;
  userState.coinBalance = Math.max(0, userState.coinBalance + requestedCoins);
  userState.fireBalance = Math.max(0, userState.fireBalance + requestedFire);
  userState.updatedAt = new Date().toISOString();
  userStateLedger.set(uid, userState);

  const txEntry = recordLedgerTransaction({
    uid,
    category: 'REWARD',
    direction: 'CREDIT',
    currency: 'COIN',
    amount: requestedCoins,
    description: `Daily Check-In Hari ke-${nextStreak} (+${requestedCoins.toLocaleString('id-ID')} Koin & +${requestedFire} Diamond)`,
    referenceId: `checkin_${today}`,
  });

  await Promise.all([
    persistUserStateToFirestore(userState),
    setServerDoc('server_transactions', txEntry.id, txEntry),
  ]).catch(() => {});

  res.json({
    ok: true,
    dailyStreak: nextStreak,
    lastCheckInDate: today,
    coinBalance: userState.coinBalance,
    fireBalance: userState.fireBalance,
  });
});

app.post('/api/game/creator/submit', async (req: Request, res: Response) => {
  await ensureFirestoreSeeded();
  const uid = String(req.body?.uid || '').trim();
  const username = String(req.body?.username || 'Member').trim();
  const platform = String(req.body?.platform || 'TikTok').trim();
  const contentUrl = String(req.body?.contentUrl || '').trim();
  const viewsCount = Math.max(0, Math.floor(Number(req.body?.viewsCount || 0)));
  if (!uid || !contentUrl) {
    res.status(400).json({ ok: false, error: 'Data konten kreator tidak lengkap.' });
    return;
  }
  const nowIso = new Date().toISOString();
  const submissionId =
    String(req.body?.submissionId || '').trim() ||
    `cr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const record: ServerCreatorSubmissionRecord = {
    submissionId,
    uid,
    username,
    platform,
    contentUrl,
    caption: String(req.body?.caption || ''),
    viewsCount,
    claimedRewardCoin: Math.max(0, Math.floor(Number(req.body?.claimedRewardCoin || 0))),
    claimedRewardFire: Math.max(0, Math.floor(Number(req.body?.claimedRewardFire || 0))),
    claimedRewardIdr: Math.max(0, Math.floor(Number(req.body?.claimedRewardIdr || 0))),
    rewardCoin: Math.max(0, Math.floor(Number(req.body?.rewardCoin || req.body?.claimedRewardCoin || 0))),
    rewardFire: Math.max(0, Math.floor(Number(req.body?.rewardFire || req.body?.claimedRewardFire || 0))),
    rewardIdr: Math.max(0, Math.floor(Number(req.body?.rewardIdr || req.body?.claimedRewardIdr || 0))),
    status: 'PENDING',
    adminNote: 'Menunggu review manual oleh Admin COINOVA.',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  serverCreatorSubmissionsMap.set(submissionId, record);
  await setServerDoc('server_creator_submissions', submissionId, record).catch(() => {});
  res.json({ ok: true, submission: record });
});

app.post(
  '/api/admin/creator/review',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    await ensureFirestoreSeeded();
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const submissionId = String(req.body?.submissionId || '').trim();
    const status = String(req.body?.status || '').trim() as 'APPROVED' | 'REJECTED';
    const coinReward = Math.max(0, Math.floor(Number(req.body?.coinReward || 0)));
    const fireReward = Math.max(0, Math.floor(Number(req.body?.fireReward || 0)));
    const adminNote = String(req.body?.adminNote || '').trim();

    if (!submissionId || !['APPROVED', 'REJECTED'].includes(status)) {
      res.status(400).json({ ok: false, error: 'Parameter review kreator tidak valid.' });
      return;
    }

    const existing = serverCreatorSubmissionsMap.get(submissionId);
    if (!existing) {
      res.status(404).json({ ok: false, error: 'Data konten tidak ditemukan.' });
      return;
    }

    const nowIso = new Date().toISOString();
    existing.status = status;
    existing.claimedRewardCoin = status === 'APPROVED' ? coinReward : 0;
    existing.claimedRewardFire = status === 'APPROVED' ? fireReward : 0;
    existing.claimedRewardIdr = status === 'APPROVED' ? coinReward : 0;
    existing.adminNote =
      adminNote || (status === 'APPROVED' ? 'Konten disetujui Admin.' : 'Konten ditolak Admin.');
    existing.updatedAt = nowIso;
    serverCreatorSubmissionsMap.set(submissionId, existing);

    const writes: Promise<void>[] = [
      setServerDoc('server_creator_submissions', submissionId, existing),
    ];

    if (status === 'APPROVED' && (coinReward > 0 || fireReward > 0)) {
      const st = await loadAndSyncServerUserStateFromFirestore(existing.uid);
      st.coinBalance = Math.max(0, st.coinBalance + coinReward);
      st.fireBalance = Math.max(0, st.fireBalance + fireReward);
      st.updatedAt = nowIso;
      userStateLedger.set(existing.uid, st);
      writes.push(persistUserStateToFirestore(st));

      const txEntry = recordLedgerTransaction({
        uid: existing.uid,
        category: 'CREATOR_REWARD',
        direction: 'CREDIT',
        currency: coinReward > 0 ? 'COIN' : 'FIRE',
        amount: coinReward > 0 ? coinReward : fireReward,
        description: `Creator Reward (${existing.platform}): +${coinReward.toLocaleString('id-ID')} Koin & +${fireReward} Diamond`,
        referenceId: submissionId,
      });
      writes.push(setServerDoc('server_transactions', txEntry.id, txEntry));
    }

    const auditEntry = recordAdminAudit(
      session.username,
      `CREATOR_${status}`,
      existing.uid,
      status === 'APPROVED' ? `+${coinReward} Koin / +${fireReward} Diamond` : 'REJECTED',
      `Reviewed creator submission ${submissionId}`
    );
    writes.push(setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry));
    await Promise.all(writes).catch(() => {});

    res.json({ ok: true, submission: existing });
  }
);

const handlePromoRedeemRequest = async (req: Request, res: Response) => {
  await ensureFirestoreSeeded();
  const uid = String(req.body?.uid || '').trim();
  const code = String(req.body?.code || '').trim().toUpperCase();

  if (!uid || !code) {
    res.status(400).json({ ok: false, error: 'Kode redeem tidak valid.' });
    return;
  }

  const lockKey = `${uid}__${code}`;
  if (inFlightPromoRedeemLocks.has(lockKey)) {
    res.status(429).json({
      ok: false,
      error: 'Klaim kode redeem sedang diproses. Mohon tunggu sebentar.',
    });
    return;
  }

  inFlightPromoRedeemLocks.add(lockKey);
  try {
    let promo = promoCodesMap.get(code);
    if (!promo) {
      const remotePromo = await getServerDoc<ServerPromoCodeRecord>(
        'server_promo_codes',
        sanitizeAccountKey(code)
      ).catch(() => null);
      if (remotePromo && remotePromo.code) {
        promo = remotePromo;
        promoCodesMap.set(code, promo);
      }
    }

    if (!promo) {
      res.status(404).json({
        ok: false,
        error: 'Kode redeem tidak ditemukan atau tidak terdaftar.',
      });
      return;
    }

    if (!promo.isActive) {
      res.status(400).json({
        ok: false,
        error: 'Kode redeem ini sudah dinonaktifkan oleh Admin.',
      });
      return;
    }

    if (promo.expiresAt) {
      const expMs = new Date(promo.expiresAt).getTime();
      if (Number.isFinite(expMs) && Date.now() > expMs) {
        res.status(400).json({
          ok: false,
          error: 'Masa berlaku kode redeem ini sudah berakhir (kedaluwarsa).',
        });
        return;
      }
    }

    const maxQuota = Math.max(1, Number(promo.quota || promo.maxClaims || 100));
    const currentClaimsCount = Math.max(0, Number(promo.claimedCount || 0));
    if (currentClaimsCount >= maxQuota) {
      res.status(400).json({
        ok: false,
        error: `Kuota penggunaan kode redeem ${code} sudah habis (${currentClaimsCount}/${maxQuota}).`,
      });
      return;
    }

    const userState = await loadAndSyncServerUserStateFromFirestore(uid);
    const claimedCodes = Array.isArray(userState.claimedPromoCodes)
      ? userState.claimedPromoCodes
      : [];
    const claimId = `pclaim_${sanitizeAccountKey(code)}_${sanitizeAccountKey(uid)}`;
    const existingClaimMem = promoClaimsMap.get(claimId);

    if (claimedCodes.includes(code) || existingClaimMem) {
      res.status(409).json({
        ok: false,
        error: 'Kode redeem ini sudah pernah Anda klaim sebelumnya (1x per akun).',
      });
      return;
    }

    const existingClaimRemote = await getServerDoc<ServerPromoClaimRecord>(
      'server_promo_claims',
      claimId
    ).catch(() => null);
    if (existingClaimRemote) {
      promoClaimsMap.set(claimId, existingClaimRemote);
      res.status(409).json({
        ok: false,
        error: 'Kode redeem ini sudah pernah Anda klaim sebelumnya (1x per akun).',
      });
      return;
    }

    const coinReward = Math.max(0, Math.floor(Number(promo.coinReward || 0)));
    const fireReward = Math.max(0, Math.floor(Number(promo.fireReward || 0)));
    const nowIso = new Date().toISOString();
    const matchedAcc = findAccountByUidInMemory(uid);
    const resolvedUsername =
      matchedAcc?.username ||
      (!isPlaceholderUsername(userState.username) ? userState.username! : uid);

    promo.claimedCount = currentClaimsCount + 1;
    promo.updatedAt = nowIso;
    promoCodesMap.set(code, promo);

    const claimRecord: ServerPromoClaimRecord = {
      claimId,
      code,
      uid,
      username: resolvedUsername,
      coinReward,
      fireReward,
      claimedAt: nowIso,
    };
    promoClaimsMap.set(claimId, claimRecord);

    userState.claimedPromoCodes = [...claimedCodes, code];
    userState.coinBalance = Math.max(0, userState.coinBalance + coinReward);
    userState.fireBalance = Math.max(0, userState.fireBalance + fireReward);
    userState.updatedAt = nowIso;
    userStateLedger.set(uid, userState);

    const txEntry = recordLedgerTransaction({
      uid,
      category: 'REWARD_CODE',
      direction: 'CREDIT',
      currency: coinReward > 0 ? 'COIN' : 'FIRE',
      amount: coinReward > 0 ? coinReward : fireReward,
      description: `Klaim Kode Redeem (${code}): +${coinReward.toLocaleString('id-ID')} Koin${fireReward > 0 ? ` & +${fireReward} Diamond` : ''}`,
      referenceId: claimId,
    });

    await Promise.all([
      persistUserStateToFirestore(userState),
      setServerDoc('server_promo_codes', sanitizeAccountKey(code), promo),
      setServerDoc('server_promo_claims', claimId, claimRecord),
      setServerDoc('server_transactions', txEntry.id, txEntry),
    ]).catch(() => {});

    res.json({
      ok: true,
      code,
      coinReward,
      fireReward,
      coinBalance: userState.coinBalance,
      fireBalance: userState.fireBalance,
      message: `Kode Redeem ${code} berhasil diklaim! +${coinReward.toLocaleString('id-ID')} Koin${fireReward > 0 ? ` & +${fireReward} Diamond` : ''}`,
    });
  } finally {
    inFlightPromoRedeemLocks.delete(lockKey);
  }
};

app.post('/api/game/redeem-code', handlePromoRedeemRequest);
app.post('/api/game/promo/redeem', handlePromoRedeemRequest);
app.post('/api/game/promo/claim', handlePromoRedeemRequest);

// ============================================================================
// ADMIN PROMO / REDEEM CODE MANAGEMENT ENDPOINTS
// ============================================================================
app.get(
  '/api/admin/promo',
  requireAdminAuth,
  async (_req: Request, res: Response) => {
    await ensureFirestoreSeeded(true);
    const codes = Array.from(promoCodesMap.values()).sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime()
    );
    const claims = Array.from(promoClaimsMap.values()).sort(
      (a, b) =>
        new Date(b.claimedAt || 0).getTime() -
        new Date(a.claimedAt || 0).getTime()
    );
    res.json({
      ok: true,
      codes,
      claims,
    });
  }
);

app.post(
  '/api/admin/promo',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    await ensureFirestoreSeeded();
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const rawCode = String(req.body?.code || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '');
    const description = String(
      req.body?.description || `Kode Redeem ${rawCode}`
    )
      .trim()
      .slice(0, 140);
    const coinReward = Math.max(0, Math.floor(Number(req.body?.coinReward || 0)));
    const fireReward = Math.max(0, Math.floor(Number(req.body?.fireReward || 0)));
    const quota = Math.max(
      1,
      Math.floor(Number(req.body?.quota || req.body?.maxClaims || 100))
    );
    const rawExpiresAt = req.body?.expiresAt
      ? String(req.body.expiresAt).trim()
      : null;
    const isActive =
      req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true;

    if (!rawCode || rawCode.length < 3 || rawCode.length > 32) {
      res.status(400).json({
        ok: false,
        error: 'Kode redeem wajib diisi (3-32 karakter huruf/angka).',
      });
      return;
    }

    if (coinReward <= 0 && fireReward <= 0) {
      res.status(400).json({
        ok: false,
        error: 'Tentukan minimal reward Koin atau Diamond lebih dari 0.',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const existing = promoCodesMap.get(rawCode);
    const record: ServerPromoCodeRecord = {
      code: rawCode,
      description,
      coinReward,
      fireReward,
      quota,
      maxClaims: quota,
      claimedCount: existing ? Number(existing.claimedCount || 0) : 0,
      expiresAt: rawExpiresAt || null,
      isActive,
      createdBy: existing?.createdBy || session.username,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    promoCodesMap.set(rawCode, record);
    const auditEntry = recordAdminAudit(
      session.username,
      existing ? 'UPDATE_REDEEM_CODE' : 'CREATE_REDEEM_CODE',
      rawCode,
      `+${coinReward} Koin / +${fireReward} Diamond (Limit: ${quota})`,
      `${existing ? 'Updated' : 'Created'} redeem code ${rawCode}`
    );

    await Promise.all([
      setServerDoc('server_promo_codes', sanitizeAccountKey(rawCode), record),
      setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry),
    ]).catch(() => {});

    res.json({
      ok: true,
      code: record,
      message: `Kode Redeem ${rawCode} berhasil disimpan!`,
    });
  }
);

app.post(
  '/api/admin/promo/toggle',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    await ensureFirestoreSeeded();
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const rawCode = String(req.body?.code || '').trim().toUpperCase();
    const existing = promoCodesMap.get(rawCode);
    if (!existing) {
      res.status(404).json({
        ok: false,
        error: 'Kode redeem tidak ditemukan.',
      });
      return;
    }

    existing.isActive =
      req.body?.isActive !== undefined
        ? Boolean(req.body.isActive)
        : !existing.isActive;
    existing.updatedAt = new Date().toISOString();
    promoCodesMap.set(rawCode, existing);

    const auditEntry = recordAdminAudit(
      session.username,
      'TOGGLE_REDEEM_CODE',
      rawCode,
      existing.isActive ? 'ACTIVE' : 'INACTIVE',
      `Toggled redeem code ${rawCode} -> ${existing.isActive ? 'ACTIVE' : 'INACTIVE'}`
    );

    await Promise.all([
      setServerDoc('server_promo_codes', sanitizeAccountKey(rawCode), existing),
      setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry),
    ]).catch(() => {});

    res.json({
      ok: true,
      code: existing,
      promoCodes: Array.from(promoCodesMap.values()),
    });
  }
);

const handleAdminDeletePromoCode = async (req: Request, res: Response) => {
  await ensureFirestoreSeeded();
  const token = extractBearerToken(req)!;
  const session =
    activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
  const rawCode = String(req.params?.code || req.body?.code || '')
    .trim()
    .toUpperCase();
  if (!rawCode) {
    res.status(400).json({ ok: false, error: 'Kode redeem tidak valid.' });
    return;
  }

  promoCodesMap.delete(rawCode);
  const auditEntry = recordAdminAudit(
    session.username,
    'DELETE_REDEEM_CODE',
    rawCode,
    'DELETED',
    `Deleted redeem code ${rawCode}`
  );

  await Promise.all([
    deleteServerDoc('server_promo_codes', sanitizeAccountKey(rawCode)),
    setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry),
  ]).catch(() => {});

  res.json({
    ok: true,
    code: rawCode,
    message: `Kode Redeem ${rawCode} berhasil dihapus.`,
    promoCodes: Array.from(promoCodesMap.values()),
  });
};

app.post(
  '/api/admin/promo/delete',
  requireAdminAuth,
  handleAdminDeletePromoCode
);
app.delete(
  '/api/admin/promo/:code',
  requireAdminAuth,
  handleAdminDeletePromoCode
);

app.post(
  '/api/admin/config/save',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    await ensureFirestoreSeeded();
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const nowIso = new Date().toISOString();
    const existingCfg =
      (await getServerDoc<Record<string, any>>('server_config', 'app_config').catch(
        () => null
      )) || {};

    const promoSyncWrites: Promise<void>[] = [];
    if (Array.isArray(req.body?.rewardCodes)) {
      for (const rc of req.body.rewardCodes) {
        const cleanCode = String(rc?.code || '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9_-]/g, '');
        if (!cleanCode) continue;
        const prevPromo = promoCodesMap.get(cleanCode);
        const quotaVal = Math.max(
          1,
          Math.floor(Number(rc?.maxClaims || rc?.quota || 100))
        );
        const promoRec: ServerPromoCodeRecord = {
          code: cleanCode,
          description: String(rc?.description || `Kode Redeem ${cleanCode}`),
          coinReward: Math.max(0, Math.floor(Number(rc?.coinReward || 0))),
          fireReward: Math.max(0, Math.floor(Number(rc?.fireReward || 0))),
          quota: quotaVal,
          maxClaims: quotaVal,
          claimedCount: prevPromo
            ? Number(prevPromo.claimedCount || 0)
            : Math.max(0, Math.floor(Number(rc?.claimedCount || 0))),
          expiresAt: rc?.expiresAt ? String(rc.expiresAt) : prevPromo?.expiresAt || null,
          isActive: rc?.isActive !== undefined ? Boolean(rc.isActive) : true,
          createdBy: prevPromo?.createdBy || session.username,
          createdAt: prevPromo?.createdAt || nowIso,
          updatedAt: nowIso,
        };
        promoCodesMap.set(cleanCode, promoRec);
        promoSyncWrites.push(
          setServerDoc(
            'server_promo_codes',
            sanitizeAccountKey(cleanCode),
            promoRec
          )
        );
      }
    }

    const updatedCfg: Record<string, any> = {
      ...existingCfg,
      docKey: 'app_config',
      ...(req.body?.tasks !== undefined ? { tasks: req.body.tasks } : {}),
      ...(req.body?.levels !== undefined ? { levels: req.body.levels } : {}),
      ...(req.body?.rewardCodes !== undefined
        ? { rewardCodes: req.body.rewardCodes }
        : {}),
      ...(req.body?.settings !== undefined ? { settings: req.body.settings } : {}),
      updatedBy: session.username,
      updatedAt: nowIso,
    };

    const auditEntry = recordAdminAudit(
      session.username,
      'SAVE_APP_CONFIG',
      'GLOBAL',
      'UPDATED',
      'Admin updated application configuration (tasks/levels/codes/settings)'
    );

    await Promise.all([
      setServerDoc('server_config', 'app_config', updatedCfg),
      setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry),
      ...promoSyncWrites,
    ]).catch(() => {});

    res.json({ ok: true, config: updatedCfg });
  }
);

app.post(
  '/api/admin/reset-user-data',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;

    // Collect keys to delete from Firestore before clearing in-memory maps
    const deleteTasks: Promise<void>[] = [];
    userAccountsMap.forEach((acc, key) => {
      deleteTasks.push(
        deleteServerDoc('server_user_accounts', sanitizeAccountKey(key)).catch(
          () => {}
        )
      );
      if (acc.usernameLower) {
        deleteTasks.push(
          deleteServerDoc(
            'server_user_accounts',
            sanitizeAccountKey(acc.usernameLower)
          ).catch(() => {})
        );
      }
    });
    userStateLedger.forEach((_, uid) => {
      deleteTasks.push(
        deleteServerDoc('server_user_states', uid).catch(() => {})
      );
      deleteTasks.push(
        deleteServerDoc('server_event_cooldowns', sanitizeAccountKey(uid)).catch(
          () => {}
        )
      );
    });
    serverWithdrawalsMap.forEach((_, wdId) => {
      deleteTasks.push(
        deleteServerDoc('server_withdrawals', wdId).catch(() => {})
      );
    });
    serverUpgradeOrdersMap.forEach((_, ordId) => {
      deleteTasks.push(
        deleteServerDoc('server_upgrade_orders', ordId).catch(() => {})
      );
    });
    referralMilestonesMap.forEach((_, refId) => {
      deleteTasks.push(
        deleteServerDoc('server_referrals', refId).catch(() => {})
      );
    });
    serverCreatorSubmissionsMap.forEach((_, subId) => {
      deleteTasks.push(
        deleteServerDoc('server_creator_submissions', subId).catch(() => {})
      );
    });
    vipOrdersMap.forEach((_, voId) => {
      deleteTasks.push(
        deleteServerDoc('server_vip_orders', voId).catch(() => {})
      );
    });
    serverTransactionsLedger.forEach((tx) => {
      if (tx?.id) {
        deleteTasks.push(
          deleteServerDoc('server_transactions', tx.id).catch(() => {})
        );
      }
    });
    await Promise.all(deleteTasks).catch(() => {});

    // Clear all in-memory user/player collections while preserving Admin, QRIS, and system config
    userAccountsMap.clear();
    userStateLedger.clear();
    serverWithdrawalsMap.clear();
    serverUpgradeOrdersMap.clear();
    referralMilestonesMap.clear();
    boundReferralsMap.clear();
    serverCreatorSubmissionsMap.clear();
    vipOrdersMap.clear();
    serverTransactionsLedger.splice(0, serverTransactionsLedger.length);
    serverNotificationsLedger.splice(0, serverNotificationsLedger.length);
    bugReportsLedger.splice(0, bugReportsLedger.length);
    suspiciousTapsLedger.splice(0, suspiciousTapsLedger.length);
    eventCooldownsMap.clear();
    claimedTaskIdsSet.clear();
    processedWithdrawalsSet.clear();
    processedUpgradeReferralOrdersSet.clear();
    processedDiamondChallengesSet.clear();
    dailyConversionLedger.clear();
    dailyClaimsLedger.clear();
    activeUserSessions.clear();
    telegramUserIdToUidMap.clear();
    apkInstallTokenToUidMap.clear();
    lastFirestoreHydrationMs = Date.now();

    const auditEntry = recordAdminAudit(
      session.username,
      'PRELAUNCH_USER_DATA_RESET',
      'ALL_USERS',
      'TOTAL_USERS=0',
      'Reset seluruh data user, saldo, transaksi, dan withdrawal untuk persiapan launching'
    );
    await setServerDoc(
      'server_admin_audits',
      auditEntry.auditId,
      auditEntry
    ).catch(() => {});

    res.json({
      ok: true,
      totalUsers: 0,
      totalWithdrawals: 0,
      totalTransactions: 0,
      totalCoins: 0,
      totalDiamonds: 0,
      message:
        'Seluruh data user, saldo, transaksi, dan withdrawal berhasil di-reset ke 0.',
    });
  }
);

app.post('/api/game/profile/save', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  if (!uid) {
    res.status(400).json({ ok: false, error: 'UID tidak valid.' });
    return;
  }
  const nowIso = new Date().toISOString();
  const userState = await loadAndSyncServerUserStateFromFirestore(uid);
  if (req.body?.username) {
    userState.username = String(req.body.username).trim().slice(0, 50) || userState.username;
  }
  if (req.body?.fullName !== undefined) {
    userState.fullName = String(req.body.fullName).trim().slice(0, 80);
  }
  if (req.body?.phone !== undefined) {
    userState.phone = String(req.body.phone).trim().slice(0, 20);
  }
  if (req.body?.defaultEwallet !== undefined) {
    userState.defaultEwallet = String(req.body.defaultEwallet).trim();
  }
  if (req.body?.ewalletNumber !== undefined) {
    userState.ewalletNumber = normalizeIndoPhone(String(req.body.ewalletNumber));
  }
  if (req.body?.ewalletAccountName !== undefined) {
    userState.ewalletAccountName = String(req.body.ewalletAccountName).trim().slice(0, 80);
  }
  if (req.body?.pinHash !== undefined) {
    userState.pinHash = String(req.body.pinHash).trim().slice(0, 120);
  }
  if (req.body?.notificationsEnabled !== undefined) {
    userState.notificationsEnabled = Boolean(req.body.notificationsEnabled);
  }
  userState.updatedAt = nowIso;
  userStateLedger.set(uid, userState);
  await persistUserStateToFirestore(userState).catch(() => {});

  res.json({
    ok: true,
    profile: {
      uid,
      fullName: userState.fullName || userState.username || '',
      phone: userState.phone || userState.ewalletNumber || '',
      defaultEwallet: userState.defaultEwallet || 'DANA',
      ewalletNumber: userState.ewalletNumber || '',
      ewalletAccountName: userState.ewalletAccountName || '',
      pinHash: userState.pinHash || '',
      notificationsEnabled: userState.notificationsEnabled ?? true,
      updatedAt: nowIso,
    },
  });
});

// ============================================================================
// SERVER-SIDE REFERRAL BINDING (JOINING ALONE GRANTS 0 REWARD UNTIL ACTIVE/TOPUP/UPGRADE)
// ============================================================================
app.post('/api/game/referral/bind', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  const ownReferralCode = String(req.body?.ownReferralCode || '')
    .trim()
    .toUpperCase();
  const inviterCode = String(req.body?.inviterCode || '')
    .trim()
    .toUpperCase();
  const alreadyBoundCode = String(req.body?.alreadyBoundCode || '')
    .trim()
    .toUpperCase();

  if (!uid) {
    res
      .status(400)
      .json({ ok: false, error: 'Identitas pengguna tidak valid.' });
    return;
  }

  if (!inviterCode || !/^[A-Z0-9_-]{4,16}$/.test(inviterCode)) {
    res.status(400).json({
      ok: false,
      error: 'Format kode undangan tidak valid (4-16 karakter huruf/angka).',
    });
    return;
  }

  if (inviterCode === ownReferralCode) {
    res.status(400).json({
      ok: false,
      error:
        'Tidak dapat menggunakan kode undangan milik sendiri (Self-referral ditolak).',
    });
    return;
  }

  const userState = await loadAndSyncServerUserStateFromFirestore(uid);
  const serverExisting =
    userState.boundReferralCode || boundReferralsMap.get(uid) || alreadyBoundCode;
  if (serverExisting) {
    res.status(400).json({
      ok: false,
      error: `Akun Anda sudah terhubung dengan kode pengundang (${serverExisting}).`,
    });
    return;
  }

  const inviterAcc = await findInviterByReferralCodeFromFirestore(inviterCode);
  if (!inviterAcc || inviterAcc.uid === uid) {
    res.status(400).json({
      ok: false,
      error: 'Kode undangan tidak ditemukan di sistem COINOVA.',
    });
    return;
  }

  const nowIso = new Date().toISOString();
  boundReferralsMap.set(uid, inviterCode);
  userState.boundReferralCode = inviterCode;
  userState.referredByCode = inviterCode;
  userState.referredByUid = inviterAcc.uid;
  userState.updatedAt = nowIso;
  const writes: Promise<void>[] = [persistUserStateToFirestore(userState)];

  const refId = `ref_${inviterAcc.uid}_${uid}`;
  const refRecord: ReferralMilestoneState = {
    referralId: refId,
    inviterUid: inviterAcc.uid,
    inviteeUid: uid,
    inviteeUsername: userState.username || 'Member',
    inviterCode,
    rewardCoin: serverEconomicConfig.referralTopupCoinReward || 25000,
    rewardFire: serverEconomicConfig.referralActiveFireReward || 2,
    rewardIdr: serverEconomicConfig.referralTopupCoinReward || 25000,
    status: 'PENDING',
    activeRewardClaimed: false,
    topupRewardClaimed: false,
    upgradeRewardClaimed: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  referralMilestonesMap.set(refId, refRecord);
  writes.push(setServerDoc('server_referrals', refId, refRecord));
  await Promise.all(writes).catch(() => {});

  // Rule A: Invited user joins but is not active = 0 Coin, 0 Diamond
  res.json({
    ok: true,
    inviterCode,
    inviterUid: inviterAcc.uid,
    referral: refRecord,
    status: 'PENDING',
    welcomeBonusCoins: 0,
    welcomeBonusFire: 0,
    message:
      'Kode undangan berhasil terhubung (Status: PENDING). Reward referral diberikan otomatis setelah akun aktif / top-up / upgrade level valid.',
    boundAt: nowIso,
  });
});

// ============================================================================
// 9. SERVER-SIDE CONVERSION VALIDATION (LEVEL 4 & LEVEL 5 ONLY — 403 FOR LV.1-3)
// ============================================================================
app.get(
  '/api/game/convert-quota/:uid',
  async (req: Request, res: Response) => {
    const uid = String(req.params.uid || '').trim();
    const today = getServerTodayKey();
    const ledgerKey = `${uid}_${today}`;
    const maxDaily = serverEconomicConfig.maxDailyFireConvert;
    const state = uid
      ? await loadAndSyncServerUserStateFromFirestore(uid)
      : null;
    const usedToday = Math.min(
      maxDaily,
      Math.max(
        dailyConversionLedger.get(ledgerKey) || 0,
        state?.lastConvertDate === today ? state.dailyConvertedFire : 0
      )
    );
    res.json({
      ok: true,
      today,
      usedToday,
      remainingDailyFireQuota: Math.max(0, maxDaily - usedToday),
    });
  }
);

app.post('/api/game/validate-convert', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  const fireToObtain = Math.floor(Number(req.body?.fireToObtain || 0));
  const clientCoinBalance = Math.floor(Number(req.body?.coinBalance || 0));
  const clientUsedToday = Math.max(
    0,
    Math.floor(Number(req.body?.usedToday || 0))
  );
  const clientLevel = Math.floor(Number(req.body?.dragonLevel || 1));

  if (!uid) {
    res
      .status(400)
      .json({ ok: false, error: 'Identitas pengguna tidak valid.' });
    return;
  }

  const userState = await loadAndSyncServerUserStateFromFirestore(uid);

  // Authoritative check: ONLY TOP 2 TIERS (Lv.4 Pro & Lv.5 Ultimate) can convert
  if (userState.dragonLevel < MIN_LEVEL_FOR_CONVERSION) {
    res.status(403).json({
      ok: false,
      error:
        'Akses ditolak (403): Fitur Konversi Koin ke Diamond hanya tersedia untuk 2 Level Tertinggi (Level 4 Pro & Level 5 Ultimate).',
    });
    return;
  }

  if (fireToObtain < 1) {
    res.status(400).json({
      ok: false,
      error: `Minimal konversi adalah ${serverEconomicConfig.coinsPerFireConvert.toLocaleString('id-ID')} Koin (1 Diamond).`,
    });
    return;
  }

  const today = getServerTodayKey();
  const ledgerKey = `${uid}_${today}`;
  const maxDaily = serverEconomicConfig.maxDailyFireConvert;
  const serverUsedToday = Math.max(
    dailyConversionLedger.get(ledgerKey) || 0,
    userState.lastConvertDate === today ? userState.dailyConvertedFire : 0
  );

  if (
    serverUsedToday >= maxDaily ||
    serverUsedToday + fireToObtain > maxDaily
  ) {
    res.status(400).json({
      ok: false,
      error: `Batas konversi hari ini telah tercapai. Maksimal ${maxDaily} Diamond per hari.`,
    });
    return;
  }

  const coinsRequired =
    fireToObtain * serverEconomicConfig.coinsPerFireConvert;
  const availableCoins = userState.coinBalance;
  if (availableCoins < coinsRequired) {
    res.status(400).json({
      ok: false,
      error: 'Koin Anda tidak mencukupi untuk konversi ini.',
    });
    return;
  }

  const nextUsed = serverUsedToday + fireToObtain;
  const nextCoinBalance = Math.max(0, availableCoins - coinsRequired);

  userState.coinBalance = nextCoinBalance;
  userState.fireBalance = Math.max(0, userState.fireBalance + fireToObtain);
  userState.lastConvertDate = today;
  userState.dailyConvertedFire = nextUsed;
  userState.updatedAt = new Date().toISOString();

  dailyConversionLedger.set(ledgerKey, nextUsed);
  userStateLedger.set(uid, userState);

  const txEntry = recordLedgerTransaction({
    uid,
    category: 'KONVERSI',
    direction: 'DEBIT',
    currency: 'COIN',
    amount: coinsRequired,
    description: `Konversi ${coinsRequired.toLocaleString('id-ID')} Koin -> +${fireToObtain} Diamond`,
    referenceId: `conv_${Date.now()}`,
  });

  await Promise.all([
    persistUserStateToFirestore(userState),
    setServerDoc('server_transactions', txEntry.id, txEntry),
  ]).catch(() => {});

  res.json({
    ok: true,
    today,
    fireGained: fireToObtain,
    coinsSpent: coinsRequired,
    coinBalance: nextCoinBalance,
    fireBalance: userState.fireBalance,
    nextCoinBalance,
    nextIdrBalance: nextCoinBalance,
    dailyConvertedFire: nextUsed,
    remainingDailyFireQuota: Math.max(0, maxDaily - nextUsed),
    transaction: txEntry,
  });
});

// ============================================================================
// 12. SERVER-SIDE WITHDRAWAL VALIDATION (20K - 1JT KOIN + DIAMOND MAPPING)
// ============================================================================
const handleValidateOrRequestWithdraw = async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  const requestId = String(req.body?.requestId || '').trim();
  const amountCoins = Math.floor(
    Number(
      req.body?.amountCoins ||
        req.body?.amountIdr ||
        req.body?.coinCost ||
        (req.body?.amount ? Number(req.body.amount) : 0) ||
        0
    )
  );

  const coinBalance = Math.floor(Number(req.body?.coinBalance || 0));
  const method = String(req.body?.method || '');
  const accountNumber = normalizeIndoPhone(
    String(req.body?.accountNumber || '')
  );
  const accountName = String(req.body?.accountName || '').trim();

  if (!uid) {
    res.status(400).json({ ok: false, error: 'Identitas user tidak valid.' });
    return;
  }

  if (inFlightWithdrawUserLocks.has(uid)) {
    res.status(409).json({
      ok: false,
      error: 'Permintaan penarikan Anda sedang diproses. Mohon tunggu sebentar.',
    });
    return;
  }

  inFlightWithdrawUserLocks.add(uid);
  try {
    if (requestId) {
      if (processedWithdrawalsSet.has(requestId)) {
        res.status(409).json({
          ok: false,
          error: 'Permintaan penarikan ini sedang diproses (duplikasi dicegah).',
        });
        return;
      }
      const existingWd = await getServerDoc(
        'server_withdrawals',
        requestId
      ).catch(() => null);
      if (existingWd) {
        processedWithdrawalsSet.add(requestId);
        res.status(409).json({
          ok: false,
          error: 'Permintaan penarikan ini sedang diproses (duplikasi dicegah).',
        });
        return;
      }
    }

    // Prevent duplicate pending withdrawals / double-click exploits for the same user
    const existingUserPending = Array.from(serverWithdrawalsMap.values()).find(
      (w) =>
        w.uid === uid &&
        (w.status === 'PENDING' || w.status === 'PROCESSING')
    );
    if (existingUserPending) {
      res.status(400).json({
        ok: false,
        error:
          'Anda masih memiliki permintaan penarikan berstatus PENDING yang sedang diverifikasi Admin.',
      });
      return;
    }

    if (!['DANA', 'GoPay', 'OVO', 'ShopeePay'].includes(method)) {
      res.status(400).json({ ok: false, error: 'Metode E-Wallet tidak valid.' });
      return;
    }
    if (!isValidEWalletNumber(accountNumber)) {
      res.status(400).json({
        ok: false,
        error: `Nomor akun ${method} tidak valid. Gunakan format nomor HP aktif (contoh: 081234567890, 10-14 digit).`,
      });
      return;
    }
    if (accountName.length < 2 || accountName.length > 80) {
      res.status(400).json({
        ok: false,
        error:
          'Nama lengkap pemilik akun E-Wallet wajib diisi (minimal 2 karakter).',
      });
      return;
    }

    const requiredFire = WITHDRAWAL_DIAMOND_MAP[amountCoins];
    if (!VALID_WITHDRAW_COIN_TIERS.includes(amountCoins) || !requiredFire) {
      res.status(400).json({
        ok: false,
        error:
          'Nominal penarikan harus salah satu paket Koin resmi (20.000, 50.000, 100.000, 200.000, 500.000, atau 1.000.000 Koin).',
      });
      return;
    }

    const userState = await loadAndSyncServerUserStateFromFirestore(uid);

    const effectiveCoins = userState.coinBalance;
    const effectiveFire = userState.fireBalance;

    if (effectiveCoins < amountCoins) {
      res.status(400).json({
        ok: false,
        error: `Koin tidak mencukupi. Butuh ${amountCoins.toLocaleString('id-ID')} Koin (Saldo Server: ${effectiveCoins.toLocaleString('id-ID')} Koin).`,
      });
      return;
    }

    if (effectiveFire < requiredFire) {
      res.status(400).json({
        ok: false,
        error: `Syarat Diamond belum mencukupi (${effectiveFire.toLocaleString('id-ID')}/${requiredFire.toLocaleString('id-ID')} Diamond). Penarikan ${amountCoins.toLocaleString('id-ID')} Koin membutuhkan ${requiredFire.toLocaleString('id-ID')} Diamond.`,
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const nextCoinBalance = Math.max(0, effectiveCoins - amountCoins);
    const nextFireBalance = Math.max(0, effectiveFire - requiredFire);
    userState.coinBalance = nextCoinBalance;
    userState.fireBalance = nextFireBalance;
    userState.lockedIdrBalance = Math.max(
      0,
      userState.lockedIdrBalance + amountCoins
    );
    userState.defaultEwallet = method;
    userState.ewalletNumber = accountNumber;
    userState.ewalletAccountName = accountName;
    userState.updatedAt = nowIso;
    userStateLedger.set(uid, userState);

    const wdId =
      requestId ||
      `wd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    processedWithdrawalsSet.add(wdId);

    const isUserVipNow = Boolean(
      userState.vipExpiresAt &&
        new Date(userState.vipExpiresAt).getTime() > Date.now()
    );

    const matchedAccForWd = findAccountByUidInMemory(uid);
    const resolvedWdUsername =
      matchedAccForWd?.username ||
      (!isPlaceholderUsername(userState.username)
        ? userState.username!
        : undefined) ||
      (!isPlaceholderUsername(req.body?.username)
        ? String(req.body.username).trim()
        : undefined) ||
      accountName ||
      uid;

    const wdRecord: ServerWithdrawalRecord = {
      withdrawalId: wdId,
      uid,
      username: resolvedWdUsername,
      method,
      accountNumber,
      accountName,
      amount: amountCoins,
      lockedCoins: amountCoins,
      coinDeducted: amountCoins,
      fireDeducted: requiredFire,
      isVipPriority: isUserVipNow,
      status: 'PENDING',
      paymentReference: '',
      adminNote:
        'Menunggu verifikasi pencairan manual ke E-Wallet (Maks. 3x24 jam)',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    serverWithdrawalsMap.set(wdId, wdRecord);

    const txEntry = recordLedgerTransaction({
      uid,
      category: 'WITHDRAWAL',
      direction: 'HOLD',
      currency: 'COIN',
      amount: amountCoins,
      description: `Penarikan ${amountCoins.toLocaleString('id-ID')} Koin (& -${requiredFire.toLocaleString('id-ID')} Diamond) ke ${method} (${accountNumber} a/n ${accountName})${isUserVipNow ? ' [PRIORITAS VIP]' : ''}`,
      referenceId: wdId,
    });

    const wdNotif: ServerNotificationRecord = {
      id: `notif_wd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      uid,
      title: isUserVipNow
        ? '⚡ Penarikan Prioritas VIP Diajukan'
        : 'Permintaan Penarikan Diajukan',
      message: `Penarikan ${amountCoins.toLocaleString('id-ID')} Koin ke ${method} sedang diproses${isUserVipNow ? ' dengan Prioritas Antrean VIP' : ''}. Estimasi maksimal 3x24 jam.`,
      type: 'INFO',
      category: 'WITHDRAWAL',
      isRead: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    serverNotificationsLedger.unshift(wdNotif);

    await Promise.all([
      persistUserStateToFirestore(userState),
      setServerDoc('server_transactions', txEntry.id, txEntry),
      setServerDoc('server_notifications', wdNotif.id, wdNotif),
      setServerDoc('server_withdrawals', wdId, wdRecord),
    ]).catch(() => {});

    res.json({
      ok: true,
      withdrawalId: wdId,
      withdrawal: {
        ...wdRecord,
        id: wdId,
      },
      transaction: txEntry,
      amountCoins,
      amountIdr: amountCoins,
      normalizedAccountNumber: accountNumber,
      accountName,
      coinsSpent: amountCoins,
      fireSpent: requiredFire,
      isVipPriority: isUserVipNow,
      nextCoinBalance,
      nextIdrBalance: nextCoinBalance,
      nextFireBalance,
      lockedIdrBalance: userState.lockedIdrBalance,
    });
  } finally {
    inFlightWithdrawUserLocks.delete(uid);
  }
};

app.post('/api/game/validate-withdraw', handleValidateOrRequestWithdraw);
app.post('/api/game/withdraw/request', handleValidateOrRequestWithdraw);
app.post('/api/game/withdraw', handleValidateOrRequestWithdraw);

// ============================================================================
// SERVER-SIDE UPGRADE ORDER & PAYMENT PROOF VALIDATION
// ============================================================================
app.post(
  '/api/game/validate-upgrade-order',
  async (req: Request, res: Response) => {
    const uid = String(req.body?.uid || '').trim();
    const username = String(req.body?.username || '').trim();
    const targetLevel = Math.floor(Number(req.body?.targetLevel || 0));
    const currentLevel = Math.floor(Number(req.body?.currentLevel || 1));
    const paymentMethod = String(req.body?.paymentMethod || 'QRIS');
    const levelName = String(
      req.body?.levelName || `Level ${targetLevel}`
    ).trim();

    if (!uid || targetLevel < 2 || targetLevel > 5) {
      res.status(400).json({
        ok: false,
        error: 'Level tujuan tidak valid (hanya Level 2 - Level 5).',
      });
      return;
    }

    if (targetLevel <= currentLevel) {
      res.status(400).json({
        ok: false,
        error: 'Level tersebut sudah aktif pada akun Anda.',
      });
      return;
    }

    if (!['QRIS', 'DANA', 'GoPay', 'OVO', 'ShopeePay'].includes(paymentMethod)) {
      res.status(400).json({
        ok: false,
        error: 'Metode pembayaran tidak didukung.',
      });
      return;
    }

    const verifiedPriceIdr = OFFICIAL_LEVEL_PRICES[targetLevel] || 25000;
    const nowIso = new Date().toISOString();
    const orderId =
      String(req.body?.orderId || '').trim() ||
      `ord_lvl${targetLevel}_${Date.now()}`;
    const userState = await loadAndSyncServerUserStateFromFirestore(uid);

    const newOrder: ServerUpgradeOrderRecord = {
      orderId,
      uid,
      username: username || userState.username || 'Member',
      targetLevel,
      levelName,
      priceIdr: verifiedPriceIdr,
      paymentMethod,
      paymentReference: '-',
      paymentProofDataUrl: '',
      paymentProofImage: '',
      paymentProofFileName: '',
      paidSubmittedAt: '',
      status: 'WAITING_PAYMENT',
      adminNote: `PENDING PAYMENT — Silakan scan QRIS Rp${verifiedPriceIdr.toLocaleString('id-ID')} dan unggah bukti pembayaran.`,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    serverUpgradeOrdersMap.set(orderId, newOrder);
    await setServerDoc('server_upgrade_orders', orderId, newOrder).catch(
      () => {}
    );

    res.json({
      ok: true,
      orderId,
      order: newOrder,
      verifiedPriceIdr,
      status: 'WAITING_PAYMENT',
    });
  }
);

app.post(
  '/api/game/submit-upgrade-proof',
  async (req: Request, res: Response) => {
    const uid = String(req.body?.uid || '').trim();
    const orderId = String(req.body?.orderId || '').trim();
    const paymentReference =
      String(req.body?.paymentReference || '').trim() ||
      `QRIS-${Date.now().toString().slice(-6)}`;
    const paymentProofImage = String(
      req.body?.paymentProofDataUrl || req.body?.paymentProofImage || ''
    ).trim();
    const paymentProofFileName = String(
      req.body?.paymentProofFileName || 'bukti_qris.jpg'
    ).trim();

    if (!uid || !orderId) {
      res.status(400).json({ ok: false, error: 'Data order tidak valid.' });
      return;
    }

    if (!paymentProofImage && paymentReference.length < 3) {
      res.status(400).json({
        ok: false,
        error:
          'Wajib mengunggah foto/screenshot bukti pembayaran atau mengisi referensi transaksi.',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const userState = await loadAndSyncServerUserStateFromFirestore(uid);
    const existing = serverUpgradeOrdersMap.get(orderId);
    const targetLevel =
      existing?.targetLevel ||
      Math.max(2, Math.min(5, Number(req.body?.targetLevel || 2)));
    const priceIdr =
      existing?.priceIdr || OFFICIAL_LEVEL_PRICES[targetLevel] || 25000;

    const updatedOrder: ServerUpgradeOrderRecord = {
      orderId,
      uid,
      username: existing?.username || userState.username || 'Member',
      targetLevel,
      levelName: existing?.levelName || `Level ${targetLevel}`,
      priceIdr,
      paymentMethod: existing?.paymentMethod || 'QRIS',
      paymentReference,
      paymentProofDataUrl: paymentProofImage.slice(0, 750000),
      paymentProofImage: paymentProofImage.slice(0, 750000),
      paymentProofFileName,
      paidSubmittedAt: nowIso,
      status: 'PENDING_VERIFICATION',
      adminNote: `PAYMENT SUBMITTED / UNDER REVIEW — Bukti pembayaran (${paymentReference}) sedang diverifikasi Admin.`,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    serverUpgradeOrdersMap.set(orderId, updatedOrder);
    await setServerDoc('server_upgrade_orders', orderId, updatedOrder).catch(
      () => {}
    );

    res.json({
      ok: true,
      orderId,
      order: updatedOrder,
      paymentReference,
      paidSubmittedAt: nowIso,
      submittedAt: nowIso,
      status: 'PENDING_VERIFICATION',
    });
  }
);

// ============================================================================
// SERVER-SIDE BUG REPORT SUBMISSION & HISTORY ENDPOINTS
// ============================================================================
app.post('/api/game/bug-report', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  const username = String(req.body?.username || 'User').trim();
  const description = String(req.body?.description || '').trim();
  const featureArea = String(
    req.body?.featureArea || 'Profile / Sistem COINOVA'
  ).trim();
  const appVersion = String(
    req.body?.appVersion || 'COINOVA OS v2.4.0'
  ).trim();
  const screenshotDataUrl = String(req.body?.screenshotDataUrl || '').trim();
  const screenshotFileName = String(req.body?.screenshotFileName || '').trim();
  const reportedAt = String(
    req.body?.reportedAt || new Date().toISOString()
  ).trim();

  if (!uid) {
    res.status(400).json({ ok: false, error: 'User ID tidak valid.' });
    return;
  }

  if (description.length < 5) {
    res.status(400).json({
      ok: false,
      error: 'Mohon jelaskan detail bug yang dialami minimal 5 karakter.',
    });
    return;
  }

  const reportId = `BUG-${Date.now().toString().slice(-6)}-${Math.random()
    .toString(36)
    .substring(2, 5)
    .toUpperCase()}`;

  const record: BugReportRecord = {
    reportId,
    uid,
    username: username.slice(0, 60),
    description: description.slice(0, 2000),
    featureArea: featureArea.slice(0, 100),
    appVersion: appVersion.slice(0, 60),
    hasScreenshot: Boolean(screenshotDataUrl),
    screenshotFileName: screenshotFileName.slice(0, 120),
    screenshotDataUrl: screenshotDataUrl
      ? screenshotDataUrl.slice(0, 500000)
      : '',
    status: 'RECEIVED',
    reportedAt,
  };

  bugReportsLedger.unshift(record);
  await setServerDoc('server_bug_reports', reportId, record).catch(() => {});

  res.json({
    ok: true,
    report: record,
  });
});

app.get('/api/game/bug-reports/:uid', async (req: Request, res: Response) => {
  const uid = String(req.params.uid || '').trim();
  try {
    const remoteList = await queryServerDocsByField<BugReportRecord>(
      'server_bug_reports',
      'uid',
      uid,
      25
    );
    if (remoteList.length > 0) {
      res.json({ ok: true, reports: remoteList });
      return;
    }
  } catch {
    // fallback to memory
  }
  const list = bugReportsLedger.filter((r) => r.uid === uid).slice(0, 25);
  res.json({
    ok: true,
    reports: list,
  });
});

// ============================================================================
// 12B. COINOVA VIP, BROADCAST, NOTIFICATIONS & DAILY EVENTS (MYSTERY BOX & LUCKY SPIN)
// ============================================================================
const VIP_PRICE_IDR = 100000;
const VIP_DURATION_DAYS = 30;
const VIP_MONTHLY_DIAMOND_BONUS = 50;
const FREE_EVENT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours for Free
const VIP_EVENT_COOLDOWN_MS = 18 * 60 * 60 * 1000; // 18 hours faster cooldown for VIP

function resolveUserVipState(state: ServerUserState): {
  isVip: boolean;
  vipStatus: 'NONE' | 'PENDING' | 'ACTIVE' | 'EXPIRED';
  vipStartedAt: string | null;
  vipExpiresAt: string | null;
  pendingOrder: ServerVipOrderRecord | null;
} {
  let pendingOrder: ServerVipOrderRecord | null = null;
  vipOrdersMap.forEach((ord) => {
    if (ord.uid === state.uid && ord.status === 'PENDING_VERIFICATION') {
      if (
        !pendingOrder ||
        new Date(ord.createdAt).getTime() >
          new Date(pendingOrder.createdAt).getTime()
      ) {
        pendingOrder = ord;
      }
    }
  });

  if (state.vipExpiresAt) {
    const expMs = new Date(state.vipExpiresAt).getTime();
    if (Number.isFinite(expMs) && expMs > Date.now()) {
      state.vipStatus = 'ACTIVE';
      return {
        isVip: true,
        vipStatus: 'ACTIVE',
        vipStartedAt: state.vipStartedAt || null,
        vipExpiresAt: state.vipExpiresAt,
        pendingOrder,
      };
    }
    if (Number.isFinite(expMs) && expMs <= Date.now()) {
      state.vipStatus = pendingOrder ? 'PENDING' : 'EXPIRED';
      return {
        isVip: false,
        vipStatus: pendingOrder ? 'PENDING' : 'EXPIRED',
        vipStartedAt: state.vipStartedAt || null,
        vipExpiresAt: state.vipExpiresAt,
        pendingOrder,
      };
    }
  }

  if (pendingOrder) {
    state.vipStatus = 'PENDING';
    return {
      isVip: false,
      vipStatus: 'PENDING',
      vipStartedAt: state.vipStartedAt || null,
      vipExpiresAt: state.vipExpiresAt || null,
      pendingOrder,
    };
  }

  return {
    isVip: false,
    vipStatus: state.vipStatus === 'EXPIRED' ? 'EXPIRED' : 'NONE',
    vipStartedAt: state.vipStartedAt || null,
    vipExpiresAt: state.vipExpiresAt || null,
    pendingOrder: null,
  };
}

function getEventCooldownMsForUser(isVip: boolean): number {
  return isVip ? VIP_EVENT_COOLDOWN_MS : FREE_EVENT_COOLDOWN_MS;
}

function pushServerNotification(
  uid: string,
  title: string,
  message: string,
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'REWARD' = 'INFO',
  category:
    | 'VIP'
    | 'WITHDRAWAL'
    | 'MISSION'
    | 'EVENT'
    | 'BROADCAST'
    | 'SYSTEM' = 'SYSTEM'
): ServerNotificationRecord {
  const nowIso = new Date().toISOString();
  const notif: ServerNotificationRecord = {
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    uid,
    title,
    message,
    type,
    category,
    isRead: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  serverNotificationsLedger.unshift(notif);
  if (serverNotificationsLedger.length > 500) {
    serverNotificationsLedger.pop();
  }
  setServerDoc('server_notifications', notif.id, notif).catch(() => {});
  return notif;
}

function buildFeatureStatusPayload(state: ServerUserState) {
  const nowMs = Date.now();
  const vipInfo = resolveUserVipState(state);
  const cooldownMs = getEventCooldownMsForUser(vipInfo.isVip);
  const cdRec = eventCooldownsMap.get(state.uid);

  const lastBoxMs = Math.max(
    0,
    Number(state.lastMysteryBoxClaimMs || 0),
    Number(cdRec?.lastMysteryBoxClaimMs || 0)
  );
  const boxElapsed = nowMs - lastBoxMs;
  const mysteryBoxAvailable = lastBoxMs === 0 || boxElapsed >= cooldownMs;
  const nextMysteryBoxAvailableAt = mysteryBoxAvailable
    ? null
    : new Date(lastBoxMs + cooldownMs).toISOString();

  const lastSpinMs = Math.max(
    0,
    Number(state.lastLuckySpinMs || 0),
    Number(cdRec?.lastLuckySpinMs || 0)
  );
  const spinElapsed = nowMs - lastSpinMs;
  const luckySpinAvailable = lastSpinMs === 0 || spinElapsed >= cooldownMs;
  const nextLuckySpinAvailableAt = luckySpinAvailable
    ? null
    : new Date(lastSpinMs + cooldownMs).toISOString();

  const activeBroadcasts = Array.from(adminBroadcastsMap.values())
    .filter((b) => b.isActive)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  const userNotifs = serverNotificationsLedger
    .filter((n) => n.uid === state.uid || n.uid === 'ALL')
    .slice(0, 30);

  const broadcastNotifs: ServerNotificationRecord[] = activeBroadcasts.map(
    (b) => ({
      id: `bc_notif_${b.broadcastId}`,
      uid: state.uid,
      title: `📢 Pengumuman: ${b.title}`,
      message: b.content,
      type: 'INFO',
      category: 'BROADCAST',
      isRead: false,
      createdAt: b.updatedAt || b.createdAt,
      updatedAt: b.updatedAt || b.createdAt,
    })
  );

  return {
    uid: state.uid,
    mysteryBoxAvailable,
    lastMysteryBoxClaimAt: state.lastMysteryBoxClaimAt || null,
    nextMysteryBoxAvailableAt,
    luckySpinAvailable,
    lastLuckySpinAt: state.lastLuckySpinAt || null,
    nextLuckySpinAvailableAt,
    isVip: vipInfo.isVip,
    vipStatus: vipInfo.vipStatus,
    vipStartedAt: vipInfo.vipStartedAt,
    vipExpiresAt: vipInfo.vipExpiresAt,
    pendingVipOrder: vipInfo.pendingOrder,
    activeBroadcasts,
    notifications: [...broadcastNotifs, ...userNotifs].slice(0, 40),
    coinBalance: state.coinBalance,
    fireBalance: state.fireBalance,
  };
}

const handleGetFeaturesStatus = async (req: Request, res: Response) => {
  await ensureFirestoreSeeded();
  const uid = String(req.params.uid || req.query.uid || '').trim();
  if (!uid) {
    res.status(400).json({ ok: false, error: 'UID tidak valid.' });
    return;
  }
  const state = await loadAndSyncServerUserStateFromFirestore(
    uid,
    undefined,
    true
  );
  res.json({
    ok: true,
    ...buildFeatureStatusPayload(state),
  });
};

app.get('/api/game/features-status', handleGetFeaturesStatus);
app.get('/api/game/features-status/:uid', handleGetFeaturesStatus);

// ----------------------------------------------------------------------------
// 1. COINOVA VIP — USER ORDER (Rp100.000 / 30 HARI)
// ----------------------------------------------------------------------------
app.post('/api/game/vip/order', async (req: Request, res: Response) => {
  await ensureFirestoreSeeded();
  const uid = String(req.body?.uid || '').trim();
  const username = String(req.body?.username || 'Member').trim();
  const paymentMethod = String(req.body?.paymentMethod || 'QRIS').trim() as
    | 'QRIS'
    | 'DANA'
    | 'GoPay'
    | 'OVO'
    | 'ShopeePay';
  const paymentReference =
    String(req.body?.paymentReference || '').trim() ||
    `VIP-QRIS-${Date.now().toString().slice(-6)}`;
  const paymentProofDataUrl = String(
    req.body?.paymentProofDataUrl || ''
  ).trim();
  const paymentProofFileName = String(
    req.body?.paymentProofFileName || 'bukti_vip_qris.jpg'
  ).trim();

  if (!uid) {
    res.status(400).json({ ok: false, error: 'Identitas user tidak valid.' });
    return;
  }

  if (
    !paymentProofDataUrl ||
    !paymentProofDataUrl.startsWith('data:image/')
  ) {
    res.status(400).json({
      ok: false,
      error:
        'Wajib mengunggah screenshot bukti pembayaran QRIS Rp100.000 terlebih dahulu.',
    });
    return;
  }

  if (inFlightVipActionLocks.has(`order_${uid}`)) {
    res.status(429).json({
      ok: false,
      error: 'Permintaan VIP sedang diproses, mohon tunggu.',
    });
    return;
  }

  inFlightVipActionLocks.add(`order_${uid}`);
  try {
    const state = await loadAndSyncServerUserStateFromFirestore(uid);
    const vipInfo = resolveUserVipState(state);

    if (vipInfo.pendingOrder) {
      res.status(400).json({
        ok: false,
        error:
          'Anda sudah memiliki pembayaran VIP yang sedang menunggu verifikasi Admin.',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const orderId = `vip_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const record: ServerVipOrderRecord = {
      orderId,
      uid,
      username: username || state.username || 'Member',
      priceIdr: VIP_PRICE_IDR,
      durationDays: VIP_DURATION_DAYS,
      paymentMethod: ['QRIS', 'DANA', 'GoPay', 'OVO', 'ShopeePay'].includes(
        paymentMethod
      )
        ? paymentMethod
        : 'QRIS',
      paymentReference,
      paymentProofDataUrl: paymentProofDataUrl.slice(0, 750000),
      paymentProofFileName: paymentProofFileName.slice(0, 120),
      status: 'PENDING_VERIFICATION',
      adminNote: 'Menunggu verifikasi pembayaran VIP oleh Admin.',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    vipOrdersMap.set(orderId, record);
    if (!vipInfo.isVip) {
      state.vipStatus = 'PENDING';
      state.updatedAt = nowIso;
    }

    const notif = pushServerNotification(
      uid,
      '👑 Order COINOVA VIP Terkirim',
      'Bukti pembayaran COINOVA VIP Rp100.000/30 hari telah diterima dan sedang menunggu verifikasi Admin.',
      'INFO',
      'VIP'
    );

    await Promise.all([
      setServerDoc('server_vip_orders', orderId, record),
      persistUserStateToFirestore(state),
      setServerDoc('server_notifications', notif.id, notif),
    ]).catch(() => {});

    res.json({
      ok: true,
      message:
        'Bukti pembayaran COINOVA VIP berhasil dikirim! VIP akan aktif setelah diverifikasi Admin.',
      order: record,
      ...buildFeatureStatusPayload(state),
    });
  } finally {
    inFlightVipActionLocks.delete(`order_${uid}`);
  }
});

// ----------------------------------------------------------------------------
// 2. ADMIN VIP — LIST ORDERS, ACTIVE/EXPIRED MEMBERS & APPROVE/REJECT
// ----------------------------------------------------------------------------
app.get(
  '/api/admin/vip',
  requireAdminAuth,
  async (_req: Request, res: Response) => {
    await ensureFirestoreSeeded(true);
    const orders = Array.from(vipOrdersMap.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const members: Array<{
      uid: string;
      username: string;
      vipStatus: 'ACTIVE' | 'EXPIRED' | 'PENDING';
      isVip: boolean;
      vipStartedAt: string | null;
      vipExpiresAt: string | null;
      dragonLevel: number;
    }> = [];

    userStateLedger.forEach((st) => {
      const info = resolveUserVipState(st);
      if (info.vipStatus !== 'NONE' || st.vipExpiresAt) {
        members.push({
          uid: st.uid,
          username: st.username || st.uid,
          vipStatus:
            info.vipStatus === 'NONE' ? 'EXPIRED' : info.vipStatus,
          isVip: info.isVip,
          vipStartedAt: info.vipStartedAt,
          vipExpiresAt: info.vipExpiresAt,
          dragonLevel: st.dragonLevel,
        });
      }
    });

    res.json({
      ok: true,
      orders,
      members,
      vipUsers: members,
    });
  }
);

app.post(
  '/api/admin/vip/verify',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    await ensureFirestoreSeeded();
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const orderId = String(req.body?.orderId || '').trim();
    const decision = String(req.body?.decision || '').trim() as
      | 'APPROVED'
      | 'REJECTED';
    const adminNote = String(req.body?.adminNote || '').trim();

    if (!orderId || !['APPROVED', 'REJECTED'].includes(decision)) {
      res.status(400).json({
        ok: false,
        error: 'Parameter verifikasi VIP tidak valid.',
      });
      return;
    }

    const order = vipOrdersMap.get(orderId);
    if (!order) {
      res
        .status(404)
        .json({ ok: false, error: 'Order VIP tidak ditemukan di server.' });
      return;
    }

    if (order.status !== 'PENDING_VERIFICATION') {
      res.status(409).json({
        ok: false,
        error: `Order VIP ini sudah diproses sebelumnya (${order.status}).`,
      });
      return;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const state = await loadAndSyncServerUserStateFromFirestore(order.uid);
    const writes: Promise<void>[] = [];

    if (decision === 'APPROVED') {
      const currentExpMs = state.vipExpiresAt
        ? new Date(state.vipExpiresAt).getTime()
        : 0;
      const baseStartMs =
        Number.isFinite(currentExpMs) && currentExpMs > nowMs
          ? currentExpMs
          : nowMs;
      const nextExpiresIso = new Date(
        baseStartMs + VIP_DURATION_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      state.vipStatus = 'ACTIVE';
      state.vipStartedAt = nowIso;
      state.vipExpiresAt = nextExpiresIso;
      state.fireBalance = Math.max(
        0,
        state.fireBalance + VIP_MONTHLY_DIAMOND_BONUS
      );
      state.updatedAt = nowIso;
      userStateLedger.set(state.uid, state);

      order.status = 'APPROVED';
      order.verifiedBy = session.username;
      order.verifiedAt = nowIso;
      order.vipStartedAt = nowIso;
      order.vipExpiresAt = nextExpiresIso;
      order.adminNote =
        adminNote ||
        `Disetujui Admin (${session.username}). Aktif s/d ${new Date(
          nextExpiresIso
        ).toLocaleDateString('id-ID')}.`;
      order.updatedAt = nowIso;
      vipOrdersMap.set(orderId, order);

      const txEntry = recordLedgerTransaction({
        uid: state.uid,
        category: 'REWARD',
        direction: 'CREDIT',
        currency: 'FIRE',
        amount: VIP_MONTHLY_DIAMOND_BONUS,
        description: `Aktivasi COINOVA VIP (30 Hari) + Bonus Bulanan +${VIP_MONTHLY_DIAMOND_BONUS} Diamond`,
        referenceId: orderId,
      });
      writes.push(setServerDoc('server_transactions', txEntry.id, txEntry));

      pushServerNotification(
        state.uid,
        '👑 COINOVA VIP Aktif (30 Hari)!',
        `Pembayaran VIP Rp100.000 Anda telah disetujui Admin. Bonus bulanan +${VIP_MONTHLY_DIAMOND_BONUS} Diamond telah masuk ke saldo Anda. Berlaku hingga ${new Date(
          nextExpiresIso
        ).toLocaleDateString('id-ID')}.`,
        'SUCCESS',
        'VIP'
      );
    } else {
      order.status = 'REJECTED';
      order.verifiedBy = session.username;
      order.verifiedAt = nowIso;
      order.adminNote =
        adminNote || `Ditolak oleh Admin (${session.username}).`;
      order.updatedAt = nowIso;
      vipOrdersMap.set(orderId, order);

      resolveUserVipState(state);
      state.updatedAt = nowIso;
      userStateLedger.set(state.uid, state);

      pushServerNotification(
        state.uid,
        'Pembayaran VIP Ditolak',
        `Permintaan aktivasi VIP Anda ditolak Admin: ${order.adminNote}`,
        'WARNING',
        'VIP'
      );
    }

    const auditEntry = recordAdminAudit(
      session.username,
      `VIP_ORDER_${decision}`,
      order.uid,
      decision,
      `Reviewed VIP order ${orderId} (${order.username}) -> ${decision}`
    );

    writes.push(
      setServerDoc('server_vip_orders', orderId, order),
      persistUserStateToFirestore(state),
      setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry)
    );
    await Promise.all(writes).catch(() => {});

    res.json({
      ok: true,
      order,
      vipStatus: state.vipStatus,
      vipExpiresAt: state.vipExpiresAt || null,
    });
  }
);

// ----------------------------------------------------------------------------
// 3. ADMIN BROADCAST — ANNOUNCEMENTS MANAGEMENT
// ----------------------------------------------------------------------------
app.get('/api/game/broadcasts', async (_req: Request, res: Response) => {
  await ensureFirestoreSeeded();
  const activeList = Array.from(adminBroadcastsMap.values())
    .filter((b) => b.isActive)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  res.json({
    ok: true,
    broadcasts: activeList,
  });
});

app.get(
  '/api/admin/broadcasts',
  requireAdminAuth,
  async (_req: Request, res: Response) => {
    await ensureFirestoreSeeded();
    const list = Array.from(adminBroadcastsMap.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    res.json({
      ok: true,
      broadcasts: list,
    });
  }
);

app.post(
  '/api/admin/broadcasts',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    await ensureFirestoreSeeded();
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();
    const isActive =
      req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true;

    if (title.length < 3 || content.length < 5) {
      res.status(400).json({
        ok: false,
        error: 'Judul (min. 3 karakter) dan isi pengumuman (min. 5 karakter) wajib diisi.',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const broadcastId = `bc_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const record: ServerAdminBroadcastRecord = {
      broadcastId,
      title: title.slice(0, 120),
      content: content.slice(0, 1000),
      isActive,
      createdBy: session.username,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    adminBroadcastsMap.set(broadcastId, record);

    const auditEntry = recordAdminAudit(
      session.username,
      'CREATE_BROADCAST',
      broadcastId,
      isActive ? 'ACTIVE' : 'INACTIVE',
      `Created broadcast announcement: ${record.title}`
    );

    await Promise.all([
      setServerDoc('server_broadcasts', broadcastId, record),
      setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry),
    ]).catch(() => {});

    res.json({
      ok: true,
      broadcast: record,
    });
  }
);

app.post(
  '/api/admin/broadcasts/toggle',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    await ensureFirestoreSeeded();
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const broadcastId = String(req.body?.broadcastId || '').trim();
    const existing = adminBroadcastsMap.get(broadcastId);
    if (!existing) {
      res
        .status(404)
        .json({ ok: false, error: 'Pengumuman tidak ditemukan.' });
      return;
    }

    existing.isActive =
      req.body?.isActive !== undefined
        ? Boolean(req.body.isActive)
        : !existing.isActive;
    existing.updatedAt = new Date().toISOString();
    adminBroadcastsMap.set(broadcastId, existing);

    const auditEntry = recordAdminAudit(
      session.username,
      'TOGGLE_BROADCAST',
      broadcastId,
      existing.isActive ? 'ACTIVE' : 'INACTIVE',
      `Toggled broadcast ${existing.title}`
    );

    await Promise.all([
      setServerDoc('server_broadcasts', broadcastId, existing),
      setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry),
    ]).catch(() => {});

    res.json({
      ok: true,
      broadcast: existing,
    });
  }
);

app.delete(
  '/api/admin/broadcasts/:broadcastId',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    await ensureFirestoreSeeded();
    const token = extractBearerToken(req)!;
    const session =
      activeAdminSessions.get(token) || resolveAdminSessionFromToken(token)!;
    const broadcastId = String(req.params.broadcastId || '').trim();
    if (!broadcastId) {
      res.status(400).json({ ok: false, error: 'ID pengumuman tidak valid.' });
      return;
    }
    adminBroadcastsMap.delete(broadcastId);
    const auditEntry = recordAdminAudit(
      session.username,
      'DELETE_BROADCAST',
      broadcastId,
      'DELETED',
      `Deleted broadcast ${broadcastId}`
    );
    await Promise.all([
      deleteServerDoc('server_broadcasts', broadcastId),
      setServerDoc('server_admin_audits', auditEntry.auditId, auditEntry),
    ]).catch(() => {});
    res.json({ ok: true, broadcastId });
  }
);

// ----------------------------------------------------------------------------
// 4. MYSTERY BOX — DAILY EVENT (SERVER-VALIDATED COOLDOWN, NO TICKET)
// ----------------------------------------------------------------------------
const handleMysteryBoxDailyEvent = async (req: Request, res: Response) => {
    await ensureFirestoreSeeded();
    const uid = String(req.body?.uid || '').trim();
    if (!uid) {
      res.status(400).json({ ok: false, error: 'UID tidak valid.' });
      return;
    }

    if (inFlightMysteryBoxLocks.has(uid)) {
      res.status(429).json({
        ok: false,
        error: 'Mystery Box sedang dibuka, mohon tunggu.',
      });
      return;
    }

    inFlightMysteryBoxLocks.add(uid);
    try {
      const state = await loadAndSyncServerUserStateFromFirestore(uid);
      const vipInfo = resolveUserVipState(state);
      const cooldownMs = getEventCooldownMsForUser(vipInfo.isVip);
      const nowMs = Date.now();
      const cdRec = eventCooldownsMap.get(uid);
      const lastClaimMs = Math.max(
        0,
        Number(state.lastMysteryBoxClaimMs || 0),
        Number(cdRec?.lastMysteryBoxClaimMs || 0)
      );
      const elapsed = nowMs - lastClaimMs;

      if (lastClaimMs > 0 && elapsed < cooldownMs) {
        const remainingMs = cooldownMs - elapsed;
        const hoursLeft = Math.floor(remainingMs / (1000 * 60 * 60));
        const minsLeft = Math.ceil(
          (remainingMs % (1000 * 60 * 60)) / (1000 * 60)
        );
        res.status(429).json({
          ok: false,
          error: `Mystery Box sedang cooldown. Bisa dibuka kembali dalam ${hoursLeft}j ${minsLeft}m.`,
          mysteryBoxAvailable: false,
          nextMysteryBoxAvailableAt: new Date(
            lastClaimMs + cooldownMs
          ).toISOString(),
        });
        return;
      }

      // Immediately stamp cooldown in memory BEFORE any async operation
      const nowIso = new Date(nowMs).toISOString();
      state.lastMysteryBoxClaimMs = nowMs;
      state.lastMysteryBoxClaimAt = nowIso;
      const updatedCd: ServerEventCooldownRecord = {
        uid,
        lastMysteryBoxClaimMs: nowMs,
        lastMysteryBoxClaimAt: nowIso,
        lastLuckySpinMs: Math.max(
          0,
          Number(state.lastLuckySpinMs || 0),
          Number(cdRec?.lastLuckySpinMs || 0)
        ),
        lastLuckySpinAt:
          state.lastLuckySpinAt || cdRec?.lastLuckySpinAt || null,
        updatedAt: nowIso,
      };
      eventCooldownsMap.set(uid, updatedCd);

      // Server-side random reward (Koin or Diamond only, safe for game economy)
      const roll = crypto.randomInt(0, 100);
      let rewardType: 'COIN' | 'FIRE' = 'COIN';
      let rewardAmount = 250;
      let rewardLabel = '+250 Koin';

      if (roll < 38) {
        rewardType = 'COIN';
        rewardAmount = 250;
        rewardLabel = '+250 Koin';
      } else if (roll < 68) {
        rewardType = 'COIN';
        rewardAmount = 500;
        rewardLabel = '+500 Koin';
      } else if (roll < 85) {
        rewardType = 'COIN';
        rewardAmount = 1000;
        rewardLabel = '+1.000 Koin';
      } else if (roll < 95) {
        rewardType = 'FIRE';
        rewardAmount = 1;
        rewardLabel = '+1 Diamond';
      } else {
        rewardType = 'FIRE';
        rewardAmount = 2;
        rewardLabel = '+2 Diamond';
      }

      if (rewardType === 'COIN') {
        state.coinBalance = Math.max(0, state.coinBalance + rewardAmount);
      } else {
        state.fireBalance = Math.max(0, state.fireBalance + rewardAmount);
      }
      state.updatedAt = nowIso;
      userStateLedger.set(uid, state);

      const txEntry = recordLedgerTransaction({
        uid,
        category: 'REWARD',
        direction: 'CREDIT',
        currency: rewardType === 'FIRE' ? 'FIRE' : 'COIN',
        amount: rewardAmount,
        description: `Daily Event Mystery Box: ${rewardLabel}`,
        referenceId: `mbox_${nowMs}`,
      });

      pushServerNotification(
        uid,
        '🎁 Mystery Box Harian Dibuka!',
        `Selamat! Kamu mendapatkan ${rewardLabel} dari Daily Event Mystery Box.`,
        'REWARD',
        'EVENT'
      );

      await Promise.all([
        persistUserStateToFirestore(state),
        setServerDoc(
          'server_event_cooldowns',
          sanitizeAccountKey(uid),
          updatedCd
        ),
        setServerDoc('server_transactions', txEntry.id, txEntry),
      ]).catch(() => {});

      res.json({
        ok: true,
        reward: {
          type: rewardType,
          amount: rewardAmount,
          label: rewardLabel,
        },
        message: `Selamat! Kamu mendapatkan ${rewardLabel} dari Mystery Box Harian!`,
        ...buildFeatureStatusPayload(state),
      });
    } finally {
      inFlightMysteryBoxLocks.delete(uid);
    }
};

app.post('/api/game/daily-event/mystery-box', handleMysteryBoxDailyEvent);
app.post('/api/game/mystery-box/open', handleMysteryBoxDailyEvent);

// ----------------------------------------------------------------------------
// 5. LUCKY SPIN — DAILY EVENT (SERVER-VALIDATED COOLDOWN, NO TICKET)
// ----------------------------------------------------------------------------
export const LUCKY_SPIN_SEGMENTS: Array<{
  index: number;
  label: string;
  rewardType: 'COIN' | 'FIRE';
  amount: number;
  weight: number;
}> = [
  { index: 0, label: '200 Koin', rewardType: 'COIN', amount: 200, weight: 26 },
  { index: 1, label: '1 Diamond', rewardType: 'FIRE', amount: 1, weight: 12 },
  { index: 2, label: '500 Koin', rewardType: 'COIN', amount: 500, weight: 20 },
  { index: 3, label: '750 Koin', rewardType: 'COIN', amount: 750, weight: 12 },
  { index: 4, label: '1.000 Koin', rewardType: 'COIN', amount: 1000, weight: 10 },
  { index: 5, label: '2 Diamond', rewardType: 'FIRE', amount: 2, weight: 6 },
  { index: 6, label: '350 Koin', rewardType: 'COIN', amount: 350, weight: 11 },
  { index: 7, label: '3 Diamond', rewardType: 'FIRE', amount: 3, weight: 3 },
];

app.post(
  '/api/game/daily-event/lucky-spin',
  async (req: Request, res: Response) => {
    await ensureFirestoreSeeded();
    const uid = String(req.body?.uid || '').trim();
    if (!uid) {
      res.status(400).json({ ok: false, error: 'UID tidak valid.' });
      return;
    }

    if (inFlightLuckySpinLocks.has(uid)) {
      res.status(429).json({
        ok: false,
        error: 'Lucky Spin sedang berputar, mohon tunggu.',
      });
      return;
    }

    inFlightLuckySpinLocks.add(uid);
    try {
      const state = await loadAndSyncServerUserStateFromFirestore(uid);
      const vipInfo = resolveUserVipState(state);
      const cooldownMs = getEventCooldownMsForUser(vipInfo.isVip);
      const nowMs = Date.now();
      const cdRec = eventCooldownsMap.get(uid);
      const lastSpinMs = Math.max(
        0,
        Number(state.lastLuckySpinMs || 0),
        Number(cdRec?.lastLuckySpinMs || 0)
      );
      const elapsed = nowMs - lastSpinMs;

      if (lastSpinMs > 0 && elapsed < cooldownMs) {
        const remainingMs = cooldownMs - elapsed;
        const hoursLeft = Math.floor(remainingMs / (1000 * 60 * 60));
        const minsLeft = Math.ceil(
          (remainingMs % (1000 * 60 * 60)) / (1000 * 60)
        );
        res.status(400).json({
          ok: false,
          error: `Lucky Spin sedang cooldown. Bisa diputar kembali dalam ${hoursLeft}j ${minsLeft}m.`,
          luckySpinAvailable: false,
          nextLuckySpinAvailableAt: new Date(
            lastSpinMs + cooldownMs
          ).toISOString(),
        });
        return;
      }

      // Immediately stamp cooldown in memory BEFORE any async operation
      const nowIso = new Date(nowMs).toISOString();
      state.lastLuckySpinMs = nowMs;
      state.lastLuckySpinAt = nowIso;
      const updatedCd: ServerEventCooldownRecord = {
        uid,
        lastMysteryBoxClaimMs: Math.max(
          0,
          Number(state.lastMysteryBoxClaimMs || 0),
          Number(cdRec?.lastMysteryBoxClaimMs || 0)
        ),
        lastMysteryBoxClaimAt:
          state.lastMysteryBoxClaimAt || cdRec?.lastMysteryBoxClaimAt || null,
        lastLuckySpinMs: nowMs,
        lastLuckySpinAt: nowIso,
        updatedAt: nowIso,
      };
      eventCooldownsMap.set(uid, updatedCd);

      const totalWeight = LUCKY_SPIN_SEGMENTS.reduce(
        (acc, seg) => acc + seg.weight,
        0
      );
      let roll = crypto.randomInt(0, totalWeight);
      let winningSegment = LUCKY_SPIN_SEGMENTS[0]!;
      for (const seg of LUCKY_SPIN_SEGMENTS) {
        if (roll < seg.weight) {
          winningSegment = seg;
          break;
        }
        roll -= seg.weight;
      }

      if (winningSegment.rewardType === 'COIN') {
        state.coinBalance = Math.max(
          0,
          state.coinBalance + winningSegment.amount
        );
      } else {
        state.fireBalance = Math.max(
          0,
          state.fireBalance + winningSegment.amount
        );
      }
      state.updatedAt = nowIso;
      userStateLedger.set(uid, state);

      const txEntry = recordLedgerTransaction({
        uid,
        category: 'REWARD',
        direction: 'CREDIT',
        currency: winningSegment.rewardType === 'FIRE' ? 'FIRE' : 'COIN',
        amount: winningSegment.amount,
        description: `Daily Event Lucky Spin: +${winningSegment.label}`,
        referenceId: `lspin_${nowMs}`,
      });

      pushServerNotification(
        uid,
        '🎡 Hasil Lucky Spin Harian!',
        `Selamat! Roda Lucky Spin berhenti di +${winningSegment.label}.`,
        'REWARD',
        'EVENT'
      );

      await Promise.all([
        persistUserStateToFirestore(state),
        setServerDoc(
          'server_event_cooldowns',
          sanitizeAccountKey(uid),
          updatedCd
        ),
        setServerDoc('server_transactions', txEntry.id, txEntry),
      ]).catch(() => {});

      res.json({
        ok: true,
        segmentIndex: winningSegment.index,
        reward: {
          type: winningSegment.rewardType,
          amount: winningSegment.amount,
          label: `+${winningSegment.label}`,
        },
        message: `Selamat! Kamu memenangkan +${winningSegment.label} dari Lucky Spin!`,
        ...buildFeatureStatusPayload(state),
      });
    } finally {
      inFlightLuckySpinLocks.delete(uid);
    }
  }
);

// ============================================================================
// 13. AI UGC AFFILIATE — SERVER-SIDE GEMINI API + VIDEO REFERENCE FILES API
// ============================================================================
interface CachedVideoReference {
  cacheKey: string;
  fileName: string;
  mimeType: string;
  fileUri?: string;
  inlineBase64?: string;
  createdAt: number;
}
const videoReferenceCache = new Map<string, CachedVideoReference>();

const SUPPORTED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
  'video/avi',
  'video/mpeg',
  'video/mpg',
  'video/3gpp',
]);

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), base64: match[2] };
}

app.post('/api/ugc/upload-video', async (req: Request, res: Response) => {
  try {
    const fileName = String(req.body?.fileName || 'reference.mp4').trim();
    const fileSize = Number(req.body?.fileSize || 0);
    const videoDataUrl = String(req.body?.videoDataUrl || '').trim();
    const cacheKey = String(
      req.body?.cacheKey || `${fileName}_${fileSize}`
    ).trim();

    if (videoReferenceCache.has(cacheKey)) {
      const cached = videoReferenceCache.get(cacheKey)!;
      res.json({
        ok: true,
        cached: true,
        cacheKey: cached.cacheKey,
        fileName: cached.fileName,
        mimeType: cached.mimeType,
        fileUri: cached.fileUri || null,
      });
      return;
    }

    const parsed = parseDataUrl(videoDataUrl);
    if (!parsed) {
      res.status(400).json({
        ok: false,
        error:
          'Video reference gagal diproses. Coba gunakan video MP4/MOV yang lebih pendek atau berukuran lebih kecil.',
      });
      return;
    }

    if (!SUPPORTED_VIDEO_MIMES.has(parsed.mimeType)) {
      res.status(400).json({
        ok: false,
        error: 'Format video tidak didukung.',
      });
      return;
    }

    const byteLength = Buffer.byteLength(parsed.base64, 'base64');
    if (byteLength > 22 * 1024 * 1024) {
      res.status(400).json({
        ok: false,
        error: 'Video terlalu besar. Gunakan video yang lebih pendek atau lebih kecil.',
      });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        ok: false,
        error:
          'GEMINI_API_KEY belum dikonfigurasi di server. Pastikan kunci API Gemini tersedia untuk menganalisis video reference.',
      });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    // For larger videos (> 4MB), upload via Gemini Files API and wait until ACTIVE
    if (byteLength > 4 * 1024 * 1024) {
      const tmpFilePath = path.join(
        os.tmpdir(),
        `ugc_ref_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      );
      fs.writeFileSync(tmpFilePath, Buffer.from(parsed.base64, 'base64'));
      try {
        let uploadedFile = await ai.files.upload({
          file: tmpFilePath,
          config: { mimeType: parsed.mimeType },
        });

        let attempts = 0;
        while (uploadedFile.state === 'PROCESSING' && attempts < 25) {
          await new Promise((r) => setTimeout(r, 2000));
          uploadedFile = await ai.files.get({ name: uploadedFile.name! });
          attempts++;
        }

        if (uploadedFile.state === 'FAILED') {
          throw new Error('File processing failed on Gemini Files API');
        }

        const entry: CachedVideoReference = {
          cacheKey,
          fileName,
          mimeType: parsed.mimeType,
          fileUri: uploadedFile.uri,
          inlineBase64: parsed.base64,
          createdAt: Date.now(),
        };
        videoReferenceCache.set(cacheKey, entry);

        res.json({
          ok: true,
          cached: false,
          cacheKey,
          fileName,
          mimeType: parsed.mimeType,
          fileUri: uploadedFile.uri || null,
        });
        return;
      } finally {
        try {
          if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
        } catch {
          // ignore cleanup error
        }
      }
    }

    // For short/compact videos, store in session cache for efficient reuse
    const entry: CachedVideoReference = {
      cacheKey,
      fileName,
      mimeType: parsed.mimeType,
      inlineBase64: parsed.base64,
      createdAt: Date.now(),
    };
    videoReferenceCache.set(cacheKey, entry);

    res.json({
      ok: true,
      cached: false,
      cacheKey,
      fileName,
      mimeType: parsed.mimeType,
      fileUri: null,
    });
  } catch (err) {
    console.error('Upload video reference error:', err);
    res.status(500).json({
      ok: false,
      error:
        'Video reference gagal diproses. Coba gunakan video MP4/MOV yang lebih pendek atau berukuran lebih kecil.',
    });
  }
});

const inFlightUgcGenerateLocks = new Set<string>();

function isTransientAiUgcError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : String(err || '');
  return /503|UNAVAILABLE|high demand|overloaded|resource_exhausted|429|timeout|timed out|DEADLINE_EXCEEDED|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(
    msg
  );
}

app.post('/api/ugc/generate', async (req: Request, res: Response) => {
  const uid = String(req.body?.uid || '').trim();
  const lockKey = uid || `anon_${req.ip || 'local'}`;

  if (inFlightUgcGenerateLocks.has(lockKey)) {
    res.status(429).json({
      ok: false,
      coinsCharged: 0,
      coinDeducted: false,
      error:
        'Permintaan Generate AI UGC sedang diproses. Koin kamu tidak berkurang, mohon tunggu sebentar.',
    });
    return;
  }

  inFlightUgcGenerateLocks.add(lockKey);
  const AI_UGC_COST_COINS = 10000;
  let preGenerateCoinBalance: number | undefined;
  let coinDeducted = false;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        ok: false,
        coinsCharged: 0,
        coinDeducted: false,
        error:
          'AI sedang sibuk. Koin kamu tidak berkurang. Silakan coba lagi beberapa saat.',
      });
      return;
    }

    const clientCoinBalance =
      req.body?.coinBalance !== undefined
        ? Math.floor(Number(req.body.coinBalance))
        : undefined;

    if (uid) {
      const uState = await loadAndSyncServerUserStateFromFirestore(
        uid,
        clientCoinBalance !== undefined
          ? { coinBalance: clientCoinBalance }
          : undefined
      );
      const effectiveCoins =
        clientCoinBalance !== undefined
          ? Math.min(uState.coinBalance, clientCoinBalance)
          : uState.coinBalance;
      preGenerateCoinBalance = effectiveCoins;
      if (effectiveCoins < AI_UGC_COST_COINS) {
        res.status(400).json({
          ok: false,
          coinsCharged: 0,
          coinDeducted: false,
          error: `Koin Anda tidak mencukupi untuk Generate AI UGC. Biaya Generate: ${AI_UGC_COST_COINS.toLocaleString('id-ID')} Koin (Koin Anda: ${effectiveCoins.toLocaleString('id-ID')} Koin).`,
        });
        return;
      }
    }

    const productDataUrl = String(req.body?.productDataUrl || '').trim();
    const characterDataUrl = String(req.body?.characterDataUrl || '').trim();
    const videoCacheKey = String(req.body?.videoCacheKey || '').trim();
    const videoDataUrl = String(req.body?.videoDataUrl || '').trim();
    const referenceMode = String(req.body?.referenceMode || 'Original').trim() as
      | 'Original'
      | 'Follow Video Structure'
      | 'Remix Video Reference';
    const productName = String(req.body?.productName || '').trim();
    const productDescription = String(req.body?.productDescription || '').trim();
    const talentStyle = String(
      req.body?.talentStyle || 'Kreator UGC Indonesia natural, ekspresif, meyakinkan'
    ).trim();

    const parsedProduct = parseDataUrl(productDataUrl);
    if (!parsedProduct) {
      res.status(400).json({
        ok: false,
        coinsCharged: 0,
        coinDeducted: false,
        error: 'Foto Produk (Product Reference) wajib diunggah terlebih dahulu.',
      });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const parts: any[] = [];

    // 1. PRODUCT REFERENCE (Source of Truth for Product)
    parts.push({
      text: 'IMAGE 1 — PRODUCT REFERENCE (SUMBER KEBENARAN UTAMA PRODUK. Jangan mengarang bentuk, warna, logo, tulisan, tombol, display, material, atau ukuran yang tidak terlihat pada foto produk ini):',
    });
    parts.push({
      inlineData: {
        mimeType: parsedProduct.mimeType,
        data: parsedProduct.base64,
      },
    });

    // 2. CHARACTER REFERENCE (Optional)
    const parsedCharacter = characterDataUrl ? parseDataUrl(characterDataUrl) : null;
    if (parsedCharacter) {
      parts.push({
        text: 'IMAGE 2 — CHARACTER REFERENCE (Gunakan sebagai referensi visual karakter: jenis kelamin/presentasi, hairstyle, warna rambut, outfit, dan overall appearance tanpa meniru identitas orang nyata/public figure):',
      });
      parts.push({
        inlineData: {
          mimeType: parsedCharacter.mimeType,
          data: parsedCharacter.base64,
        },
      });
    }

    // 3. VIDEO REFERENCE (Optional — used when available and Reference Mode is not Original, or if user uploaded video)
    let hasVideoAttached = false;
    const cachedVideo = videoCacheKey ? videoReferenceCache.get(videoCacheKey) : undefined;
    if (referenceMode !== 'Original' && (cachedVideo || videoDataUrl)) {
      parts.push({
        text: 'VIDEO 3 — VIDEO REFERENCE (Analyze the reference video\'s visual structure, shot progression, camera language, pacing, gestures, and product presentation. Create a new original UGC video concept using the supplied product and character references. JANGAN menggunakan produk dari video reference jika berbeda dari IMAGE 1 PRODUCT REFERENCE. JANGAN menyalin dialog verbatim, audio, watermark, username, atau identitas orang dari video reference):',
      });
      if (cachedVideo?.inlineBase64) {
        parts.push({
          inlineData: {
            mimeType: cachedVideo.mimeType,
            data: cachedVideo.inlineBase64,
          },
        });
        hasVideoAttached = true;
      } else if (videoDataUrl) {
        const parsedVid = parseDataUrl(videoDataUrl);
        if (parsedVid) {
          parts.push({
            inlineData: {
              mimeType: parsedVid.mimeType,
              data: parsedVid.base64,
            },
          });
          hasVideoAttached = true;
        }
      }
    }

    const systemInstructionText = `Anda adalah AI UGC Affiliate Director & Prompt Engineer profesional.
Tugas Anda adalah menghasilkan analisis struktur dan prompt video UGC Affiliate 9:16 vertical yang sangat detail, akurat, dan siap pakai.

ATURAN WAJIB:
1. PRODUCT PRIORITY (ANTI-UBAH):
   IMAGE 1 (PRODUCT REFERENCE) adalah sumber kebenaran mutlak untuk produk.
   Jangan pernah mengarang bentuk, warna, logo, tulisan, fitur, tombol, display, material, atau ukuran yang tidak ada di foto produk.
   Jika VIDEO REFERENCE menampilkan produk lain (misalnya kipas mini sedangkan Product Reference adalah benda lain), JANGAN gunakan produk dari video reference! Hasil akhir WAJIB menampilkan produk dari PRODUCT REFERENCE.
2. CHARACTER PRIORITY:
   Jika IMAGE 2 (CHARACTER REFERENCE) tersedia, pertahankan jenis kelamin/presentasi, hairstyle, warna rambut, outfit, dan overall appearance-nya tanpa menyebut nama/identitas orang nyata. Jika tidak ada, gunakan deskripsi talent: "${talentStyle}".
3. REFERENCE MODE = "${referenceMode}":
   - Jika "Original": Buat struktur UGC baru yang optimal untuk produk dan karakter.
   - Jika "Follow Video Structure": Ikuti urutan scene, framing, camera movement, pacing, gesture tangan, dan cara produk dipresentasikan dari video reference, lalu terapkan pada PRODUCT REFERENCE dan CHARACTER REFERENCE.
   - Jika "Remix Video Reference": Gunakan struktur visual video reference sebagai inspirasi, tetapi buat variasi kreatif video UGC baru yang segar dan berbeda.
4. ANTI-COPY RULE:
   Analyze the reference video's visual structure, shot progression, camera language, pacing, gestures, and product presentation. Create a new original UGC video concept using the supplied product and character references. Jangan menyalin watermark, logo kreator, username, atau dialog secara verbatim.

Kembalikan respons dalam format JSON murni dengan properti berikut:
{
  "videoAnalysis": {
    "hook": "...",
    "scene1": "...",
    "scene2": "...",
    "scene3": "...",
    "camera": "...",
    "movement": "...",
    "productPresentation": "...",
    "lighting": "...",
    "pacing": "...",
    "cta": "..."
  },
  "hook": "Kalimat opening hook 3 detik pertama yang menarik perhatian",
  "conceptScript": "Penjelasan ringkas konsep & alur script UGC dari awal hingga akhir",
  "caption": "Caption affiliate siap posting lengkap dengan hashtag relevan",
  "cta": "Kalimat Call To Action (CTA) keranjang kuning / link bio yang kuat",
  "finalPrompt": "Teks lengkap dengan format persis:\\nVIDEO FORMAT:\\n9:16 vertical UGC\\n\\nTALENT:\\n...\\n\\nPRODUCT:\\n...\\n\\nLOCATION:\\n...\\n\\nLIGHTING:\\n...\\n\\nCAMERA:\\n...\\n\\nSCENE 1:\\n...\\n\\nSCENE 2:\\n...\\n\\nSCENE 3:\\n...\\n\\nPRODUCT DEMONSTRATION:\\n...\\n\\nDIALOGUE / VOICEOVER:\\n...\\n\\nENDING / CTA:\\n...\\n\\nANTI-CHANGE:\\n...\\n\\nREFERENCE INSTRUCTION:\\n..."
}`;

    const userPromptText = `Informasi Tambahan dari Pengguna:
- Nama Produk: ${productName || 'Sesuai foto Product Reference'}
- Deskripsi Produk: ${productDescription || 'Analisis visual langsung dari foto Product Reference'}
- Karakter / Talent: ${parsedCharacter ? 'Sesuai foto Character Reference yang dilampirkan' : talentStyle}
- Reference Mode: ${referenceMode}
- Video Reference Terlampir: ${hasVideoAttached ? 'YA (Analisis struktur shot, kamera, pacing, gesture, dan product presentation)' : 'TIDAK (Gunakan mode standar)'}

Hasilkan JSON sesuai instruksi sekarang.`;

    parts.push({ text: userPromptText });

    // Bounded retry (max 2 retries = up to 3 total attempts) for 503/UNAVAILABLE/timeout
    const MAX_UGC_RETRIES = 2;
    const MODEL_CANDIDATES = [
      'gemini-3.8-flash',
      'gemini-3.8-flash',
      'gemini-flash-latest',
    ];
    let parsedJson: any = null;
    let lastGenError: unknown = null;

    for (let attempt = 0; attempt <= MAX_UGC_RETRIES; attempt++) {
      try {
        const modelName = MODEL_CANDIDATES[attempt] || 'gemini-3.8-flash';
        const response = await Promise.race([
          ai.models.generateContent({
            model: modelName,
            contents: { parts },
            config: {
              systemInstruction: systemInstructionText,
              responseMimeType: 'application/json',
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('503 Request timeout pada layanan AI')),
              28000
            )
          ),
        ]);

        const rawText = (response.text || '').trim();
        if (!rawText) {
          throw new Error('503 Respons kosong dari model AI.');
        }

        let candidateJson: any;
        try {
          candidateJson = JSON.parse(rawText);
        } catch {
          const cleaned = rawText
            .replace(/^```json\s*/i, '')
            .replace(/```$/i, '')
            .trim();
          candidateJson = JSON.parse(cleaned);
        }

        const candidateFinalPrompt = String(
          candidateJson?.finalPrompt || ''
        ).trim();
        const candidateHook = String(candidateJson?.hook || '').trim();

        if (!candidateFinalPrompt || candidateFinalPrompt.length < 20 || !candidateHook) {
          throw new Error('503 Output AI UGC belum lengkap.');
        }

        parsedJson = candidateJson;
        lastGenError = null;
        break;
      } catch (genErr) {
        lastGenError = genErr;
        if (attempt < MAX_UGC_RETRIES && isTransientAiUgcError(genErr)) {
          const delayMs = (attempt + 1) * 1200;
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        break;
      }
    }

    if (!parsedJson || lastGenError) {
      res.status(503).json({
        ok: false,
        coinsCharged: 0,
        coinDeducted: false,
        nextCoinBalance: preGenerateCoinBalance,
        newCoinBalance: preGenerateCoinBalance,
        error:
          'AI sedang sibuk. Koin kamu tidak berkurang. Silakan coba lagi beberapa saat.',
      });
      return;
    }

    // ONLY deduct 10,000 Coins AFTER AI output is successfully generated and validated
    let nextCoinBalanceAfterUgc: number | undefined;
    if (uid) {
      const uState = await loadAndSyncServerUserStateFromFirestore(uid);
      const baseCoins =
        clientCoinBalance !== undefined
          ? Math.min(uState.coinBalance, clientCoinBalance)
          : uState.coinBalance;
      preGenerateCoinBalance = baseCoins;

      if (baseCoins < AI_UGC_COST_COINS) {
        res.status(400).json({
          ok: false,
          coinsCharged: 0,
          coinDeducted: false,
          nextCoinBalance: baseCoins,
          newCoinBalance: baseCoins,
          error: `Koin Anda tidak mencukupi untuk Generate AI UGC. Biaya Generate: ${AI_UGC_COST_COINS.toLocaleString('id-ID')} Koin.`,
        });
        return;
      }

      uState.coinBalance = Math.max(0, baseCoins - AI_UGC_COST_COINS);
      uState.updatedAt = new Date().toISOString();
      userStateLedger.set(uid, uState);
      coinDeducted = true;
      nextCoinBalanceAfterUgc = uState.coinBalance;

      const txEntry = recordLedgerTransaction({
        uid,
        category: 'AI_UGC',
        direction: 'DEBIT',
        currency: 'COIN',
        amount: AI_UGC_COST_COINS,
        description: `Generate Prompt AI UGC Affiliate (${productName || 'Produk'}): -${AI_UGC_COST_COINS.toLocaleString('id-ID')} Koin`,
        referenceId: `ugc_${Date.now()}`,
      });
      await Promise.all([
        persistUserStateToFirestore(uState),
        setServerDoc('server_transactions', txEntry.id, txEntry),
      ]).catch(() => {});
    }

    res.json({
      ok: true,
      referenceMode,
      hasVideoAnalysis: hasVideoAttached,
      coinsCharged: AI_UGC_COST_COINS,
      costCoins: AI_UGC_COST_COINS,
      coinDeducted: true,
      nextCoinBalance: nextCoinBalanceAfterUgc,
      newCoinBalance: nextCoinBalanceAfterUgc,
      result: {
        videoAnalysis: parsedJson.videoAnalysis || null,
        hook: String(parsedJson.hook || ''),
        conceptScript: String(parsedJson.conceptScript || ''),
        caption: String(parsedJson.caption || ''),
        cta: String(parsedJson.cta || ''),
        finalPrompt: String(parsedJson.finalPrompt || ''),
      },
    });
  } catch (err) {
    console.error('AI UGC Generate error:', err);
    // Automatic rollback/refund if coins were deducted before an unexpected error occurred
    if (coinDeducted && uid && preGenerateCoinBalance !== undefined) {
      try {
        const uState = getOrSyncServerUserState(uid);
        uState.coinBalance = preGenerateCoinBalance;
        uState.updatedAt = new Date().toISOString();
        userStateLedger.set(uid, uState);
        await persistUserStateToFirestore(uState).catch(() => {});
        coinDeducted = false;
      } catch {
        // ignore rollback persistence warning
      }
    }
    res.status(503).json({
      ok: false,
      coinsCharged: 0,
      coinDeducted: false,
      nextCoinBalance: preGenerateCoinBalance,
      newCoinBalance: preGenerateCoinBalance,
      error:
        'AI sedang sibuk. Koin kamu tidak berkurang. Silakan coba lagi beberapa saat.',
    });
  } finally {
    inFlightUgcGenerateLocks.delete(lockKey);
  }
});

// Catch-all for unmatched /api/* routes so Vercel logs clearly identify route-not-found
app.use('/api/*', (req: Request, res: Response) => {
  console.warn(
    `[COINOVA-AUTH] Route not found: ${req.method} ${req.originalUrl || req.url}`
  );
  res.status(404).json({
    ok: false,
    error: `Endpoint API tidak ditemukan: ${req.method} ${req.originalUrl || req.url}`,
  });
});

// ============================================================================
// MOUNT VITE DEV MIDDLEWARE OR PRODUCTION STATIC ASSETS (NON-VERCEL ONLY)
// ============================================================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production' && !IS_VERCEL_RUNTIME) {
    let viteConnectMiddleware: any = null;
    const viteReadyPromise = (async () => {
      const viteModuleId = 'vite';
      const { createServer: createViteServer } = await import(viteModuleId);
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: false, watch: null },
        appType: 'spa',
      });
      viteConnectMiddleware = vite.middlewares;
      return vite.middlewares;
    })();

    app.use(async (req: Request, res: Response, next: NextFunction) => {
      try {
        const mw = viteConnectMiddleware || (await viteReadyPromise);
        mw(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else if (!IS_VERCEL_RUNTIME) {
    const distPath = path.resolve(APP_ROOT_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`COINOVA Server listening on http://0.0.0.0:${PORT}`);
    setTimeout(() => {
      void ensureFirestoreSeeded();
    }, 250);
  });
}

if (!IS_VERCEL_RUNTIME) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
  });
}

export default app;
