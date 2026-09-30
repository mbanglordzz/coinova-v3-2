import { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  DEFAULT_DRAGON_LEVELS,
  DEFAULT_GAME_SETTINGS,
  DEFAULT_REWARD_CODES,
  DEFAULT_TASKS,
} from '../data/seedData';
import {
  calculateCoinsFromIdr,
  calculateIdrFromCoins,
  calculateRequiredFireForWithdrawal,
  VALID_WITHDRAW_COIN_TIERS,
  WITHDRAWAL_DIAMOND_MAP,
} from '../config/economy';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
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
  NotificationItem,
  ReferralRecord,
  RewardCode,
  TaskClaim,
  UpgradeOrderStatus,
  UpgradePaymentMethod,
  UserAccount,
  UserProfile,
  UserWallet,
  WalletTransaction,
  WithdrawalRecord,
  WithdrawalStatus,
} from '../types/dragon';

export function toIsoString(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

export function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'id_default';
}

export function generateSafeId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 9);
  return sanitizeId(`${prefix}_${Date.now()}_${rand}`);
}

export async function hashPin(pin: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(`dragon_money_salt_${pin.trim()}`);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 64);
  }
  return `sha256_${pin.trim()}`;
}

export function getTodayKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function isClaimedOnLocalToday(claimedAtIso: string): boolean {
  if (!claimedAtIso) return false;
  const today = getTodayKey();
  if (claimedAtIso.startsWith(today)) return true;
  const parsed = new Date(claimedAtIso);
  if (Number.isNaN(parsed.getTime())) return false;
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}` === today;
}

// ============================================================================
// BOOTSTRAP & SEEDING
// ============================================================================

export async function ensureGlobalCatalogSeeded(): Promise<void> {
  try {
    const settingsRef = doc(db, 'game_settings', 'global');
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists()) {
      await setDoc(settingsRef, {
        settingId: 'global',
        coinsPerTap: Math.max(1, Math.round(DEFAULT_GAME_SETTINGS.coinsPerTap)),
        energyCostPerTap: Math.max(1, Math.round(DEFAULT_GAME_SETTINGS.energyCostPerTap)),
        baseMaxEnergy: Math.max(100, Math.round(DEFAULT_GAME_SETTINGS.baseMaxEnergy)),
        energyRegenPerMinute: 0,
        coinToIdrRate: 1,
        fireToIdrRate: 100,
        referralRewardCoin: Math.max(0, Math.round(DEFAULT_GAME_SETTINGS.referralRewardCoin)),
        referralRewardFire: Math.max(0, Math.round(DEFAULT_GAME_SETTINGS.referralRewardFire)),
        referralRewardIdr: Math.max(0, Math.round(DEFAULT_GAME_SETTINGS.referralRewardIdr)),
        minWithdrawIdr: 20000,
        maintenanceMode: Boolean(DEFAULT_GAME_SETTINGS.maintenanceMode),
        announcementText: DEFAULT_GAME_SETTINGS.announcementText.slice(0, 240),
        updatedAt: serverTimestamp(),
      });
    }

    // Seed or migrate levels to COINOVA progression with Rupiah upgrade prices
    const level2Ref = doc(db, 'levels', 'level_2');
    const level2Snap = await getDoc(level2Ref);
    const needsLevelSeed =
      !level2Snap.exists() || level2Snap.data()?.priceIdr !== 25000;
    if (needsLevelSeed) {
      for (const lvl of DEFAULT_DRAGON_LEVELS) {
        await setDoc(doc(db, 'levels', `level_${lvl.level}`), {
          level: lvl.level,
          name: lvl.name.slice(0, 60),
          titleBadge: lvl.titleBadge.slice(0, 60),
          priceIdr: lvl.priceIdr,
          requiredCoins: 0,
          requiredFire: 0,
          tapMultiplier: lvl.tapMultiplier,
          maxEnergy: lvl.maxEnergy,
          dailyFireBonus: lvl.dailyFireBonus,
          updatedAt: serverTimestamp(),
        });
      }
    }

    // Seed default COINOVA tasks if missing (including Install APK mission)
    const firstTaskRef = doc(db, 'tasks', DEFAULT_TASKS[0].taskId);
    const apkTaskRef = doc(db, 'tasks', 'vp_install_apk');
    const [firstTaskSnap, apkTaskSnap] = await Promise.all([
      getDoc(firstTaskRef),
      getDoc(apkTaskRef),
    ]);
    if (!firstTaskSnap.exists() || !apkTaskSnap.exists()) {
      for (const t of DEFAULT_TASKS) {
        await setDoc(doc(db, 'tasks', t.taskId), {
          taskId: t.taskId,
          title: t.title.slice(0, 100),
          description: t.description.slice(0, 240),
          category: t.category,
          targetCount: t.targetCount,
          metricType: t.metricType,
          coinReward: t.coinReward,
          fireReward: t.fireReward,
          idrReward: t.idrReward,
          isActive: t.isActive,
          updatedAt: serverTimestamp(),
        });
      }
    }

    // Seed default reward codes if missing
    const firstCodeRef = doc(db, 'reward_codes', DEFAULT_REWARD_CODES[0].code);
    const firstCodeSnap = await getDoc(firstCodeRef);
    if (!firstCodeSnap.exists()) {
      for (const rc of DEFAULT_REWARD_CODES) {
        await setDoc(doc(db, 'reward_codes', rc.code), {
          code: rc.code,
          description: rc.description.slice(0, 160),
          coinReward: rc.coinReward,
          fireReward: rc.fireReward,
          idrReward: rc.idrReward,
          maxClaims: rc.maxClaims,
          claimedCount: 0,
          isActive: rc.isActive,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'game_settings/catalog_seed');
  }
}

export async function bootstrapAuthenticatedUser(
  fbUser: User
): Promise<{
  user: UserAccount;
  profile: UserProfile;
  wallet: UserWallet;
}> {
  const uid = sanitizeId(fbUser.uid);
  const userRef = doc(db, 'users', uid);
  const profileRef = doc(db, 'profiles', uid);
  const walletRef = doc(db, 'wallets', uid);

  try {
    const [userSnap, profileSnap, walletSnap] = await Promise.all([
      getDoc(userRef),
      getDoc(profileRef),
      getDoc(walletRef),
    ]);

    const cleanUsername = (fbUser.displayName || fbUser.email?.split('@')[0] || 'PlayerCoinova')
      .replace(/[^a-zA-Z0-9_ ]/g, '')
      .trim()
      .slice(0, 32) || 'PlayerCoinova';
    const refCode = sanitizeId(`CNV-${uid.slice(0, 6).toUpperCase()}`);

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid,
        username: cleanUsername.length >= 2 ? cleanUsername : 'PlayerCoinova',
        avatarUrl: (fbUser.photoURL || '').slice(0, 500),
        referralCode: refCode,
        dragonLevel: 1,
        totalTaps: 0,
        dailyStreak: 0,
        lastCheckInDate: 'none',
        lastConvertDate: 'none',
        dailyConvertedFire: 0,
        cycleProgress: 0,
        dailyClaimsUsed: 0,
        lastClaimDate: getTodayKey(),
        role: 'player',
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (!profileSnap.exists()) {
      await setDoc(profileRef, {
        uid,
        email: (fbUser.email || 'player@coinova.app').slice(0, 256),
        fullName: cleanUsername.slice(0, 80),
        phone: '',
        defaultEwallet: 'DANA',
        ewalletNumber: '',
        ewalletAccountName: cleanUsername.slice(0, 80),
        pinHash: '',
        notificationsEnabled: true,
        updatedAt: serverTimestamp(),
      });
    }

    if (!walletSnap.exists()) {
      await setDoc(walletRef, {
        uid,
        coinBalance: 1000,
        fireBalance: 5,
        idrBalance: 10000,
        lockedIdrBalance: 0,
        energy: 500,
        maxEnergy: 500,
        totalEarnedCoins: 1000,
        totalEarnedFire: 5,
        totalWithdrawnIdr: 0,
        updatedAt: serverTimestamp(),
      });

      const txId = generateSafeId('tx_welcome');
      await setDoc(doc(db, 'wallet_transactions', txId), {
        uid,
        category: 'REWARD',
        direction: 'CREDIT',
        currency: 'COIN',
        amount: 1000,
        description: 'Bonus Selamat Datang Ksatria Baru (1.000 Coin + 5 Fire + Rp10.000)',
        referenceId: 'welcome_bonus',
        createdAt: serverTimestamp(),
      });

      const notifId = generateSafeId('notif_welcome');
      await setDoc(doc(db, 'notifications', notifId), {
        uid,
        title: 'Selamat Datang di COINOVA!',
        message: 'Kamu menerima modal awal Koin COINOVA, Diamond, dan Saldo Saya.',
        type: 'REWARD',
        isRead: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const [freshUser, freshProfile, freshWallet] = await Promise.all([
      getDoc(userRef),
      getDoc(profileRef),
      getDoc(walletRef),
    ]);

    const uData = freshUser.data()!;
    const pData = freshProfile.data()!;
    const wData = freshWallet.data()!;

    return {
      user: {
        uid: uData.uid,
        username: uData.username,
        avatarUrl: uData.avatarUrl || '',
        referralCode: uData.referralCode,
        referredByUid: uData.referredByUid,
        referredByCode: uData.referredByCode,
        dragonLevel: uData.dragonLevel,
        totalTaps: uData.totalTaps,
        dailyStreak: uData.dailyStreak,
        lastCheckInDate: uData.lastCheckInDate,
        lastConvertDate: uData.lastConvertDate || 'none',
        dailyConvertedFire: uData.dailyConvertedFire || 0,
        cycleProgress: uData.cycleProgress || 0,
        dailyClaimsUsed: uData.dailyClaimsUsed || 0,
        lastClaimDate: uData.lastClaimDate || getTodayKey(),
        role: uData.role,
        status: uData.status,
        createdAt: toIsoString(uData.createdAt),
        updatedAt: toIsoString(uData.updatedAt),
      },
      profile: {
        uid: pData.uid,
        email: pData.email,
        fullName: pData.fullName,
        phone: pData.phone,
        defaultEwallet: pData.defaultEwallet,
        ewalletNumber: pData.ewalletNumber,
        ewalletAccountName: pData.ewalletAccountName,
        pinHash: pData.pinHash,
        notificationsEnabled: pData.notificationsEnabled,
        updatedAt: toIsoString(pData.updatedAt),
      },
      wallet: {
        uid: wData.uid,
        coinBalance: wData.coinBalance,
        fireBalance: wData.fireBalance,
        idrBalance: wData.idrBalance,
        lockedIdrBalance: wData.lockedIdrBalance,
        energy: wData.energy,
        maxEnergy: wData.maxEnergy,
        totalEarnedCoins: wData.totalEarnedCoins,
        totalEarnedFire: wData.totalEarnedFire,
        totalWithdrawnIdr: wData.totalWithdrawnIdr,
        updatedAt: toIsoString(wData.updatedAt),
      },
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

// ============================================================================
// ATOMIC GAMEPLAY TRANSACTIONS
// ============================================================================

export async function commitTapBatchFirestore(
  uid: string,
  tapCount: number,
  coinsEarned: number,
  fireEarned: number,
  energySpent: number
): Promise<void> {
  if (tapCount <= 0 || coinsEarned <= 0) return;
  const userRef = doc(db, 'users', uid);
  const walletRef = doc(db, 'wallets', uid);
  const txId = generateSafeId('tx_tap');
  const txRef = doc(db, 'wallet_transactions', txId);

  try {
    await runTransaction(db, async (transaction) => {
      const [uSnap, wSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(walletRef),
      ]);
      if (!uSnap.exists() || !wSnap.exists()) {
        throw new Error('Data pengguna tidak ditemukan.');
      }

      const u = uSnap.data();
      const w = wSnap.data();

      const nextEnergy = Math.max(0, w.energy - energySpent);
      const nextCoins = w.coinBalance + coinsEarned;
      const nextIdr = calculateIdrFromCoins(nextCoins);
      const nextFire = w.fireBalance + fireEarned;

      transaction.update(userRef, {
        totalTaps: u.totalTaps + tapCount,
        updatedAt: serverTimestamp(),
      });

      transaction.update(walletRef, {
        coinBalance: nextCoins,
        idrBalance: nextIdr,
        fireBalance: nextFire,
        energy: nextEnergy,
        totalEarnedCoins: w.totalEarnedCoins + coinsEarned,
        totalEarnedFire: w.totalEarnedFire + fireEarned,
        updatedAt: serverTimestamp(),
      });

      transaction.set(txRef, {
        uid,
        category: 'PENDAPATAN',
        direction: 'CREDIT',
        currency: 'COIN',
        amount: coinsEarned,
        description: `Panen Arena COINOVA (${tapCount}x Tap${fireEarned > 0 ? ` + ${fireEarned} Diamond` : ''})`.slice(0, 200),
        referenceId: txId,
        status: 'SUCCESS',
        balanceBefore: w.coinBalance,
        balanceAfter: nextCoins,
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `wallets/${uid}`);
  }
}

export async function claimDailyCheckInFirestore(
  uid: string,
  rewardCoins: number,
  rewardFire: number
): Promise<number> {
  const today = getTodayKey();
  const userRef = doc(db, 'users', uid);
  const walletRef = doc(db, 'wallets', uid);
  const txId = generateSafeId('tx_checkin');
  const txRef = doc(db, 'wallet_transactions', txId);

  try {
    return await runTransaction(db, async (transaction) => {
      const [uSnap, wSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(walletRef),
      ]);
      if (!uSnap.exists() || !wSnap.exists()) throw new Error('Akun tidak ditemukan.');

      const u = uSnap.data();
      const w = wSnap.data();

      if (u.lastCheckInDate === today) {
        throw new Error('Kamu sudah klaim Daily Check-in hari ini.');
      }

      const nextStreak = (u.dailyStreak % 7) + 1;
      const nextCoins = w.coinBalance + rewardCoins;
      const nextIdr = calculateIdrFromCoins(nextCoins);

      transaction.update(userRef, {
        dailyStreak: nextStreak,
        lastCheckInDate: today,
        updatedAt: serverTimestamp(),
      });

      transaction.update(walletRef, {
        coinBalance: nextCoins,
        idrBalance: nextIdr,
        fireBalance: w.fireBalance + rewardFire,
        totalEarnedCoins: w.totalEarnedCoins + rewardCoins,
        totalEarnedFire: w.totalEarnedFire + rewardFire,
        updatedAt: serverTimestamp(),
      });

      transaction.set(txRef, {
        uid,
        category: 'REWARD',
        direction: 'CREDIT',
        currency: 'COIN',
        amount: rewardCoins,
        description: `Daily Check-in Hari ke-${nextStreak} (+${rewardCoins} Coin & +${rewardFire} Diamond)`,
        referenceId: `checkin_${today}`,
        status: 'SUCCESS',
        balanceBefore: w.coinBalance,
        balanceAfter: nextCoins,
        createdAt: serverTimestamp(),
      });

      return nextStreak;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export async function createLevelUpgradeOrderFirestore(
  uid: string,
  username: string,
  targetLevelConfig: DragonLevelConfig,
  paymentMethod: UpgradePaymentMethod
): Promise<LevelUpgradeOrder> {
  if (targetLevelConfig.level < 2 || targetLevelConfig.level > 5) {
    throw new Error('Level upgrade harus berada di antara Level 2 hingga Level 5.');
  }
  const priceIdr = Math.max(10000, Math.floor(targetLevelConfig.priceIdr || 25000));
  const orderId = generateSafeId(`ord_lvl${targetLevelConfig.level}`);
  const orderRef = doc(db, 'upgrade_orders', orderId);
  const userRef = doc(db, 'users', uid);

  try {
    await runTransaction(db, async (transaction) => {
      const uSnap = await transaction.get(userRef);
      if (!uSnap.exists()) throw new Error('Data pengguna tidak ditemukan.');
      const u = uSnap.data();

      if ((u.dragonLevel || 1) >= targetLevelConfig.level) {
        throw new Error(`Level ${targetLevelConfig.name} sudah aktif di akun Anda.`);
      }

      transaction.set(orderRef, {
        orderId,
        uid,
        username: username.slice(0, 40),
        targetLevel: targetLevelConfig.level,
        levelName: targetLevelConfig.name.slice(0, 60),
        priceIdr,
        paymentMethod,
        paymentReference: '-',
        paymentProofImage: '',
        status: 'WAITING_PAYMENT',
        adminNote: `PENDING PAYMENT: Menunggu pembayaran Rp${priceIdr.toLocaleString('id-ID')} via QRIS / ${paymentMethod}.`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    const now = new Date().toISOString();
    return {
      orderId,
      uid,
      username: username.slice(0, 40),
      targetLevel: targetLevelConfig.level,
      levelName: targetLevelConfig.name.slice(0, 60),
      priceIdr,
      paymentMethod,
      paymentReference: '-',
      paymentProofImage: '',
      status: 'WAITING_PAYMENT',
      adminNote: `PENDING PAYMENT: Menunggu pembayaran Rp${priceIdr.toLocaleString('id-ID')} via QRIS / ${paymentMethod}.`,
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `upgrade_orders/${orderId}`);
  }
}

export async function confirmLevelUpgradePaymentFirestore(
  uid: string,
  orderId: string,
  paymentReference: string,
  paymentProofImage?: string
): Promise<void> {
  const cleanRef = (paymentReference.trim() || `BUKTI-QRIS-${Date.now()}`).slice(0, 100);
  const cleanProof = (paymentProofImage || '').trim();
  if (!cleanProof && cleanRef.length < 3) {
    throw new Error('Wajib mengunggah foto bukti pembayaran atau mengisi nomor referensi transaksi.');
  }
  const orderRef = doc(db, 'upgrade_orders', orderId);
  const notifId = generateSafeId('notif_ord');
  const notifRef = doc(db, 'notifications', notifId);

  try {
    await runTransaction(db, async (transaction) => {
      const oSnap = await transaction.get(orderRef);
      if (!oSnap.exists()) throw new Error('Order pembelian level tidak ditemukan.');
      const o = oSnap.data();

      if (o.uid !== uid) {
        throw new Error('Anda tidak memiliki akses ke order ini.');
      }
      if (o.status !== 'WAITING_PAYMENT') {
        throw new Error('Order ini sudah dikirim untuk verifikasi atau selesai diproses.');
      }

      transaction.update(orderRef, {
        paymentReference: cleanRef,
        paymentProofImage: cleanProof,
        status: 'PENDING_VERIFICATION',
        adminNote: `PAYMENT SUBMITTED / UNDER REVIEW: Bukti pembayaran (${cleanRef}) diterima. Menunggu verifikasi Admin.`,
        updatedAt: serverTimestamp(),
      });

      transaction.set(notifRef, {
        uid,
        title: `Bukti Pembayaran Lv.${o.targetLevel} (${o.levelName}) Terkirim`,
        message: `Order #${orderId.slice(-8).toUpperCase()} senilai Rp${Number(o.priceIdr).toLocaleString('id-ID')} sedang diperiksa Admin (UNDER REVIEW). Level akan aktif setelah disetujui (APPROVED).`,
        type: 'INFO',
        isRead: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `upgrade_orders/${orderId}`);
  }
}

