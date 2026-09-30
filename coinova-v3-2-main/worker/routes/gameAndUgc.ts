import { Hono, Context } from 'hono';
import {
  CloudflareEnv,
  LEVEL_DAILY_CLAIM_LIMITS,
  MIN_LEVEL_FOR_CONVERSION,
  OFFICIAL_LEVEL_PRICES,
  VALID_WITHDRAW_COIN_TIERS,
  getRewardPerTapForLevel,
  getServerTodayKey,
  isValidEWalletNumber,
  normalizeIndoPhone,
  randomHex,
  randomInt,
} from '../types';
import {
  ensureD1Schema,
  getEconomicConfigD1,
  getOrSyncUserStateD1,
  recordSuspiciousTapD1,
  recordTransactionD1,
  saveUserStateD1,
} from '../db';

interface CachedVideoRefWorker {
  cacheKey: string;
  fileName: string;
  mimeType: string;
  inlineBase64: string;
  createdAt: number;
}
const workerVideoCache = new Map<string, CachedVideoRefWorker>();

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

export function registerGameAndUgcRoutes(app: Hono<{ Bindings: CloudflareEnv }>): void {
  // ==========================================================================
  // AUTHORITATIVE USER STATE SYNC ENDPOINTS
  // ==========================================================================
  app.post('/api/game/sync-state', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    if (!uid) {
      return c.json({ ok: false, error: 'UID tidak valid.' }, 400);
    }

    const db = c.env.DB;
    const econ = await getEconomicConfigD1(db);
    const state = await getOrSyncUserStateD1(
      db,
      uid,
      {
        dragonLevel: Number(body?.dragonLevel || 1),
        coinBalance: Number(body?.coinBalance ?? 0),
        fireBalance: Number(body?.fireBalance ?? 0),
        lockedIdrBalance: Number(body?.lockedIdrBalance ?? 0),
        energy: Number(body?.energy ?? 200),
        dailyClaimsUsed: Number(body?.dailyClaimsUsed ?? 0),
        lastClaimDate: String(body?.lastClaimDate || ''),
        lastConvertDate: String(body?.lastConvertDate || ''),
        dailyConvertedFire: Number(body?.dailyConvertedFire ?? 0),
        totalTaps: Number(body?.totalTaps ?? 0),
      },
      econ
    );
    await saveUserStateD1(db, state);

    return c.json({
      ok: true,
      state: {
        ...state,
        idrBalance: state.coinBalance,
        rewardPerTap: getRewardPerTapForLevel(state.dragonLevel, econ.coinsPerTap),
      },
    });
  });

  const handleGetGameState = async (c: Context<{ Bindings: CloudflareEnv }>) => {
    const uid = String(c.req.param('uid') || c.req.query('uid') || '').trim();
    const hintedLevelStr = c.req.query('dragonLevel');
    const hintedLevel = hintedLevelStr ? Number(hintedLevelStr) : undefined;

    if (!uid) {
      return c.json({ ok: false, error: 'UID tidak valid.' }, 400);
    }

    const db = c.env.DB;
    const econ = await getEconomicConfigD1(db);
    const state = await getOrSyncUserStateD1(
      db,
      uid,
      hintedLevel ? { dragonLevel: hintedLevel } : undefined,
      econ
    );
    await saveUserStateD1(db, state);

    const rewardPerTap = getRewardPerTapForLevel(state.dragonLevel, econ.coinsPerTap);
    return c.json({
      ok: true,
      energy: state.energy,
      maxEnergy: state.maxEnergy,
      coinBalance: state.coinBalance,
      fireBalance: state.fireBalance,
      dragonLevel: state.dragonLevel,
      dailyClaimsUsed: state.dailyClaimsUsed,
      rewardPerTap,
      state: {
        ...state,
        idrBalance: state.coinBalance,
        rewardPerTap,
      },
    });
  };

  app.get('/api/game/state', handleGetGameState);
  app.get('/api/game/state/:uid', handleGetGameState);

  // ==========================================================================
  // SERVER-SIDE TAP REWARD & CORE ENERGY ENGINE (CLOUDFLARE D1)
  // ==========================================================================
  app.post('/api/game/tap', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    const tapId = String(body?.tapId || body?.nonce || '').trim();
    const clientTimestamp = Number(body?.clientTimestamp || Date.now());
    const tapCount = 1;

    if (!uid || !tapId) {
      return c.json(
        {
          ok: false,
          allowed: false,
          error: 'Sesi atau identitas request tap tidak valid.',
        },
        400
      );
    }

    const db = c.env.DB;
    await ensureD1Schema(db);
    const nowMs = Date.now();

    if (Math.abs(nowMs - clientTimestamp) > 60000) {
      await recordSuspiciousTapD1(
        db,
        uid,
        'Timestamp request di luar batas wajar (Anti-Replay)',
        Math.abs(nowMs - clientTimestamp),
        tapId
      );
      return c.json(
        {
          ok: false,
          allowed: false,
          error: 'Request tap kedaluwarsa (Anti-Replay).',
        },
        400
      );
    }

    const existingTap = await db
      .prepare('SELECT tap_id FROM processed_tap_ids WHERE tap_id = ?')
      .bind(tapId)
      .first();
    if (existingTap) {
      await recordSuspiciousTapD1(db, uid, 'Duplikasi nonce/tapId terdeteksi', 0, tapId);
      return c.json(
        {
          ok: false,
          allowed: false,
          duplicate: true,
          error: 'Tap sudah diproses.',
        },
        409
      );
    }

    await db
      .prepare('INSERT INTO processed_tap_ids (tap_id, uid, created_at) VALUES (?, ?, ?)')
      .bind(tapId, uid, nowMs)
      .run();

    const econ = await getEconomicConfigD1(db);
    const clientLevel = Math.max(1, Math.min(5, Math.floor(Number(body?.dragonLevel || 1))));
    const userState = await getOrSyncUserStateD1(
      db,
      uid,
      {
        dragonLevel: clientLevel,
        coinBalance: Number(body?.coinBalance ?? 0),
        fireBalance: Number(body?.fireBalance ?? 0),
        energy: Number(body?.currentEnergy ?? 200),
      },
      econ
    );

    const prevTapMs = userState.lastTapMs || 0;
    const deltaMs = nowMs - prevTapMs;
    if (prevTapMs > 0 && deltaMs < 40) {
      await recordSuspiciousTapD1(
        db,
        uid,
        `Frekuensi tap terlalu cepat (${deltaMs}ms < 40ms)`,
        deltaMs,
        tapId
      );
      return c.json(
        {
          ok: false,
          allowed: false,
          rateLimited: true,
          error: 'Ketukan terlalu cepat, terdeteksi aktivitas tidak wajar.',
        },
        429
      );
    }

    if (prevTapMs > 0 && deltaMs < 1000) {
      const intervals = Array.isArray(userState.recentTapIntervals)
        ? [...userState.recentTapIntervals]
        : [];
      intervals.push(deltaMs);
      if (intervals.length > 10) intervals.shift();
      userState.recentTapIntervals = intervals;

      if (intervals.length === 10) {
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const maxDiff = Math.max(...intervals.map((v) => Math.abs(v - avg)));
        if (avg < 140 && maxDiff <= 2) {
          await recordSuspiciousTapD1(
            db,
            uid,
            `Pola interval konstan auto-clicker terdeteksi (avg ${Math.round(avg)}ms)`,
            deltaMs,
            tapId
          );
          return c.json(
            {
              ok: false,
              allowed: false,
              rateLimited: true,
              error: 'Terdeteksi pola auto-clicker otomatis. Tap ditolak.',
            },
            429
          );
        }
      }
    }
    userState.lastTapMs = nowMs;

    const energyCost = Math.max(1, econ.energyCostPerTap * tapCount);
    if (userState.energy < energyCost) {
      return c.json(
        {
          ok: false,
          allowed: false,
          energy: userState.energy,
          energyRemaining: userState.energy,
          maxEnergy: userState.maxEnergy,
          error: 'Core Energy habis. Upgrade level untuk mendapatkan kapasitas tap berikutnya.',
        },
        400
      );
    }

    const dragonLevel = userState.dragonLevel;
    const rewardPerTap = getRewardPerTapForLevel(dragonLevel, econ.coinsPerTap);
    const coinsEarned = rewardPerTap * tapCount;

    let diamondChallenge: {
      challengeId: string;
      question: string;
      rewardFire: number;
    } | null = null;

    if (randomInt(100) < 12) {
      const opRoll = randomInt(3);
      let a = 0;
      let b = 0;
      let opSymbol = '+';
      let expectedAnswer = 0;

      if (opRoll === 0) {
        a = randomInt(16, 2);
        b = randomInt(16, 2);
        opSymbol = '+';
        expectedAnswer = a + b;
      } else if (opRoll === 1) {
        a = randomInt(21, 6);
        b = randomInt(a, 1);
        opSymbol = '-';
        expectedAnswer = a - b;
      } else {
        a = randomInt(10, 2);
        b = randomInt(10, 2);
        opSymbol = '×';
        expectedAnswer = a * b;
      }

      const rewardFire = randomInt(100) < 75 ? 1 : 2;
      const challengeId = `dch_${uid}_${nowMs}_${randomHex(4)}`;
      const question = `${a} ${opSymbol} ${b} = ?`;

      await db
        .prepare(
          `INSERT INTO diamond_challenges (
            challenge_id, uid, question, expected_answer, reward_fire, status, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
        )
        .bind(
          challengeId,
          uid,
          question,
          expectedAnswer,
          rewardFire,
          nowMs,
          nowMs + 5 * 60 * 1000
        )
        .run();

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

    await saveUserStateD1(db, userState);

    await recordTransactionD1(db, {
      uid,
      category: 'TAP_REWARD',
      direction: 'CREDIT',
      currency: 'COIN',
      amount: coinsEarned,
      description: `Tap Reward Lv.${dragonLevel}: +${coinsEarned.toLocaleString('id-ID')} Koin`,
      referenceId: tapId,
    });

    return c.json({
      ok: true,
      allowed: true,
      dragonLevel,
      rewardPerTap,
      coinsEarned,
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

  // ==========================================================================
  // DIAMOND MATH CHALLENGE VERIFICATION
  // ==========================================================================
  app.post('/api/game/diamond-challenge/verify', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    const challengeId = String(body?.challengeId || '').trim();
    const rawAnswer = body?.answer;

    if (!uid || !challengeId) {
      return c.json({ ok: false, error: 'Data challenge tidak valid.' }, 400);
    }

    const db = c.env.DB;
    await ensureD1Schema(db);

    const row = await db
      .prepare('SELECT * FROM diamond_challenges WHERE challenge_id = ?')
      .bind(challengeId)
      .first<Record<string, any>>();

    if (!row || String(row.uid) !== uid) {
      return c.json(
        { ok: false, error: 'Challenge tidak ditemukan atau sudah kedaluwarsa.' },
        404
      );
    }

    if (String(row.status) !== 'ACTIVE') {
      return c.json(
        {
          ok: false,
          alreadyProcessed: true,
          error: 'Challenge ini sudah pernah dijawab.',
        },
        409
      );
    }

    await db
      .prepare("UPDATE diamond_challenges SET status = 'CONSUMED' WHERE challenge_id = ?")
      .bind(challengeId)
      .run();

    const nowMs = Date.now();
    if (nowMs > Number(row.expires_at || 0)) {
      return c.json(
        {
          ok: false,
          correct: false,
          rewardFire: 0,
          error: 'Waktu menjawab challenge sudah habis.',
        },
        400
      );
    }

    const parsedAnswer = Number(String(rawAnswer ?? '').trim());
    const expectedAnswer = Number(row.expected_answer);
    const isCorrect =
      Number.isFinite(parsedAnswer) &&
      String(rawAnswer ?? '').trim() !== '' &&
      parsedAnswer === expectedAnswer;

    const userState = await getOrSyncUserStateD1(db, uid);

    if (!isCorrect) {
      return c.json({
        ok: true,
        correct: false,
        rewardFire: 0,
        fireBalance: userState.fireBalance,
        message: 'Jawaban salah. Diamond tidak didapat.',
      });
    }

    const rewardFire = Math.max(1, Math.floor(Number(row.reward_fire || 1)));
    userState.fireBalance = Math.max(0, userState.fireBalance + rewardFire);
    userState.updatedAt = new Date(nowMs).toISOString();
    await saveUserStateD1(db, userState);

    await recordTransactionD1(db, {
      uid,
      category: 'REWARD',
      direction: 'CREDIT',
      currency: 'FIRE',
      amount: rewardFire,
      description: `Bonus Diamond Challenge (${String(row.question).replace('= ?', `= ${expectedAnswer}`)}): +${rewardFire} Diamond`,
      referenceId: challengeId,
    });

    return c.json({
      ok: true,
      correct: true,
      rewardFire,
      fireBalance: userState.fireBalance,
      message: `Benar! +${rewardFire} Diamond 💎`,
    });
  });

  // ==========================================================================
  // TASK CLAIM, CYBER VAULT CYCLE, REWARD CREDIT, REFERRAL BIND
  // ==========================================================================
  app.post('/api/game/claim-task', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    const taskId = String(body?.taskId || '').trim();
    const targetMilestone = Number(body?.targetMilestone || 0);
    const coinReward = Math.max(0, Math.floor(Number(body?.coinReward || 0)));
    const fireReward = Math.max(0, Math.floor(Number(body?.fireReward || 0)));

    if (!uid || !taskId) {
      return c.json({ ok: false, error: 'Data klaim misi tidak lengkap.' }, 400);
    }

    const db = c.env.DB;
    await ensureD1Schema(db);
    const claimKey = `${uid}__${taskId}`;

    const existing = await db
      .prepare('SELECT claim_key FROM task_claims WHERE claim_key = ?')
      .bind(claimKey)
      .first();
    if (existing) {
      return c.json(
        { ok: false, error: 'Target misi ini sudah pernah diklaim sebelumnya.' },
        409
      );
    }

    const userState = await getOrSyncUserStateD1(db, uid);
    if (targetMilestone > 0) {
      if (userState.claimedInviteTargets.includes(targetMilestone)) {
        return c.json(
          { ok: false, error: `Target ${targetMilestone} teman sudah pernah diklaim.` },
          409
        );
      }
      userState.claimedInviteTargets = [...userState.claimedInviteTargets, targetMilestone];
    }

    const nowIso = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO task_claims (claim_key, uid, task_id, target_milestone, coin_reward, fire_reward, claimed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(claimKey, uid, taskId, targetMilestone, coinReward, fireReward, nowIso)
      .run();

    userState.coinBalance = Math.max(0, userState.coinBalance + coinReward);
    userState.fireBalance = Math.max(0, userState.fireBalance + fireReward);
    userState.updatedAt = nowIso;
    await saveUserStateD1(db, userState);

    await recordTransactionD1(db, {
      uid,
      category: 'TASK',
      direction: 'CREDIT',
      currency: coinReward > 0 ? 'COIN' : 'FIRE',
      amount: coinReward > 0 ? coinReward : fireReward,
      description: `Klaim Misi (${taskId}): +${coinReward.toLocaleString('id-ID')} Koin & +${fireReward} Diamond`,
      referenceId: claimKey,
    });

    return c.json({
      ok: true,
      taskId,
      targetMilestone,
      coinReward,
      fireReward,
      coinBalance: userState.coinBalance,
      fireBalance: userState.fireBalance,
      claimedInviteTargets: userState.claimedInviteTargets,
    });
  });

  app.post('/api/game/claim-cycle', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    const dragonLevel = Math.max(1, Math.min(5, Math.floor(Number(body?.dragonLevel || 1))));
    if (!uid) {
      return c.json({ ok: false, error: 'UID tidak valid.' }, 400);
    }

    const db = c.env.DB;
    const econ = await getEconomicConfigD1(db);
    const userState = await getOrSyncUserStateD1(db, uid, { dragonLevel }, econ);
    const maxDailyClaims = LEVEL_DAILY_CLAIM_LIMITS[userState.dragonLevel] || 200;
    if (userState.dailyClaimsUsed >= maxDailyClaims) {
      return c.json(
        {
          ok: false,
          error: `Kuota klaim Cyber Vault harian (${maxDailyClaims}) sudah tercapai.`,
        },
        400
      );
    }

    const bonusCoins = getRewardPerTapForLevel(userState.dragonLevel, econ.coinsPerTap) * 10;
    const bonusFire = randomInt(100) < 25 ? 1 : 0;
    userState.coinBalance = Math.max(0, userState.coinBalance + bonusCoins);
    userState.fireBalance = Math.max(0, userState.fireBalance + bonusFire);
    userState.dailyClaimsUsed += 1;
    userState.updatedAt = new Date().toISOString();
    await saveUserStateD1(db, userState);

    await recordTransactionD1(db, {
      uid,
      category: 'CYBER_VAULT',
      direction: 'CREDIT',
      currency: 'COIN',
      amount: bonusCoins,
      description: `Klaim Cyber Vault 10/10 Tap: +${bonusCoins.toLocaleString('id-ID')} Koin${bonusFire > 0 ? ` & +${bonusFire} Diamond` : ''}`,
      referenceId: String(body?.cycleId || `cyc_${Date.now()}`),
    });

    return c.json({
      ok: true,
      bonusCoins,
      bonusFire,
      coinBalance: userState.coinBalance,
      fireBalance: userState.fireBalance,
      dailyClaimsUsed: userState.dailyClaimsUsed,
    });
  });

  app.post('/api/game/credit-reward', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    const coins = Math.max(0, Math.floor(Number(body?.coins || 0)));
    const fire = Math.max(0, Math.floor(Number(body?.fire || 0)));
    const category = String(body?.category || 'REWARD').trim();
    const description = String(body?.description || 'Reward COINOVA').trim();
    if (!uid) {
      return c.json({ ok: false, error: 'UID tidak valid.' }, 400);
    }

    const db = c.env.DB;
    const userState = await getOrSyncUserStateD1(db, uid);
    userState.coinBalance = Math.max(0, userState.coinBalance + coins);
    userState.fireBalance = Math.max(0, userState.fireBalance + fire);
    userState.updatedAt = new Date().toISOString();
    await saveUserStateD1(db, userState);

    if (coins > 0 || fire > 0) {
      await recordTransactionD1(db, {
        uid,
        category,
        direction: 'CREDIT',
        currency: coins > 0 ? 'COIN' : 'FIRE',
        amount: coins > 0 ? coins : fire,
        description,
        referenceId: `rew_${Date.now()}`,
      });
    }

    return c.json({
      ok: true,
      coinBalance: userState.coinBalance,
      fireBalance: userState.fireBalance,
    });
  });


  app.post('/api/game/referral/bind', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    const ownReferralCode = String(body?.ownReferralCode || '').trim().toUpperCase();
    const inviterCode = String(body?.inviterCode || '').trim().toUpperCase();
    const alreadyBoundCode = String(body?.alreadyBoundCode || '').trim().toUpperCase();

    if (!uid) {
      return c.json({ ok: false, error: 'Identitas pengguna tidak valid.' }, 400);
    }
    if (!inviterCode || !/^[A-Z0-9_-]{4,16}$/.test(inviterCode)) {
      return c.json(
        {
          ok: false,
          error: 'Format kode undangan tidak valid (4-16 karakter huruf/angka).',
        },
        400
      );
    }
    if (inviterCode === ownReferralCode) {
      return c.json(
        {
          ok: false,
          error: 'Tidak dapat menggunakan kode undangan milik sendiri (Self-referral ditolak).',
        },
        400
      );
    }

    const db = c.env.DB;
    await ensureD1Schema(db);

    const existingRef = await db
      .prepare('SELECT inviter_code FROM referrals WHERE invitee_uid = ?')
      .bind(uid)
      .first<Record<string, any>>();

    const serverExisting = existingRef?.inviter_code
      ? String(existingRef.inviter_code)
      : alreadyBoundCode;

    if (serverExisting) {
      return c.json(
        {
          ok: false,
          error: `Akun Anda sudah terhubung dengan kode pengundang (${serverExisting}).`,
        },
        400
      );
    }

    const inviterRow = await db
      .prepare('SELECT uid FROM users WHERE UPPER(referral_code) = ?')
      .bind(inviterCode)
      .first<Record<string, any>>();

    const inviterUid = inviterRow ? String(inviterRow.uid) : `inv_${inviterCode}`;
    const nowIso = new Date().toISOString();

    await db
      .prepare(
        `INSERT OR IGNORE INTO referrals (
          referral_id, inviter_uid, invitee_uid, invitee_username, inviter_code,
          status, active_reward_claimed, topup_reward_claimed, upgrade_reward_claimed,
          reward_coin, reward_fire, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, 0, 0, 0, 0, ?, ?)`
      )
      .bind(`ref_${inviterUid}_${uid}`, inviterUid, uid, uid, inviterCode, nowIso, nowIso)
      .run();

    return c.json({
      ok: true,
      inviterCode,
      status: 'PENDING',
      welcomeBonusCoins: 0,
      welcomeBonusFire: 0,
      message:
        'Kode undangan berhasil terhubung (Status: PENDING). Reward referral diberikan otomatis setelah akun aktif / top-up / upgrade level valid.',
      boundAt: nowIso,
    });
  });

  // ==========================================================================
  // CONVERSION, WITHDRAWAL, UPGRADE ORDER & BUG REPORTS
  // ==========================================================================
  app.get('/api/game/convert-quota/:uid', async (c) => {
    const uid = String(c.req.param('uid') || '').trim();
    const db = c.env.DB;
    const econ = await getEconomicConfigD1(db);
    const state = await getOrSyncUserStateD1(db, uid, undefined, econ);
    const today = getServerTodayKey();
    const maxDaily = econ.maxDailyFireConvert;
    const usedToday = Math.min(maxDaily, state.dailyConvertedFire || 0);
    return c.json({
      ok: true,
      today,
      usedToday,
      remainingDailyFireQuota: Math.max(0, maxDaily - usedToday),
    });
  });

  app.post('/api/game/validate-convert', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    const fireToObtain = Math.floor(Number(body?.fireToObtain || 0));
    const clientCoinBalance = Math.floor(Number(body?.coinBalance || 0));
    const clientUsedToday = Math.max(0, Math.floor(Number(body?.usedToday || 0)));
    const clientLevel = Math.floor(Number(body?.dragonLevel || 1));

    if (!uid) {
      return c.json({ ok: false, error: 'Identitas pengguna tidak valid.' }, 400);
    }

    const db = c.env.DB;
    const econ = await getEconomicConfigD1(db);
    const userState = await getOrSyncUserStateD1(
      db,
      uid,
      {
        dragonLevel: clientLevel,
        coinBalance: clientCoinBalance,
      },
      econ
    );

    if (
      clientLevel < MIN_LEVEL_FOR_CONVERSION ||
      userState.dragonLevel < MIN_LEVEL_FOR_CONVERSION
    ) {
      return c.json(
        {
          ok: false,
          error:
            'Akses ditolak (403): Fitur Konversi Koin ke Diamond hanya tersedia untuk 2 Level Tertinggi (Level 4 Pro & Level 5 Ultimate).',
        },
        403
      );
    }

    if (fireToObtain < 1) {
      return c.json(
        {
          ok: false,
          error: `Minimal konversi adalah ${econ.coinsPerFireConvert.toLocaleString('id-ID')} Koin (1 Diamond).`,
        },
        400
      );
    }

    const today = getServerTodayKey();
    const maxDaily = econ.maxDailyFireConvert;
    const serverUsedToday = Math.max(userState.dailyConvertedFire, clientUsedToday);

    if (serverUsedToday >= maxDaily || serverUsedToday + fireToObtain > maxDaily) {
      return c.json(
        {
          ok: false,
          error: `Batas konversi hari ini telah tercapai. Maksimal ${maxDaily} Diamond per hari.`,
        },
        400
      );
    }

    const coinsRequired = fireToObtain * econ.coinsPerFireConvert;
    const availableCoins = Math.min(userState.coinBalance, clientCoinBalance);
    if (availableCoins < coinsRequired) {
      return c.json(
        { ok: false, error: 'Koin Anda tidak mencukupi untuk konversi ini.' },
        400
      );
    }

    const nextUsed = serverUsedToday + fireToObtain;
    const nextCoinBalance = Math.max(0, availableCoins - coinsRequired);

    userState.coinBalance = nextCoinBalance;
    userState.fireBalance = Math.max(0, userState.fireBalance + fireToObtain);
    userState.lastConvertDate = today;
    userState.dailyConvertedFire = nextUsed;
    userState.updatedAt = new Date().toISOString();
    await saveUserStateD1(db, userState);

    await recordTransactionD1(db, {
      uid,
      category: 'KONVERSI',
      direction: 'DEBIT',
      currency: 'COIN',
      amount: coinsRequired,
      description: `Konversi ${coinsRequired.toLocaleString('id-ID')} Koin -> +${fireToObtain} Diamond`,
      referenceId: `conv_${Date.now()}`,
    });

    return c.json({
      ok: true,
      today,
      fireGained: fireToObtain,
      coinsSpent: coinsRequired,
      nextCoinBalance,
      nextIdrBalance: nextCoinBalance,
      dailyConvertedFire: nextUsed,
      remainingDailyFireQuota: Math.max(0, maxDaily - nextUsed),
    });
  });

  app.post('/api/game/validate-withdraw', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    const requestId = String(body?.requestId || '').trim();
    const rawAmount = Math.floor(Number(body?.amountCoins || body?.amountIdr || 0));
    const amountCoins =
      rawAmount > 0 &&
      rawAmount < 500000 &&
      VALID_WITHDRAW_COIN_TIERS.includes(rawAmount * 10)
        ? rawAmount * 10
        : rawAmount;

    const coinBalance = Math.floor(Number(body?.coinBalance || 0));
    const method = String(body?.method || '');
    const accountNumber = normalizeIndoPhone(String(body?.accountNumber || ''));
    const accountName = String(body?.accountName || '').trim();

    if (!uid) {
      return c.json({ ok: false, error: 'Identitas user tidak valid.' }, 400);
    }

    const db = c.env.DB;
    await ensureD1Schema(db);

    if (requestId) {
      const existingWd = await db
        .prepare('SELECT withdrawal_id FROM withdrawals WHERE request_id = ?')
        .bind(requestId)
        .first();
      if (existingWd) {
        return c.json(
          {
            ok: false,
            error: 'Permintaan penarikan ini sedang diproses (duplikasi dicegah).',
          },
          409
        );
      }
    }

    if (!['DANA', 'GoPay', 'OVO', 'ShopeePay'].includes(method)) {
      return c.json({ ok: false, error: 'Metode E-Wallet tidak valid.' }, 400);
    }
    if (!isValidEWalletNumber(accountNumber)) {
      return c.json(
        {
          ok: false,
          error: `Nomor akun ${method} tidak valid. Gunakan format nomor HP aktif (contoh: 081234567890, 10-14 digit).`,
        },
        400
      );
    }
    if (accountName.length < 2 || accountName.length > 80) {
      return c.json(
        {
          ok: false,
          error: 'Nama lengkap pemilik akun E-Wallet wajib diisi (minimal 2 karakter).',
        },
        400
      );
    }
    if (!VALID_WITHDRAW_COIN_TIERS.includes(amountCoins)) {
      return c.json(
        {
          ok: false,
          error:
            'Nominal penarikan harus salah satu paket Koin resmi (500.000, 1.000.000, 2.000.000, atau 5.000.000 Koin).',
        },
        400
      );
    }

    const userState = await getOrSyncUserStateD1(db, uid, {
      coinBalance,
      fireBalance: Math.floor(Number(body?.fireBalance ?? 0)),
    });

    const requiredFire = Math.max(1, Math.floor(amountCoins / 1000));
    const effectiveCoins = Math.min(userState.coinBalance, coinBalance);
    const clientFireBalance =
      body?.fireBalance !== undefined
        ? Math.floor(Number(body.fireBalance))
        : userState.fireBalance;
    const effectiveFire = Math.min(userState.fireBalance, clientFireBalance);

    if (effectiveCoins < amountCoins) {
      return c.json(
        {
          ok: false,
          error: `Koin tidak mencukupi. Butuh ${amountCoins.toLocaleString('id-ID')} Koin.`,
        },
        400
      );
    }
    if (effectiveFire < requiredFire) {
      return c.json(
        {
          ok: false,
          error: `Syarat Diamond belum mencukupi (${effectiveFire}/${requiredFire} Diamond). Penarikan ${amountCoins.toLocaleString('id-ID')} Koin membutuhkan ${requiredFire.toLocaleString('id-ID')} Diamond.`,
        },
        400
      );
    }

    const nextCoinBalance = Math.max(0, effectiveCoins - amountCoins);
    const nextFireBalance = Math.max(0, effectiveFire - requiredFire);
    const nowIso = new Date().toISOString();

    userState.coinBalance = nextCoinBalance;
    userState.fireBalance = nextFireBalance;
    userState.lockedIdrBalance = Math.max(0, userState.lockedIdrBalance + amountCoins);
    userState.updatedAt = nowIso;
    await saveUserStateD1(db, userState);

    const withdrawalId = `wd_${Date.now()}_${randomHex(3)}`;
    await db
      .prepare(
        `INSERT INTO withdrawals (
          withdrawal_id, request_id, uid, username, method, account_number, account_name,
          amount_coins, amount_idr, coins_spent, fire_spent, status, payment_reference, admin_note,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', '', '', ?, ?)`
      )
      .bind(
        withdrawalId,
        requestId || withdrawalId,
        uid,
        userState.username,
        method,
        accountNumber,
        accountName,
        amountCoins,
        amountCoins,
        amountCoins,
        requiredFire,
        nowIso,
        nowIso
      )
      .run();

    await recordTransactionD1(db, {
      uid,
      category: 'WITHDRAWAL',
      direction: 'HOLD',
      currency: 'COIN',
      amount: amountCoins,
      description: `Penarikan ${amountCoins.toLocaleString('id-ID')} Koin (& -${requiredFire} Diamond) ke ${method} (${accountNumber} a/n ${accountName})`,
      referenceId: requestId || withdrawalId,
    });

    return c.json({
      ok: true,
      amountCoins,
      amountIdr: amountCoins,
      normalizedAccountNumber: accountNumber,
      accountName,
      coinsSpent: amountCoins,
      fireSpent: requiredFire,
      nextCoinBalance,
      nextIdrBalance: nextCoinBalance,
      nextFireBalance,
    });
  });

  app.post('/api/game/validate-upgrade-order', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    const targetLevel = Math.floor(Number(body?.targetLevel || 0));
    const currentLevel = Math.floor(Number(body?.currentLevel || 1));
    const paymentMethod = String(body?.paymentMethod || 'QRIS');

    if (!uid || targetLevel < 2 || targetLevel > 5) {
      return c.json(
        { ok: false, error: 'Level tujuan tidak valid (hanya Level 2 - Level 5).' },
        400
      );
    }
    if (targetLevel <= currentLevel) {
      return c.json(
        { ok: false, error: 'Level tersebut sudah aktif pada akun Anda.' },
        400
      );
    }
    if (!['QRIS', 'DANA', 'GoPay', 'OVO', 'ShopeePay'].includes(paymentMethod)) {
      return c.json({ ok: false, error: 'Metode pembayaran tidak didukung.' }, 400);
    }

    return c.json({
      ok: true,
      verifiedPriceIdr: OFFICIAL_LEVEL_PRICES[targetLevel],
      status: 'WAITING_PAYMENT',
    });
  });

  app.post('/api/game/submit-upgrade-proof', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    const orderId = String(body?.orderId || '').trim();
    const paymentReference =
      String(body?.paymentReference || '').trim() ||
      `QRIS-${Date.now().toString().slice(-6)}`;
    const paymentProofImage = String(
      body?.paymentProofDataUrl || body?.paymentProofImage || ''
    ).trim();

    if (!uid || !orderId) {
      return c.json({ ok: false, error: 'Data order tidak valid.' }, 400);
    }
    if (!paymentProofImage && paymentReference.length < 3) {
      return c.json(
        {
          ok: false,
          error:
            'Wajib mengunggah foto/screenshot bukti pembayaran atau mengisi referensi transaksi.',
        },
        400
      );
    }

    const nowIso = new Date().toISOString();
    return c.json({
      ok: true,
      orderId,
      paymentReference,
      paidSubmittedAt: nowIso,
      submittedAt: nowIso,
      status: 'PENDING_VERIFICATION',
    });
  });

  app.post('/api/game/bug-report', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const uid = String(body?.uid || '').trim();
    const username = String(body?.username || 'User').trim();
    const description = String(body?.description || '').trim();
    const featureArea = String(body?.featureArea || 'Profile / Sistem COINOVA').trim();
    const appVersion = String(body?.appVersion || 'COINOVA OS v2.4.0').trim();
    const screenshotDataUrl = String(body?.screenshotDataUrl || '').trim();
    const screenshotFileName = String(body?.screenshotFileName || '').trim();
    const reportedAt = String(body?.reportedAt || new Date().toISOString()).trim();

    if (!uid) {
      return c.json({ ok: false, error: 'User ID tidak valid.' }, 400);
    }
    if (description.length < 5) {
      return c.json(
        {
          ok: false,
          error: 'Mohon jelaskan detail bug yang dialami minimal 5 karakter.',
        },
        400
      );
    }

    const db = c.env.DB;
    await ensureD1Schema(db);
    const reportId = `BUG-${Date.now().toString().slice(-6)}-${Math.random()
      .toString(36)
      .substring(2, 5)
      .toUpperCase()}`;

    await db
      .prepare(
        `INSERT INTO bug_reports (
          report_id, uid, username, description, feature_area, app_version,
          has_screenshot, screenshot_file_name, screenshot_data_url, status, reported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?)`
      )
      .bind(
        reportId,
        uid,
        username.slice(0, 60),
        description.slice(0, 2000),
        featureArea.slice(0, 100),
        appVersion.slice(0, 60),
        screenshotDataUrl ? 1 : 0,
        screenshotFileName.slice(0, 120),
        screenshotDataUrl ? screenshotDataUrl.slice(0, 500000) : '',
        reportedAt
      )
      .run();

    return c.json({
      ok: true,
      report: {
        reportId,
        uid,
        username: username.slice(0, 60),
        description: description.slice(0, 2000),
        featureArea: featureArea.slice(0, 100),
        appVersion: appVersion.slice(0, 60),
        hasScreenshot: Boolean(screenshotDataUrl),
        screenshotFileName: screenshotFileName.slice(0, 120),
        screenshotDataUrl: screenshotDataUrl ? screenshotDataUrl.slice(0, 500000) : '',
        status: 'RECEIVED',
        reportedAt,
      },
    });
  });

  app.get('/api/game/bug-reports/:uid', async (c) => {
    const uid = String(c.req.param('uid') || '').trim();
    const db = c.env.DB;
    await ensureD1Schema(db);
    const rows = await db
      .prepare('SELECT * FROM bug_reports WHERE uid = ? ORDER BY reported_at DESC LIMIT 25')
      .bind(uid)
      .all<Record<string, any>>();

    const reports = (rows.results || []).map((r) => ({
      reportId: String(r.report_id),
      uid: String(r.uid),
      username: String(r.username),
      description: String(r.description),
      featureArea: String(r.feature_area),
      appVersion: String(r.app_version),
      hasScreenshot: Boolean(r.has_screenshot),
      screenshotFileName: String(r.screenshot_file_name || ''),
      screenshotDataUrl: String(r.screenshot_data_url || ''),
      status: String(r.status || 'RECEIVED'),
      reportedAt: String(r.reported_at),
    }));

    return c.json({ ok: true, reports });
  });

  // ==========================================================================
  // AI UGC AFFILIATE — EDGE GEMINI API + VIDEO REFERENCE
  // ==========================================================================
  app.post('/api/ugc/upload-video', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const fileName = String(body?.fileName || 'reference.mp4').trim();
      const fileSize = Number(body?.fileSize || 0);
      const videoDataUrl = String(body?.videoDataUrl || '').trim();
      const cacheKey = String(body?.cacheKey || `${fileName}_${fileSize}`).trim();

      if (workerVideoCache.has(cacheKey)) {
        const cached = workerVideoCache.get(cacheKey)!;
        return c.json({
          ok: true,
          cached: true,
          cacheKey: cached.cacheKey,
          fileName: cached.fileName,
          mimeType: cached.mimeType,
          fileUri: null,
        });
      }

      const parsed = parseDataUrl(videoDataUrl);
      if (!parsed) {
        return c.json(
          {
            ok: false,
            error:
              'Video reference gagal diproses. Coba gunakan video MP4/MOV yang lebih pendek atau berukuran lebih kecil.',
          },
          400
        );
      }

      if (!SUPPORTED_VIDEO_MIMES.has(parsed.mimeType)) {
        return c.json({ ok: false, error: 'Format video tidak didukung.' }, 400);
      }

      const approxBytes = Math.floor((parsed.base64.length * 3) / 4);
      if (approxBytes > 22 * 1024 * 1024) {
        return c.json(
          {
            ok: false,
            error: 'Video terlalu besar. Gunakan video yang lebih pendek atau lebih kecil.',
          },
          400
        );
      }

      workerVideoCache.set(cacheKey, {
        cacheKey,
        fileName,
        mimeType: parsed.mimeType,
        inlineBase64: parsed.base64,
        createdAt: Date.now(),
      });

      return c.json({
        ok: true,
        cached: false,
        cacheKey,
        fileName,
        mimeType: parsed.mimeType,
        fileUri: null,
      });
    } catch {
      return c.json(
        {
          ok: false,
          error:
            'Video reference gagal diproses. Coba gunakan video MP4/MOV yang lebih pendek atau berukuran lebih kecil.',
        },
        500
      );
    }
  });

  app.post('/api/ugc/generate', async (c) => {
    try {
      const apiKey = c.env.GEMINI_API_KEY;
      if (!apiKey) {
        return c.json(
          {
            ok: false,
            error:
              'Layanan AI UGC belum dapat dijalankan karena GEMINI_API_KEY belum tersedia di Cloudflare Environment Variables.',
          },
          503
        );
      }

      const body = await c.req.json().catch(() => ({}));
      const uid = String(body?.uid || '').trim();
      const clientCoinBalance =
        body?.coinBalance !== undefined ? Math.floor(Number(body.coinBalance)) : undefined;
      const AI_UGC_COST_COINS = 10000;

      const db = c.env.DB;
      if (uid) {
        const uState = await getOrSyncUserStateD1(
          db,
          uid,
          clientCoinBalance !== undefined ? { coinBalance: clientCoinBalance } : undefined
        );
        const effectiveCoins =
          clientCoinBalance !== undefined
            ? Math.min(uState.coinBalance, clientCoinBalance)
            : uState.coinBalance;
        if (effectiveCoins < AI_UGC_COST_COINS) {
          return c.json(
            {
              ok: false,
              error: `Koin Anda tidak mencukupi untuk Generate AI UGC. Biaya Generate: ${AI_UGC_COST_COINS.toLocaleString('id-ID')} Koin (Koin Anda: ${effectiveCoins.toLocaleString('id-ID')} Koin).`,
            },
            400
          );
        }
      }

      const productDataUrl = String(body?.productDataUrl || '').trim();
      const characterDataUrl = String(body?.characterDataUrl || '').trim();
      const videoCacheKey = String(body?.videoCacheKey || '').trim();
      const videoDataUrl = String(body?.videoDataUrl || '').trim();
      const referenceMode = String(body?.referenceMode || 'Original').trim();
      const productName = String(body?.productName || '').trim();
      const productDescription = String(body?.productDescription || '').trim();
      const talentStyle = String(
        body?.talentStyle || 'Kreator UGC Indonesia natural, ekspresif, meyakinkan'
      ).trim();

      const parsedProduct = parseDataUrl(productDataUrl);
      if (!parsedProduct) {
        return c.json(
          {
            ok: false,
            error: 'Foto Produk (Product Reference) wajib diunggah terlebih dahulu.',
          },
          400
        );
      }

      const parts: any[] = [
        {
          text: 'IMAGE 1 — PRODUCT REFERENCE (SUMBER KEBENARAN UTAMA PRODUK. Jangan mengarang bentuk, warna, logo, tulisan, tombol, display, material, atau ukuran yang tidak terlihat pada foto produk ini):',
        },
        {
          inlineData: {
            mimeType: parsedProduct.mimeType,
            data: parsedProduct.base64,
          },
        },
      ];

      const parsedCharacter = characterDataUrl ? parseDataUrl(characterDataUrl) : null;
      if (parsedCharacter) {
        parts.push({
          text: 'IMAGE 2 — CHARACTER REFERENCE (Gunakan sebagai referensi visual karakter tanpa meniru identitas orang nyata/public figure):',
        });
        parts.push({
          inlineData: {
            mimeType: parsedCharacter.mimeType,
            data: parsedCharacter.base64,
          },
        });
      }

      let hasVideoAttached = false;
      const cachedVid = videoCacheKey ? workerVideoCache.get(videoCacheKey) : undefined;
      if (referenceMode !== 'Original' && (cachedVid || videoDataUrl)) {
        parts.push({
          text: "VIDEO 3 — VIDEO REFERENCE (Analyze the reference video's visual structure, shot progression, camera language, pacing, gestures, and product presentation. Create a new original UGC video concept using the supplied product and character references):",
        });
        if (cachedVid?.inlineBase64) {
          parts.push({
            inlineData: {
              mimeType: cachedVid.mimeType,
              data: cachedVid.inlineBase64,
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
Hasilkan JSON murni dengan properti: videoAnalysis (hook, scene1, scene2, scene3, camera, movement, productPresentation, lighting, pacing, cta), hook, conceptScript, caption, cta, dan finalPrompt (dengan section VIDEO FORMAT, TALENT, PRODUCT, LOCATION, LIGHTING, CAMERA, SCENE 1, SCENE 2, SCENE 3, PRODUCT DEMONSTRATION, DIALOGUE / VOICEOVER, ENDING / CTA, ANTI-CHANGE, REFERENCE INSTRUCTION).`;

      parts.push({
        text: `Nama Produk: ${productName || 'Sesuai foto Product Reference'}\nDeskripsi: ${productDescription || 'Sesuai foto'}\nTalent: ${parsedCharacter ? 'Sesuai Character Reference' : talentStyle}\nReference Mode: ${referenceMode}\nHasilkan JSON sesuai instruksi.`,
      });

      const geminiResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstructionText }] },
            contents: [{ role: 'user', parts }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        }
      );

      if (!geminiResp.ok) {
        const errText = await geminiResp.text();
        throw new Error(`Gemini API HTTP ${geminiResp.status}: ${errText.slice(0, 200)}`);
      }

      const geminiData = (await geminiResp.json()) as any;
      const rawText = String(
        geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      ).trim();
      const parsedJson = JSON.parse(
        rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
      );

      let nextCoinBalanceAfterUgc: number | undefined;
      if (uid) {
        const uState = await getOrSyncUserStateD1(db, uid);
        const baseCoins =
          clientCoinBalance !== undefined
            ? Math.min(uState.coinBalance, clientCoinBalance)
            : uState.coinBalance;
        uState.coinBalance = Math.max(0, baseCoins - AI_UGC_COST_COINS);
        uState.updatedAt = new Date().toISOString();
        await saveUserStateD1(db, uState);
        nextCoinBalanceAfterUgc = uState.coinBalance;

        await recordTransactionD1(db, {
          uid,
          category: 'AI_UGC',
          direction: 'DEBIT',
          currency: 'COIN',
          amount: AI_UGC_COST_COINS,
          description: `Generate Prompt AI UGC Affiliate (${productName || 'Produk'}): -${AI_UGC_COST_COINS.toLocaleString('id-ID')} Koin`,
          referenceId: `ugc_${Date.now()}`,
        });
      }

      return c.json({
        ok: true,
        referenceMode,
        hasVideoAnalysis: hasVideoAttached,
        coinsCharged: AI_UGC_COST_COINS,
        costCoins: AI_UGC_COST_COINS,
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
      return c.json(
        {
          ok: false,
          error:
            err instanceof Error
              ? `Gagal menghasilkan prompt AI UGC: ${err.message}`
              : 'Terjadi kesalahan saat memproses AI UGC. Silakan coba lagi.',
        },
        500
      );
    }
  });
}
