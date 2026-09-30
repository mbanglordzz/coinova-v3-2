/**
 * COINOVA - Firestore Security Rules Verification Spec
 * Verifies that all "Dirty Dozen" adversarial payloads are rejected (PERMISSION_DENIED).
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  docId: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED' | 'ALLOWED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Unverified Email Spoof against Game Settings',
    collection: 'game_settings',
    docId: 'global',
    operation: 'update',
    auth: { uid: 'spoof_admin', email: 'lordzmbang08@gmail.com', email_verified: false },
    payload: { coinsPerTap: 999999 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Self-Admin Escalation on User Create',
    collection: 'users',
    docId: 'attacker_1',
    operation: 'create',
    auth: { uid: 'attacker_1', email: 'attacker@example.com', email_verified: true },
    payload: {
      uid: 'attacker_1',
      username: 'Attacker',
      referralCode: 'DRG-HACK',
      dragonLevel: 1,
      totalTaps: 0,
      dailyStreak: 0,
      lastCheckInDate: 'none',
      role: 'admin',
      status: 'active',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on Wallet Update',
    collection: 'wallets',
    docId: 'user_1',
    operation: 'update',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: {
      uid: 'user_1',
      coinBalance: 500,
      isVIP: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-User PII Read on Profile',
    collection: 'profiles',
    docId: 'user_1',
    operation: 'get',
    auth: { uid: 'user_2', email: 'user2@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Negative Wallet Balance Poisoning',
    collection: 'wallets',
    docId: 'user_1',
    operation: 'update',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: {
      uid: 'user_1',
      coinBalance: 100,
      fireBalance: 10,
      idrBalance: -500000,
      lockedIdrBalance: 0,
      energy: 500,
      maxEnergy: 500,
      totalEarnedCoins: 100,
      totalEarnedFire: 10,
      totalWithdrawnIdr: 0,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Forged Timestamp Attack on Withdrawal Create',
    collection: 'withdrawals',
    docId: 'wd_forged',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: {
      withdrawalId: 'wd_forged',
      uid: 'user_1',
      username: 'Player1',
      method: 'DANA',
      accountNumber: '081234567890',
      accountName: 'Player One',
      amount: 50000,
      status: 'PENDING',
      paymentReference: '-',
      adminNote: '-',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Withdrawal Self-Approval by Non-Admin Owner',
    collection: 'withdrawals',
    docId: 'wd_1',
    operation: 'update',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: {
      status: 'PAID',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Terminal Withdrawal Mutation by Non-Admin',
    collection: 'withdrawals',
    docId: 'wd_paid_1',
    operation: 'update',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: {
      amount: 500000,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'ID Poisoning Attack with Invalid Characters',
    collection: 'tasks',
    docId: 'invalid$id#with!spaces',
    operation: 'get',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immutable Ledger Tampering on WalletTransaction',
    collection: 'wallet_transactions',
    docId: 'tx_1',
    operation: 'delete',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unauthorized List Scraping on Withdrawals',
    collection: 'withdrawals',
    docId: '*',
    operation: 'list',
    auth: { uid: 'attacker_1', email: 'attacker@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Orphaned TaskClaim Creation for Another User',
    collection: 'task_claims',
    docId: 'claim_spoof',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: {
      claimId: 'claim_spoof',
      uid: 'user_2',
      taskId: 'daily_tap_100',
      taskTitle: 'Tap 100x',
      coinReward: 500,
      fireReward: 5,
      idrReward: 0,
    },
    expected: 'PERMISSION_DENIED',
  },
];