export async function convertCoinToFireFirestore(
  uid: string,
  fireToObtain: number
): Promise<{ fireGained: number; coinsSpent: number; dailyConvertedFire: number; idrEquivalentGained: number }> {
  const cleanFire = Math.max(0, Math.floor(fireToObtain));
  if (cleanFire < 1) {
    throw new Error('Minimal konversi adalah 1.000 Koin COINOVA (1 Diamond).');
  }
  if (cleanFire > 10) {
    throw new Error('Batas konversi hari ini telah tercapai. Maksimal 10 Diamond per hari.');
  }

  const coinsRequired = cleanFire * 1000;
  const today = getTodayKey();

  const userRef = doc(db, 'users', uid);
  const walletRef = doc(db, 'wallets', uid);
  const txId = generateSafeId('tx_conv');
  const txRef = doc(db, 'wallet_transactions', txId);

  try {
    let nextDailyFire = 0;
    await runTransaction(db, async (transaction) => {
      const [uSnap, wSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(walletRef),
      ]);
      if (!uSnap.exists() || !wSnap.exists()) throw new Error('Dompet tidak ditemukan.');
      const u = uSnap.data();
      const w = wSnap.data();

      if ((u.dragonLevel || 1) < 4) {
        throw new Error(
          'Fitur Konversi Koin ke Diamond hanya tersedia untuk 2 Tier Tertinggi (Tier Pro Lv.4 & Tier Ultimate Lv.5).'
        );
      }

      const usedToday = u.lastConvertDate === today ? (u.dailyConvertedFire || 0) : 0;
      if (usedToday >= 10 || usedToday + cleanFire > 10) {
        throw new Error('Batas konversi hari ini telah tercapai. Maksimal 10 Diamond per hari.');
      }

      if (w.coinBalance < coinsRequired) {
        throw new Error('Saldo Koin COINOVA tidak mencukupi.');
      }

      nextDailyFire = usedToday + cleanFire;
      const nextCoins = Math.max(0, w.coinBalance - coinsRequired);
      const nextIdr = calculateIdrFromCoins(nextCoins);

      transaction.update(userRef, {
        lastConvertDate: today,
        dailyConvertedFire: nextDailyFire,
        updatedAt: serverTimestamp(),
      });

      transaction.update(walletRef, {
        coinBalance: nextCoins,
        idrBalance: nextIdr,
        fireBalance: w.fireBalance + cleanFire,
        totalEarnedFire: w.totalEarnedFire + cleanFire,
        updatedAt: serverTimestamp(),
      });

      transaction.set(txRef, {
        id: txId,
        uid,
        category: 'KONVERSI',
        direction: 'CREDIT',
        currency: 'FIRE',
        amount: cleanFire,
        description: `Konversi ${coinsRequired.toLocaleString('id-ID')} Koin COINOVA → +${cleanFire} Diamond (${nextDailyFire}/10 hari ini)`.slice(0, 200),
        referenceId: txId,
        status: 'SUCCESS',
        balanceBefore: w.coinBalance,
        balanceAfter: nextCoins,
        createdAt: serverTimestamp(),
      });
    });

    return {
      fireGained: cleanFire,
      coinsSpent: coinsRequired,
      dailyConvertedFire: nextDailyFire,
      idrEquivalentGained: 0,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `wallets/${uid}`);
  }
}

export async function claimTaskRewardFirestore(
  uid: string,
  task: GameTask
): Promise<TaskClaim> {
  const periodSuffix = task.category === 'DAILY' ? `_${getTodayKey()}` : '';
  const claimId = sanitizeId(`claim_${uid}_${task.taskId}${periodSuffix}`);
  const claimRef = doc(db, 'task_claims', claimId);
  const walletRef = doc(db, 'wallets', uid);
  const txId = generateSafeId('tx_task');
  const txRef = doc(db, 'wallet_transactions', txId);

  try {
    await runTransaction(db, async (transaction) => {
      const [claimSnap, wSnap] = await Promise.all([
        transaction.get(claimRef),
        transaction.get(walletRef),
      ]);

      if (claimSnap.exists()) {
        throw new Error('Misi ini sudah pernah kamu klaim.');
      }
      if (!wSnap.exists()) {
        throw new Error('Dompet tidak ditemukan.');
      }

      const w = wSnap.data();
      const nextCoins = w.coinBalance + task.coinReward;
      const nextIdr = calculateIdrFromCoins(nextCoins);

      transaction.set(claimRef, {
        claimId,
        uid,
        taskId: task.taskId,
        taskTitle: task.title.slice(0, 100),
        coinReward: task.coinReward,
        fireReward: task.fireReward,
        idrReward: calculateIdrFromCoins(task.coinReward),
        claimedAt: serverTimestamp(),
      });

      transaction.update(walletRef, {
        coinBalance: nextCoins,
        idrBalance: nextIdr,
        fireBalance: w.fireBalance + task.fireReward,
        totalEarnedCoins: w.totalEarnedCoins + task.coinReward,
        totalEarnedFire: w.totalEarnedFire + task.fireReward,
        updatedAt: serverTimestamp(),
      });

      transaction.set(txRef, {
        uid,
        category: 'TASK',
        direction: 'CREDIT',
        currency: 'COIN',
        amount: task.coinReward,
        description: `Klaim Misi: ${task.title} (+${task.coinReward} Coin, +${task.fireReward} Diamond)`.slice(0, 200),
        referenceId: claimId,
        status: 'SUCCESS',
        balanceBefore: w.coinBalance,
        balanceAfter: nextCoins,
        createdAt: serverTimestamp(),
      });
    });

    return {
      claimId,
      uid,
      taskId: task.taskId,
      taskTitle: task.title,
      coinReward: task.coinReward,
      fireReward: task.fireReward,
      idrReward: task.idrReward,
      claimedAt: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `task_claims/${claimId}`);
  }
}

export async function redeemRewardCodeFirestore(
  uid: string,
  rawCode: string
): Promise<RewardCode> {
  const code = sanitizeId(rawCode.trim().toUpperCase());
  const codeRef = doc(db, 'reward_codes', code);
  const claimId = sanitizeId(`rc_${uid}_${code}`);
  const claimRef = doc(db, 'reward_code_claims', claimId);
  const walletRef = doc(db, 'wallets', uid);
  const txId = generateSafeId('tx_code');
  const txRef = doc(db, 'wallet_transactions', txId);

  try {
    return await runTransaction(db, async (transaction) => {
      const [codeSnap, claimSnap, wSnap] = await Promise.all([
        transaction.get(codeRef),
        transaction.get(claimRef),
        transaction.get(walletRef),
      ]);

      if (!codeSnap.exists()) {
        throw new Error('Kode hadiah tidak ditemukan atau tidak valid.');
      }
      if (claimSnap.exists()) {
        throw new Error('Kode hadiah ini sudah pernah kamu klaim sebelumnya.');
      }
      if (!wSnap.exists()) {
        throw new Error('Dompet tidak ditemukan.');
      }

      const rc = codeSnap.data() as RewardCode;
      if (!rc.isActive) {
        throw new Error('Kode hadiah ini sudah tidak aktif.');
      }
      if (rc.claimedCount >= rc.maxClaims) {
        throw new Error('Kuota klaim untuk kode hadiah ini sudah habis.');
      }

      const w = wSnap.data();
      const nextCoins = w.coinBalance + rc.coinReward;
      const nextIdr = calculateIdrFromCoins(nextCoins);

      transaction.update(codeRef, {
        claimedCount: rc.claimedCount + 1,
        updatedAt: serverTimestamp(),
      });

      transaction.set(claimRef, {
        claimId,
        uid,
        code,
        coinReward: rc.coinReward,
        fireReward: rc.fireReward,
        idrReward: calculateIdrFromCoins(rc.coinReward),
        claimedAt: serverTimestamp(),
      });

      transaction.update(walletRef, {
        coinBalance: nextCoins,
        idrBalance: nextIdr,
        fireBalance: w.fireBalance + rc.fireReward,
        totalEarnedCoins: w.totalEarnedCoins + rc.coinReward,
        totalEarnedFire: w.totalEarnedFire + rc.fireReward,
        updatedAt: serverTimestamp(),
      });

      transaction.set(txRef, {
        uid,
        category: 'REWARD',
        direction: 'CREDIT',
        currency: 'COIN',
        amount: rc.coinReward,
        description: `Klaim Kode Hadiah ${code} (+${rc.coinReward} Coin, +${rc.fireReward} Diamond)`.slice(0, 200),
        referenceId: claimId,
        status: 'SUCCESS',
        balanceBefore: w.coinBalance,
        balanceAfter: nextCoins,
        createdAt: serverTimestamp(),
      });

      return {
        ...rc,
        claimedCount: rc.claimedCount + 1,
        updatedAt: new Date().toISOString(),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `reward_code_claims/${claimId}`);
  }
}

export async function submitCreatorContentFirestore(
  uid: string,
  username: string,
  platform: CreatorPlatform,
  contentUrl: string,
  caption: string
): Promise<CreatorSubmission> {
  const submissionId = generateSafeId('sub');
  const subRef = doc(db, 'creator_submissions', submissionId);

  try {
    const cleanUrl = contentUrl.trim().slice(0, 400);
    const cleanCaption = (caption.trim() || `Konten ${platform} COINOVA`).slice(0, 240);

    await setDoc(subRef, {
      submissionId,
      uid,
      username: username.slice(0, 40),
      platform,
      contentUrl: cleanUrl,
      caption: cleanCaption,
      status: 'PENDING',
      rewardCoin: 10000,
      rewardFire: 50,
      rewardIdr: 10000,
      adminNote: 'Menunggu verifikasi tim moderator kerajaan.',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const now = new Date().toISOString();
    return {
      submissionId,
      uid,
      username,
      platform,
      contentUrl: cleanUrl,
      caption: cleanCaption,
      status: 'PENDING',
      rewardCoin: 10000,
      rewardFire: 50,
      rewardIdr: 10000,
      adminNote: 'Menunggu verifikasi tim moderator kerajaan.',
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `creator_submissions/${submissionId}`);
  }
}

export async function requestManualWithdrawalFirestore(
  uid: string,
  username: string,
  method: EWalletMethod,
  accountNumber: string,
  accountName: string,
  amount: number
): Promise<WithdrawalRecord> {
  const cleanAmount = Math.floor(Number(amount) || 0);
  if (!VALID_WITHDRAW_COIN_TIERS.includes(cleanAmount)) {
    throw new Error(
      'Nominal penarikan harus salah satu paket resmi: 20.000, 50.000, 100.000, 200.000, 500.000, atau 1.000.000 Koin.'
    );
  }

  const withdrawalId = generateSafeId('wd');
  const wdRef = doc(db, 'withdrawals', withdrawalId);
  const walletRef = doc(db, 'wallets', uid);
  const profileRef = doc(db, 'profiles', uid);
  const txId = generateSafeId('tx_wd_hold');
  const txRef = doc(db, 'wallet_transactions', txId);
  const notifId = generateSafeId('notif_wd');
  const notifRef = doc(db, 'notifications', notifId);

  const rawDigits = accountNumber.trim().replace(/[^\d+]/g, '');
  const normalizedPhone = rawDigits.startsWith('+62')
    ? '0' + rawDigits.slice(3)
    : rawDigits.startsWith('62')
    ? '0' + rawDigits.slice(2)
    : rawDigits.replace(/\D/g, '');

  const cleanNumber = normalizedPhone.slice(0, 24);
  const cleanName = accountName.trim().slice(0, 80);

  if (!/^08\d{8,13}$/.test(cleanNumber)) {
    throw new Error(`Nomor akun ${method} tidak valid. Gunakan format nomor HP aktif diawali 08 (10-15 digit).`);
  }
  if (cleanName.length < 2) {
    throw new Error('Nama pemilik akun E-Wallet wajib diisi minimal 2 karakter.');
  }

  try {
    const requiredCoins = calculateCoinsFromIdr(cleanAmount);
    const requiredFire =
      WITHDRAWAL_DIAMOND_MAP[requiredCoins] ??
      calculateRequiredFireForWithdrawal(requiredCoins);

    await runTransaction(db, async (transaction) => {
      const [wSnap, pSnap] = await Promise.all([
        transaction.get(walletRef),
        transaction.get(profileRef),
      ]);
      if (!wSnap.exists()) throw new Error('Dompet tidak ditemukan.');
      const w = wSnap.data();

      const syncedIdr = calculateIdrFromCoins(w.coinBalance);
      if (w.coinBalance < requiredCoins || syncedIdr < cleanAmount) {
        throw new Error(
          `Saldo Koin tidak mencukupi. Butuh ${requiredCoins.toLocaleString('id-ID')} Koin.`
        );
      }
      if (w.fireBalance < requiredFire) {
        throw new Error(
          `Diamond tidak mencukupi (${w.fireBalance}/${requiredFire.toLocaleString('id-ID')} Diamond)! Penarikan ${requiredCoins.toLocaleString('id-ID')} Koin membutuhkan ${requiredFire.toLocaleString('id-ID')} Diamond.`
        );
      }

      const nextCoins = Math.max(0, w.coinBalance - requiredCoins);
      const nextIdr = calculateIdrFromCoins(nextCoins);
      const nextFire = Math.max(0, w.fireBalance - requiredFire);

      if (pSnap.exists()) {
        transaction.update(profileRef, {
          defaultEwallet: method,
          ewalletNumber: cleanNumber,
          ewalletAccountName: cleanName,
          updatedAt: serverTimestamp(),
        });
      }

      // Deduct Coin & Fire and hold IDR balance atomically
      transaction.update(walletRef, {
        coinBalance: nextCoins,
        idrBalance: nextIdr,
        fireBalance: nextFire,
        lockedIdrBalance: w.lockedIdrBalance + amount,
        updatedAt: serverTimestamp(),
      });

      transaction.set(wdRef, {
        withdrawalId,
        uid,
        username: username.slice(0, 40),
        method,
        accountNumber: cleanNumber,
        accountName: cleanName,
        amount,
        coinsSpent: requiredCoins,
        fireSpent: requiredFire,
        status: 'PENDING',
        paymentReference: '-',
        adminNote: 'Permintaan diterima. Saldo ditahan menunggu transfer manual Admin (estimasi maksimal 3x24 jam).',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      transaction.set(txRef, {
        uid,
        category: 'WITHDRAWAL',
        direction: 'HOLD',
        currency: 'IDR',
        amount,
        description: `Request Withdraw Rp${amount.toLocaleString('id-ID')} ke ${method} (${cleanNumber} a/n ${cleanName}) [-${requiredCoins.toLocaleString('id-ID')} Koin & -${requiredFire} Diamond]`.slice(0, 200),
        referenceId: withdrawalId,
        status: 'PENDING',
        balanceBefore: syncedIdr,
        balanceAfter: nextIdr,
        createdAt: serverTimestamp(),
      });

      transaction.set(notifRef, {
        uid,
        title: `Penarikan Rp${amount.toLocaleString('id-ID')} Sedang Diproses`,
        message: `Permintaan withdraw ke ${method} (${cleanNumber}) telah masuk antrean verifikasi manual Admin (proses maksimal 3x24 jam).`,
        type: 'INFO',
        isRead: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    const now = new Date().toISOString();
    return {
      withdrawalId,
      uid,
      username,
      method,
      accountNumber: cleanNumber,
      accountName: cleanName,
      amount,
      coinsSpent: requiredCoins,
      fireSpent: requiredFire,
      status: 'PENDING',
      paymentReference: '-',
      adminNote: 'Permintaan diterima. Saldo ditahan menunggu transfer manual Admin (estimasi maksimal 3x24 jam).',
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `withdrawals/${withdrawalId}`);
  }
}

export async function bindReferralCodeFirestore(
  inviteeUid: string,
  inviteeUsername: string,
  rawCode: string,
  settings: GameSettings
): Promise<ReferralRecord> {
  const cleanCode = sanitizeId(rawCode.trim().toUpperCase());
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('referralCode', '==', cleanCode), limit(1));

  try {
    const qSnap = await getDocs(q);
    if (qSnap.empty) {
      throw new Error('Kode referral tidak ditemukan.');
    }

    const inviterDoc = qSnap.docs[0];
    const inviterUid = inviterDoc.id;
    if (inviterUid === inviteeUid) {
      throw new Error('Kamu tidak dapat menggunakan kode referral milikmu sendiri.');
    }

    const referralId = sanitizeId(`ref_${inviterUid}_${inviteeUid}`);
    const refDocRef = doc(db, 'referrals', referralId);
    const inviteeUserRef = doc(db, 'users', inviteeUid);
    const inviteeWalletRef = doc(db, 'wallets', inviteeUid);
    const txId = generateSafeId('tx_ref_bind');
    const txRef = doc(db, 'wallet_transactions', txId);

    await runTransaction(db, async (transaction) => {
      const [existingRef, uSnap, wSnap] = await Promise.all([
        transaction.get(refDocRef),
        transaction.get(inviteeUserRef),
        transaction.get(inviteeWalletRef),
      ]);

      if (existingRef.exists()) {
        throw new Error('Akun ini sudah terhubung dengan pengundang.');
      }
      if (!uSnap.exists() || !wSnap.exists()) {
        throw new Error('Akun pengguna tidak ditemukan.');
      }

      const u = uSnap.data();
      if (u.referredByCode) {
        throw new Error('Kamu sudah pernah memasukkan kode undangan.');
      }

      const w = wSnap.data();

      transaction.update(inviteeUserRef, {
        referredByUid: inviterUid,
        referredByCode: cleanCode,
        updatedAt: serverTimestamp(),
      });

      // Rule: Invited user joins but is not active = NO immediate reward
      transaction.set(refDocRef, {
        referralId,
        inviterUid,
        inviteeUid,
        inviteeUsername: inviteeUsername.slice(0, 40),
        status: 'PENDING',
        rewardCoin: settings.referralRewardCoin,
        rewardFire: settings.referralRewardFire,
        rewardIdr: settings.referralRewardIdr,
        activeRewardClaimed: false,
        topupRewardClaimed: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    const now = new Date().toISOString();
    return {
      referralId,
      inviterUid,
      inviteeUid,
      inviteeUsername,
      status: 'PENDING',
      rewardCoin: settings.referralRewardCoin,
      rewardFire: settings.referralRewardFire,
      rewardIdr: settings.referralRewardIdr,
      activeRewardClaimed: false,
      topupRewardClaimed: false,
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'referrals/bind');
  }
}

export async function adminProcessReferralFirestore(
  adminUid: string,
  adminEmail: string,
  referral: ReferralRecord,
  milestone: 'ACTIVE' | 'VERIFIED' | 'UPGRADE' | 'REJECTED'
): Promise<void> {
  await assertAdminAuthorized(adminUid, adminEmail);
  const refDocRef = doc(db, 'referrals', referral.referralId);
  const inviterWalletRef = doc(db, 'wallets', referral.inviterUid);
  const txId = generateSafeId('tx_ref_ver');
  const txRef = doc(db, 'wallet_transactions', txId);
  const auditId = generateSafeId('audit_ref');
  const auditRef = doc(db, 'admin_audit_logs', auditId);

  try {
    await runTransaction(db, async (transaction) => {
      const [rSnap, wSnap] = await Promise.all([
        transaction.get(refDocRef),
        transaction.get(inviterWalletRef),
      ]);

      if (!rSnap.exists() || !wSnap.exists()) {
        throw new Error('Data referral atau dompet pengundang tidak ditemukan.');
      }

      const r = rSnap.data();
      const w = wSnap.data();

      if (milestone === 'REJECTED') {
        transaction.update(refDocRef, {
          status: 'REJECTED',
          updatedAt: serverTimestamp(),
        });
      } else if (milestone === 'ACTIVE') {
        if (r.activeRewardClaimed) {
          throw new Error('Milestone Teman Aktif (Diamond) sudah pernah diklaim sebelumnya.');
        }
        const diamondReward = Math.max(1, Number(r.rewardFire || 2));
        transaction.update(refDocRef, {
          status: r.status === 'VERIFIED' ? 'VERIFIED' : 'ACTIVE',
          activeRewardClaimed: true,
          updatedAt: serverTimestamp(),
        });
        transaction.update(inviterWalletRef, {
          fireBalance: w.fireBalance + diamondReward,
          totalEarnedFire: w.totalEarnedFire + diamondReward,
          updatedAt: serverTimestamp(),
        });
        transaction.set(txRef, {
          id: txId,
          uid: referral.inviterUid,
          category: 'REFERRAL',
          direction: 'CREDIT',
          currency: 'FIRE',
          amount: diamondReward,
          description: `Referral Teman Aktif (${referral.inviteeUsername}): +${diamondReward} Diamond`.slice(0, 200),
          referenceId: referral.referralId,
          status: 'SUCCESS',
          createdAt: serverTimestamp(),
        });
      } else if (milestone === 'VERIFIED') {
        if (r.topupRewardClaimed || r.status === 'VERIFIED') {
          throw new Error('Milestone Top-Up Referral (Koin + Diamond) sudah diverifikasi sebelumnya.');
        }
        const coinReward = Math.max(0, Number(r.rewardCoin || 25000));
        const diamondReward = r.activeRewardClaimed ? 8 : 10;
        const nextCoins = w.coinBalance + coinReward;
        const nextIdr = calculateIdrFromCoins(nextCoins);

        transaction.update(refDocRef, {
          status: 'VERIFIED',
          activeRewardClaimed: true,
          topupRewardClaimed: true,
          updatedAt: serverTimestamp(),
        });

        transaction.update(inviterWalletRef, {
          coinBalance: nextCoins,
          idrBalance: nextIdr,
          fireBalance: w.fireBalance + diamondReward,
          totalEarnedCoins: w.totalEarnedCoins + coinReward,
          totalEarnedFire: w.totalEarnedFire + diamondReward,
          updatedAt: serverTimestamp(),
        });

        transaction.set(txRef, {
          id: txId,
          uid: referral.inviterUid,
          category: 'REFERRAL',
          direction: 'CREDIT',
          currency: 'COIN',
          amount: coinReward,
          description: `Referral Top-Up Valid (${referral.inviteeUsername}): +${coinReward.toLocaleString('id-ID')} Koin & +${diamondReward} Diamond`.slice(0, 200),
          referenceId: referral.referralId,
          status: 'SUCCESS',
          balanceBefore: w.coinBalance,
          balanceAfter: nextCoins,
          createdAt: serverTimestamp(),
        });
      }

      transaction.set(auditRef, {
        adminUid,
        adminEmail: adminEmail.slice(0, 256),
        action: `REFERRAL_${milestone}`,
        targetId: referral.referralId,
        details: `Processed referral ${referral.referralId} (${referral.inviteeUsername}) -> ${milestone}`.slice(0, 400),
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `referrals/${referral.referralId}`);
  }
}

export const verifyAndClaimReferralFirestore = adminProcessReferralFirestore;

export async function updateUserProfileFirestore(
  uid: string,
  username: string,
  profileUpdates: {
    fullName: string;
    phone: string;
    defaultEwallet: EWalletMethod;
    ewalletNumber: string;
    ewalletAccountName: string;
    pinHash: string;
    notificationsEnabled: boolean;
  }
): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const profileRef = doc(db, 'profiles', uid);

  try {
    await Promise.all([
      updateDoc(userRef, {
        username: username.trim().slice(0, 40) || 'PlayerCoinova',
        updatedAt: serverTimestamp(),
      }),
      updateDoc(profileRef, {
        fullName: profileUpdates.fullName.trim().slice(0, 80),
        phone: profileUpdates.phone.trim().slice(0, 24),
        defaultEwallet: profileUpdates.defaultEwallet,
        ewalletNumber: profileUpdates.ewalletNumber.trim().slice(0, 24),
        ewalletAccountName: profileUpdates.ewalletAccountName.trim().slice(0, 80),
        pinHash: profileUpdates.pinHash.slice(0, 128),
        notificationsEnabled: profileUpdates.notificationsEnabled,
        updatedAt: serverTimestamp(),
      }),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `profiles/${uid}`);
  }
}

// ============================================================================
// ADMIN DASHBOARD OPERATIONS (WITH MANDATORY AUDIT LOGS & ROLE VERIFICATION)
// ============================================================================

async function assertAdminAuthorized(adminUid: string, adminEmail: string): Promise<void> {
  if (!adminUid) {
    throw new Error('Akses ditolak: Sesi Admin tidak valid.');
  }
  const adminRef = doc(db, 'users', adminUid);
  const adminSnap = await getDoc(adminRef);
  const isRootEmail = adminEmail.trim().toLowerCase() === 'lordzmbang08@gmail.com';
  if ((!adminSnap.exists() || adminSnap.data()?.role !== 'admin') && !isRootEmail) {
    throw new Error('Akses ditolak: Hanya Admin terotorisasi yang dapat menjalankan operasi ini.');
  }
}

export async function adminProcessWithdrawalFirestore(
  adminUid: string,
  adminEmail: string,
  withdrawal: WithdrawalRecord,
  newStatus: WithdrawalStatus,
  paymentReference: string,
  adminNote: string
): Promise<void> {
  await assertAdminAuthorized(adminUid, adminEmail);
  const wdRef = doc(db, 'withdrawals', withdrawal.withdrawalId);
  const walletRef = doc(db, 'wallets', withdrawal.uid);
  const txId = generateSafeId('tx_wd_admin');
  const txRef = doc(db, 'wallet_transactions', txId);
  const notifId = generateSafeId('notif_wd_admin');
  const notifRef = doc(db, 'notifications', notifId);
  const auditId = generateSafeId('audit_wd');
  const auditRef = doc(db, 'admin_audit_logs', auditId);

  const cleanRef = (paymentReference.trim() || '-').slice(0, 160);
  const cleanNote = (adminNote.trim() || `Status diubah ke ${newStatus}`).slice(0, 240);

  try {
    await runTransaction(db, async (transaction) => {
      const [wdSnap, wSnap] = await Promise.all([
        transaction.get(wdRef),
        transaction.get(walletRef),
      ]);
      if (!wdSnap.exists() || !wSnap.exists()) {
        throw new Error('Data penarikan atau dompet tidak ditemukan.');
      }

      const currentWd = wdSnap.data();
      const w = wSnap.data();

      transaction.update(wdRef, {
        status: newStatus,
        paymentReference: cleanRef,
        adminNote: cleanNote,
        updatedAt: serverTimestamp(),
      });

      if (newStatus === 'PAID' && currentWd.status !== 'PAID') {
        const nextLocked = Math.max(0, w.lockedIdrBalance - withdrawal.amount);
        transaction.update(walletRef, {
          lockedIdrBalance: nextLocked,
          totalWithdrawnIdr: w.totalWithdrawnIdr + withdrawal.amount,
          updatedAt: serverTimestamp(),
        });

        transaction.set(txRef, {
          uid: withdrawal.uid,
          category: 'WITHDRAWAL',
          direction: 'DEBIT',
          currency: 'IDR',
          amount: withdrawal.amount,
          description: `Withdraw PAID ke ${withdrawal.method} (${withdrawal.accountNumber}) Ref: ${cleanRef}`.slice(0, 200),
          referenceId: withdrawal.withdrawalId,
          createdAt: serverTimestamp(),
        });

        transaction.set(notifRef, {
          uid: withdrawal.uid,
          title: `Penarikan Rp${withdrawal.amount.toLocaleString('id-ID')} BERHASIL (PAID)`,
          message: `Dana telah ditransfer manual ke ${withdrawal.method} (${withdrawal.accountNumber}). Ref: ${cleanRef}`,
          type: 'SUCCESS',
          isRead: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (newStatus === 'REJECTED' && currentWd.status !== 'REJECTED') {
        // Refund locked balance, Koin COINOVA, and Diamond back to user wallet
        const nextLocked = Math.max(0, w.lockedIdrBalance - withdrawal.amount);
        const refundCoins = withdrawal.coinsSpent || calculateCoinsFromIdr(withdrawal.amount);
        const refundFire = withdrawal.fireSpent || calculateRequiredFireForWithdrawal(withdrawal.amount);
        const nextCoins = w.coinBalance + refundCoins;
        const nextIdr = calculateIdrFromCoins(nextCoins);

        transaction.update(walletRef, {
          coinBalance: nextCoins,
          idrBalance: nextIdr,
          fireBalance: w.fireBalance + refundFire,
          lockedIdrBalance: nextLocked,
          updatedAt: serverTimestamp(),
        });

        transaction.set(txRef, {
          uid: withdrawal.uid,
          category: 'WITHDRAWAL',
          direction: 'REFUND',
          currency: 'IDR',
          amount: withdrawal.amount,
          description: `Refund Withdraw Ditolak (+${refundCoins.toLocaleString('id-ID')} Coin & +${refundFire} Api): ${cleanNote}`.slice(0, 200),
          referenceId: withdrawal.withdrawalId,
          status: 'REJECTED',
          balanceBefore: w.idrBalance,
          balanceAfter: nextIdr,
          createdAt: serverTimestamp(),
        });

        transaction.set(notifRef, {
          uid: withdrawal.uid,
          title: `Penarikan Rp${withdrawal.amount.toLocaleString('id-ID')} Ditolak & Saldo Dikembalikan`,
          message: `Alasan: ${cleanNote}. Saldo Rp${withdrawal.amount.toLocaleString('id-ID')} telah dikembalikan ke dompetmu.`,
          type: 'WARNING',
          isRead: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      transaction.set(auditRef, {
        adminUid,
        adminEmail: adminEmail.slice(0, 256),
        action: `WITHDRAWAL_${newStatus}`,
        targetId: withdrawal.withdrawalId,
        details: `Processed withdrawal Rp${withdrawal.amount} for ${withdrawal.username} -> ${newStatus} (Ref: ${cleanRef})`.slice(0, 400),
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `withdrawals/${withdrawal.withdrawalId}`);
  }
}

export async function adminReviewCreatorSubmissionFirestore(
  adminUid: string,
  adminEmail: string,
  submission: CreatorSubmission,
  newStatus: CreatorStatus,
  rewardCoin: number,
  rewardFire: number,
  rewardIdr: number,
  adminNote: string
): Promise<void> {
  await assertAdminAuthorized(adminUid, adminEmail);
  const subRef = doc(db, 'creator_submissions', submission.submissionId);
  const walletRef = doc(db, 'wallets', submission.uid);
  const txId = generateSafeId('tx_creator');
  const txRef = doc(db, 'wallet_transactions', txId);
  const notifId = generateSafeId('notif_creator');
  const notifRef = doc(db, 'notifications', notifId);
  const auditId = generateSafeId('audit_creator');
  const auditRef = doc(db, 'admin_audit_logs', auditId);

  const cleanNote = (adminNote.trim() || `Review konten ${newStatus}`).slice(0, 240);

  try {
    await runTransaction(db, async (transaction) => {
      const [sSnap, wSnap] = await Promise.all([
        transaction.get(subRef),
        transaction.get(walletRef),
      ]);
      if (!sSnap.exists() || !wSnap.exists()) {
        throw new Error('Data konten atau dompet tidak ditemukan.');
      }

      const currentSub = sSnap.data();
      const w = wSnap.data();

      transaction.update(subRef, {
        status: newStatus,
        rewardCoin,
        rewardFire,
        rewardIdr,
        adminNote: cleanNote,
        updatedAt: serverTimestamp(),
      });

      if (newStatus === 'APPROVED' && currentSub.status !== 'APPROVED') {
        transaction.update(walletRef, {
          coinBalance: w.coinBalance + rewardCoin,
          fireBalance: w.fireBalance + rewardFire,
          idrBalance: w.idrBalance + rewardIdr,
          totalEarnedCoins: w.totalEarnedCoins + rewardCoin,
          totalEarnedFire: w.totalEarnedFire + rewardFire,
          updatedAt: serverTimestamp(),
        });

        transaction.set(txRef, {
          uid: submission.uid,
          category: 'TASK',
          direction: 'CREDIT',
          currency: rewardIdr > 0 ? 'IDR' : 'COIN',
          amount: rewardIdr > 0 ? rewardIdr : rewardCoin,
          description: `Reward Konten Creator ${submission.platform} Disetujui (+${rewardCoin} Coin, +${rewardFire} Fire, +Rp${rewardIdr})`.slice(0, 200),
          referenceId: submission.submissionId,
          createdAt: serverTimestamp(),
        });

        transaction.set(notifRef, {
          uid: submission.uid,
          title: `Konten ${submission.platform} Kamu Disetujui!`,
          message: `Kamu mendapatkan +${rewardCoin.toLocaleString('id-ID')} Coin, +${rewardFire} Diamond, dan +Rp${rewardIdr.toLocaleString('id-ID')}!`,
          type: 'REWARD',
          isRead: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      transaction.set(auditRef, {
        adminUid,
        adminEmail: adminEmail.slice(0, 256),
        action: `CREATOR_${newStatus}`,
        targetId: submission.submissionId,
        details: `Reviewed ${submission.platform} content by ${submission.username}: ${newStatus} (${cleanNote})`.slice(0, 400),
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `creator_submissions/${submission.submissionId}`);
  }
}

export async function adminAdjustWalletFirestore(
  adminUid: string,
  adminEmail: string,
  targetUid: string,
  currency: CurrencyType,
  direction: 'CREDIT' | 'DEBIT',
  amount: number,
  reason: string
): Promise<void> {
  await assertAdminAuthorized(adminUid, adminEmail);
  if (amount <= 0) throw new Error('Nominal penyesuaian harus lebih besar dari 0.');
  const walletRef = doc(db, 'wallets', targetUid);
  const txId = generateSafeId('tx_adj');
  const txRef = doc(db, 'wallet_transactions', txId);
  const auditId = generateSafeId('audit_adj');
  const auditRef = doc(db, 'admin_audit_logs', auditId);
  const cleanReason = (reason.trim() || 'Penyesuaian Saldo oleh Admin').slice(0, 180);

  try {
    await runTransaction(db, async (transaction) => {
      const wSnap = await transaction.get(walletRef);
      if (!wSnap.exists()) throw new Error('Dompet target tidak ditemukan.');
      const w = wSnap.data();

      const delta = direction === 'CREDIT' ? amount : -amount;
      const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };

      if (currency === 'COIN') {
        const next = Math.max(0, w.coinBalance + delta);
        updates.coinBalance = next;
        if (delta > 0) updates.totalEarnedCoins = w.totalEarnedCoins + amount;
      } else if (currency === 'FIRE') {
        const next = Math.max(0, w.fireBalance + delta);
        updates.fireBalance = next;
        if (delta > 0) updates.totalEarnedFire = w.totalEarnedFire + amount;
      } else {
        const next = Math.max(0, w.idrBalance + delta);
        updates.idrBalance = next;
      }

      transaction.update(walletRef, updates);

      transaction.set(txRef, {
        uid: targetUid,
        category: 'ADMIN',
        direction,
        currency,
        amount,
        description: `Admin Adjustment (${direction} ${amount} ${currency}): ${cleanReason}`.slice(0, 200),
        referenceId: auditId,
        createdAt: serverTimestamp(),
      });

      transaction.set(auditRef, {
        adminUid,
        adminEmail: adminEmail.slice(0, 256),
        action: 'WALLET_ADJUSTMENT',
        targetId: targetUid,
        details: `${direction} ${amount} ${currency} on user ${targetUid}. Reason: ${cleanReason}`.slice(0, 400),
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `wallets/${targetUid}`);
  }
}

export async function adminSaveGameSettingsFirestore(
  adminUid: string,
  adminEmail: string,
  settings: GameSettings
): Promise<void> {
  await assertAdminAuthorized(adminUid, adminEmail);
  const settingsRef = doc(db, 'game_settings', 'global');
  const auditId = generateSafeId('audit_set');
  const auditRef = doc(db, 'admin_audit_logs', auditId);

  try {
    await Promise.all([
      setDoc(settingsRef, {
        settingId: 'global',
        coinsPerTap: Math.max(1, Math.floor(settings.coinsPerTap)),
        energyCostPerTap: Math.max(1, Math.floor(settings.energyCostPerTap)),
        baseMaxEnergy: Math.max(100, Math.floor(settings.baseMaxEnergy)),
        energyRegenPerMinute: 0,
        coinToIdrRate: Math.max(1, Math.floor(settings.coinToIdrRate)),
        fireToIdrRate: Math.max(1, Math.floor(settings.fireToIdrRate)),
        referralRewardCoin: Math.max(0, Math.floor(settings.referralRewardCoin)),
        referralRewardFire: Math.max(0, Math.floor(settings.referralRewardFire)),
        referralRewardIdr: Math.max(0, Math.floor(settings.referralRewardIdr)),
        minWithdrawIdr: Math.max(10000, Math.floor(settings.minWithdrawIdr)),
        maintenanceMode: Boolean(settings.maintenanceMode),
        announcementText: settings.announcementText.trim().slice(0, 240),
        updatedAt: serverTimestamp(),
      }),
      setDoc(auditRef, {
        adminUid,
        adminEmail: adminEmail.slice(0, 256),
        action: 'UPDATE_GAME_SETTINGS',
        targetId: 'global',
        details: `Updated settings: 1 tap=${settings.coinsPerTap} Coin, 1 Fire=Rp${settings.fireToIdrRate}, Referral=+${settings.referralRewardCoin} Coin`.slice(0, 400),
        createdAt: serverTimestamp(),
      }),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'game_settings/global');
  }
}

export async function adminSaveTaskFirestore(
  adminUid: string,
  adminEmail: string,
  task: GameTask
): Promise<void> {
  await assertAdminAuthorized(adminUid, adminEmail);
  const cleanId = sanitizeId(task.taskId);
  const taskRef = doc(db, 'tasks', cleanId);
  const auditId = generateSafeId('audit_task');
  const auditRef = doc(db, 'admin_audit_logs', auditId);

  try {
    await Promise.all([
      setDoc(taskRef, {
        taskId: cleanId,
        title: task.title.trim().slice(0, 100),
        description: task.description.trim().slice(0, 240),
        category: task.category,
        targetCount: Math.max(1, Math.floor(task.targetCount)),
        metricType: task.metricType,
        coinReward: Math.max(0, Math.floor(task.coinReward)),
        fireReward: Math.max(0, Math.floor(task.fireReward)),
        idrReward: Math.max(0, Math.floor(task.idrReward)),
        isActive: Boolean(task.isActive),
        updatedAt: serverTimestamp(),
      }),
      setDoc(auditRef, {
        adminUid,
        adminEmail: adminEmail.slice(0, 256),
        action: 'SAVE_TASK',
        targetId: cleanId,
        details: `Saved task "${task.title}" (${task.category}) reward: ${task.coinReward} Coin, ${task.fireReward} Fire`.slice(0, 400),
        createdAt: serverTimestamp(),
      }),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `tasks/${cleanId}`);
  }
}

export async function adminSaveRewardCodeFirestore(
  adminUid: string,
  adminEmail: string,
  rc: RewardCode
): Promise<void> {
  await assertAdminAuthorized(adminUid, adminEmail);
  const cleanCode = sanitizeId(rc.code.trim().toUpperCase());
  const codeRef = doc(db, 'reward_codes', cleanCode);
  const auditId = generateSafeId('audit_code');
  const auditRef = doc(db, 'admin_audit_logs', auditId);

  try {
    await Promise.all([
      setDoc(codeRef, {
        code: cleanCode,
        description: rc.description.trim().slice(0, 160),
        coinReward: Math.max(0, Math.floor(rc.coinReward)),
        fireReward: Math.max(0, Math.floor(rc.fireReward)),
        idrReward: Math.max(0, Math.floor(rc.idrReward)),
        maxClaims: Math.max(1, Math.floor(rc.maxClaims)),
        claimedCount: Math.max(0, Math.floor(rc.claimedCount)),
        isActive: Boolean(rc.isActive),
        updatedAt: serverTimestamp(),
      }),
      setDoc(auditRef, {
        adminUid,
        adminEmail: adminEmail.slice(0, 256),
        action: 'SAVE_REWARD_CODE',
        targetId: cleanCode,
        details: `Saved gift code ${cleanCode}: +${rc.coinReward} Coin, +${rc.fireReward} Fire, +Rp${rc.idrReward}`.slice(0, 400),
        createdAt: serverTimestamp(),
      }),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `reward_codes/${cleanCode}`);
  }
}

export async function adminReviewUpgradeOrderFirestore(
  adminUid: string,
  adminEmail: string,
  order: LevelUpgradeOrder,
  newStatus: 'PAID' | 'REJECTED',
  adminNote: string,
  levelConfig?: DragonLevelConfig
): Promise<void> {
  const adminUserRef = doc(db, 'users', adminUid);
  const orderRef = doc(db, 'upgrade_orders', order.orderId);
  const targetUserRef = doc(db, 'users', order.uid);
  const targetWalletRef = doc(db, 'wallets', order.uid);
  const txId = generateSafeId('tx_lvl_paid');
  const txRef = doc(db, 'wallet_transactions', txId);
  const notifId = generateSafeId('notif_lvl_paid');
  const notifRef = doc(db, 'notifications', notifId);
  const auditId = generateSafeId('audit_ord');
  const auditRef = doc(db, 'admin_audit_logs', auditId);

  const cleanNote = (adminNote.trim() || `Order upgrade level diubah ke ${newStatus}`).slice(0, 240);

  try {
    await runTransaction(db, async (transaction) => {
      const [adminSnap, ordSnap, uSnap, wSnap] = await Promise.all([
        transaction.get(adminUserRef),
        transaction.get(orderRef),
        transaction.get(targetUserRef),
        transaction.get(targetWalletRef),
      ]);

      if (!adminSnap.exists() || (adminSnap.data()?.role !== 'admin' && adminEmail !== 'lordzmbang08@gmail.com')) {
        throw new Error('Akses ditolak: Hanya Admin terotorisasi yang dapat memverifikasi order upgrade level.');
      }
      if (!ordSnap.exists() || !uSnap.exists() || !wSnap.exists()) {
        throw new Error('Data order atau pengguna tidak ditemukan.');
      }

      const currentOrd = ordSnap.data();
      const u = uSnap.data();
      const w = wSnap.data();

      transaction.update(orderRef, {
        status: newStatus,
        adminNote: cleanNote,
        updatedAt: serverTimestamp(),
      });

      if (newStatus === 'PAID' && currentOrd.status !== 'PAID') {
        const nextLevel = Math.max(u.dragonLevel || 1, order.targetLevel);
        const resolvedCfg =
          levelConfig ||
          DEFAULT_DRAGON_LEVELS.find((l) => l.level === order.targetLevel) ||
          DEFAULT_DRAGON_LEVELS[1];

        transaction.update(targetUserRef, {
          dragonLevel: nextLevel,
          updatedAt: serverTimestamp(),
        });

        // Activate level energy & fire bonus WITHOUT deducting Koin COINOVA!
        transaction.update(targetWalletRef, {
          maxEnergy: Math.max(w.maxEnergy, resolvedCfg.maxEnergy),
          energy: Math.max(w.energy, resolvedCfg.maxEnergy),
          fireBalance: w.fireBalance + resolvedCfg.dailyFireBonus,
          totalEarnedFire: w.totalEarnedFire + resolvedCfg.dailyFireBonus,
          updatedAt: serverTimestamp(),
        });

        transaction.set(txRef, {
          id: txId,
          uid: order.uid,
          category: 'LEVEL',
          direction: 'CREDIT',
          currency: 'IDR',
          amount: order.priceIdr,
          description: `Aktivasi Upgrade Lv.${order.targetLevel} (${order.levelName}) Terverifikasi Rp${order.priceIdr.toLocaleString('id-ID')}`.slice(0, 200),
          referenceId: order.orderId,
          createdAt: serverTimestamp(),
        });

        transaction.set(notifRef, {
          uid: order.uid,
          title: `Pembayaran Terverifikasi! Lv.${order.targetLevel} (${order.levelName}) Aktif`,
          message: `Order #${order.orderId.slice(-8).toUpperCase()} telah diverifikasi. Level ${order.levelName} kini aktif!`,
          type: 'SUCCESS',
          isRead: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (newStatus === 'REJECTED' && currentOrd.status !== 'REJECTED') {
        transaction.set(notifRef, {
          uid: order.uid,
          title: `Order Upgrade Lv.${order.targetLevel} (${order.levelName}) Ditolak`,
          message: `Alasan: ${cleanNote}`,
          type: 'WARNING',
          isRead: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      transaction.set(auditRef, {
        adminUid,
        adminEmail: adminEmail.slice(0, 256),
        action: `UPGRADE_ORDER_${newStatus}`,
        targetId: order.orderId,
        details: `Verified upgrade order ${order.orderId} for ${order.username} (Lv.${order.targetLevel} Rp${order.priceIdr}) -> ${newStatus}`.slice(0, 400),
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `upgrade_orders/${order.orderId}`);
  }
}

export async function adminSaveDragonLevelFirestore(
  adminUid: string,
  adminEmail: string,
  lvl: DragonLevelConfig
): Promise<void> {
  await assertAdminAuthorized(adminUid, adminEmail);
  const levelId = `level_${lvl.level}`;
  const lvlRef = doc(db, 'levels', levelId);
  const auditId = generateSafeId('audit_lvl');
  const auditRef = doc(db, 'admin_audit_logs', auditId);

  try {
    await Promise.all([
      setDoc(lvlRef, {
        level: Math.max(1, Math.floor(lvl.level)),
        name: lvl.name.trim().slice(0, 60),
        titleBadge: lvl.titleBadge.trim().slice(0, 60),
        priceIdr: Math.max(0, Math.floor(lvl.priceIdr || 0)),
        requiredCoins: 0,
        requiredFire: 0,
        tapMultiplier: Math.max(1, Math.floor(lvl.tapMultiplier)),
        maxEnergy: Math.max(100, Math.floor(lvl.maxEnergy)),
        dailyFireBonus: Math.max(0, Math.floor(lvl.dailyFireBonus)),
        updatedAt: serverTimestamp(),
      }),
      setDoc(auditRef, {
        adminUid,
        adminEmail: adminEmail.slice(0, 256),
        action: 'SAVE_LEVEL_CONFIG',
        targetId: levelId,
        details: `Updated Lv.${lvl.level} (${lvl.name}): multiplier ${lvl.tapMultiplier}x, price Rp${lvl.priceIdr || 0}`.slice(0, 400),
        createdAt: serverTimestamp(),
      }),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `levels/${levelId}`);
  }
}

export async function markNotificationReadFirestore(
  notifId: string
): Promise<void> {
  const notifRef = doc(db, 'notifications', notifId);
  try {
    await updateDoc(notifRef, {
      isRead: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notifId}`);
  }
}
