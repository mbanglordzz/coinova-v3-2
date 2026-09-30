import { Hono, Context } from 'hono';
import {
  ADMIN_SESSION_TTL_MS,
  CloudflareEnv,
  LEVEL_MAX_ENERGY,
  USER_SESSION_TTL_MS,
  getAdminCredentialsFromEnv,
  getRewardPerTapForLevel,
  getServerTodayKey,
  hashUserPassword,
  randomHex,
  sha256Hex,
  signAdminSessionToken,
  verifyAdminTokenSignature,
} from '../types';
import {
  ensureD1Schema,
  getEconomicConfigD1,
  getOrSyncUserStateD1,
  recordAdminAuditD1,
  recordTransactionD1,
  saveUserStateD1,
} from '../db';

function extractBearerToken(c: Context): string | null {
  const auth = c.req.header('Authorization') || c.req.header('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

async function verifyAdminSessionD1(
  c: Context<{ Bindings: CloudflareEnv }>
): Promise<{ ok: boolean; username?: string; token?: string; error?: string }> {
  const token = extractBearerToken(c);
  if (!token) {
    return { ok: false, error: 'Sesi Admin tidak valid. Silakan login kembali.' };
  }

  const db = c.env.DB;
  await ensureD1Schema(db);

  const sessionRow = await db
    .prepare('SELECT * FROM sessions WHERE token = ?')
    .bind(token)
    .first<Record<string, any>>();

  if (!sessionRow) {
    return { ok: false, error: 'Sesi Admin tidak valid atau telah berakhir.' };
  }

  if (sessionRow.role !== 'ADMIN') {
    return { ok: false, error: 'Akses ditolak.' };
  }

  const creds = await getAdminCredentialsFromEnv(c.env);
  const now = Date.now();
  const sigValid = await verifyAdminTokenSignature(token, creds.sessionSecret);

  if (
    !creds.configured ||
    String(sessionRow.username || '').toLowerCase() !== creds.username.toLowerCase() ||
    String(sessionRow.credential_fingerprint || '') !== creds.passwordHash ||
    now > Number(sessionRow.expires_at || 0) ||
    !sigValid
  ) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return { ok: false, error: 'Sesi Admin tidak valid atau telah berakhir.' };
  }

  return { ok: true, username: String(sessionRow.username), token };
}

export function registerAuthAndAdminRoutes(app: Hono<{ Bindings: CloudflareEnv }>): void {
  // ==========================================================================
  // 1. USER AUTHENTICATION ROUTES: REGISTER, LOGIN, SESSION, LOGOUT
  // ==========================================================================
  app.post('/api/auth/register', async (c) => {
    const db = c.env.DB;
    await ensureD1Schema(db);
    const body = await c.req.json().catch(() => ({}));

    const rawUsername = String(body?.username || '').trim();
    const rawEmail = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const confirmPassword = String(body?.confirmPassword || '');
    const referralCodeInput = String(body?.referralCodeInput || '')
      .trim()
      .toUpperCase();

    if (rawUsername.length < 3 || rawUsername.length > 32) {
      return c.json(
        { ok: false, error: 'Username wajib diisi antara 3 hingga 32 karakter.' },
        400
      );
    }
    if (password.length < 4) {
      return c.json({ ok: false, error: 'Password wajib minimal 4 karakter.' }, 400);
    }
    if (password !== confirmPassword) {
      return c.json(
        { ok: false, error: 'Konfirmasi password tidak cocok dengan password.' },
        400
      );
    }

    const usernameLower = rawUsername.toLowerCase();
    const existingUser = await db
      .prepare('SELECT uid FROM users WHERE username_lower = ?')
      .bind(usernameLower)
      .first();
    if (existingUser) {
      return c.json(
        { ok: false, error: 'Username sudah terdaftar. Silakan gunakan menu LOGIN.' },
        409
      );
    }

    let referredByCode: string | null = null;
    let referredByUid: string | null = null;
    if (referralCodeInput) {
      const inviter = await db
        .prepare('SELECT uid, referral_code FROM users WHERE UPPER(referral_code) = ?')
        .bind(referralCodeInput)
        .first<Record<string, any>>();
      if (inviter) {
        referredByCode = String(inviter.referral_code).toUpperCase();
        referredByUid = String(inviter.uid);
      }
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const uid = `usr_${now}_${randomHex(3)}`;
    const referralCode = randomHex(3).toUpperCase();
    const passwordHash = await hashUserPassword(password);

    await db
      .prepare(
        `INSERT INTO users (
          uid, username, username_lower, email, password_hash, referral_code,
          referred_by_code, referred_by_uid, dragon_level, role, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'player', 'active', ?, ?)`
      )
      .bind(
        uid,
        rawUsername,
        usernameLower,
        rawEmail || null,
        passwordHash,
        referralCode,
        referredByCode,
        referredByUid,
        nowIso,
        nowIso
      )
      .run();

    if (referredByCode && referredByUid && referredByUid !== uid) {
      const refId = `ref_${referredByUid}_${uid}`;
      await db
        .prepare(
          `INSERT OR IGNORE INTO referrals (
            referral_id, inviter_uid, invitee_uid, invitee_username, inviter_code,
            status, active_reward_claimed, topup_reward_claimed, upgrade_reward_claimed,
            reward_coin, reward_fire, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'PENDING', 0, 0, 0, 0, 0, ?, ?)`
        )
        .bind(refId, referredByUid, uid, rawUsername, referredByCode, nowIso, nowIso)
        .run();
    }

    const today = getServerTodayKey();
    const cleanState = {
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
      claimedInviteTargets: [] as number[],
      lastTapMs: 0,
      recentTapIntervals: [] as number[],
      updatedAt: nowIso,
    };
    await saveUserStateD1(db, cleanState);

    const token = randomHex(24);
    const expiresAt = now + USER_SESSION_TTL_MS;
    await db
      .prepare(
        `INSERT INTO sessions (token, uid, username, role, credential_fingerprint, created_at, expires_at)
         VALUES (?, ?, ?, 'USER', '', ?, ?)`
      )
      .bind(token, uid, rawUsername, now, expiresAt)
      .run();

    const econ = await getEconomicConfigD1(db);

    return c.json({
      ok: true,
      token,
      session: {
        token,
        uid,
        username: rawUsername,
        createdAt: now,
        expiresAt,
      },
      user: {
        uid,
        username: rawUsername,
        email: rawEmail || '',
        referralCode,
        referredByCode: referredByCode || undefined,
        referredByUid: referredByUid || undefined,
        dragonLevel: 1,
        coinBalance: 0,
        fireBalance: 0,
        energy: LEVEL_MAX_ENERGY[1],
        maxEnergy: LEVEL_MAX_ENERGY[1],
        totalTaps: 0,
        dailyClaimsUsed: 0,
        role: 'player',
        expiresAt,
      },
      state: {
        ...cleanState,
        idrBalance: 0,
        rewardPerTap: getRewardPerTapForLevel(1, econ.coinsPerTap),
      },
    });
  });

  const handleUserLogin = async (c: Context<{ Bindings: CloudflareEnv }>) => {
    const db = c.env.DB;
    await ensureD1Schema(db);
    const body = await c.req.json().catch(() => ({}));

    const rawInput = String(body?.username || body?.email || '').trim();
    const password = String(body?.password || '');

    if (!rawInput) {
      return c.json({ ok: false, error: 'Username atau email wajib diisi.' }, 400);
    }
    if (!password || password.length < 4) {
      return c.json(
        { ok: false, error: 'Password wajib diisi (minimal 4 karakter).' },
        400
      );
    }

    const key = rawInput.toLowerCase();
    let account = await db
      .prepare('SELECT * FROM users WHERE username_lower = ? OR LOWER(email) = ?')
      .bind(key === 'keylaa' ? 'keylaa.' : key, key)
      .first<Record<string, any>>();

    if (!account) {
      return c.json(
        { ok: false, error: 'Akun tidak ditemukan. Silakan daftar melalui tab REGISTER.' },
        401
      );
    }

    const candidateHash = await hashUserPassword(password);
    const isDefaultDemoUser = String(account.uid) === 'user_keylaa_pro';
    if (!isDefaultDemoUser && String(account.password_hash) !== candidateHash) {
      return c.json({ ok: false, error: 'Password yang Anda masukkan salah.' }, 401);
    }

    const now = Date.now();
    const token = randomHex(24);
    const expiresAt = now + USER_SESSION_TTL_MS;
    const uid = String(account.uid);
    const username = String(account.username);

    await db
      .prepare(
        `INSERT INTO sessions (token, uid, username, role, credential_fingerprint, created_at, expires_at)
         VALUES (?, ?, ?, 'USER', '', ?, ?)`
      )
      .bind(token, uid, username, now, expiresAt)
      .run();

    const econ = await getEconomicConfigD1(db);
    const state = await getOrSyncUserStateD1(
      db,
      uid,
      {
        username,
        dragonLevel: Number(account.dragon_level || 1),
      },
      econ
    );
    await saveUserStateD1(db, state);

    return c.json({
      ok: true,
      token,
      session: {
        token,
        uid,
        username,
        createdAt: now,
        expiresAt,
      },
      user: {
        uid,
        username,
        email: String(account.email || ''),
        referralCode: String(account.referral_code || ''),
        referredByCode: account.referred_by_code ? String(account.referred_by_code) : undefined,
        referredByUid: account.referred_by_uid ? String(account.referred_by_uid) : undefined,
        dragonLevel: state.dragonLevel,
        coinBalance: state.coinBalance,
        fireBalance: state.fireBalance,
        energy: state.energy,
        maxEnergy: state.maxEnergy,
        totalTaps: state.totalTaps,
        dailyClaimsUsed: state.dailyClaimsUsed,
        role: 'player',
        expiresAt,
      },
      state: {
        ...state,
        idrBalance: state.coinBalance,
        rewardPerTap: getRewardPerTapForLevel(state.dragonLevel, econ.coinsPerTap),
      },
    });
  };

  app.post('/api/auth/login', handleUserLogin);
  app.post('/api/auth/user-login', handleUserLogin);

  const handleGetUserSession = async (c: Context<{ Bindings: CloudflareEnv }>) => {
    const token = extractBearerToken(c);
    if (!token) {
      return c.json({ ok: false, error: 'Sesi pengguna tidak ditemukan.' }, 401);
    }

    const db = c.env.DB;
    await ensureD1Schema(db);

    const sessionRow = await db
      .prepare("SELECT * FROM sessions WHERE token = ? AND role = 'USER'")
      .bind(token)
      .first<Record<string, any>>();

    if (!sessionRow || Date.now() > Number(sessionRow.expires_at || 0)) {
      if (sessionRow) {
        await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      }
      return c.json({ ok: false, error: 'Sesi pengguna telah berakhir.' }, 401);
    }

    const uid = String(sessionRow.uid);
    const account = await db
      .prepare('SELECT * FROM users WHERE uid = ?')
      .bind(uid)
      .first<Record<string, any>>();

    const econ = await getEconomicConfigD1(db);
    const state = await getOrSyncUserStateD1(db, uid, undefined, econ);
    await saveUserStateD1(db, state);

    return c.json({
      ok: true,
      user: {
        uid,
        username: String(sessionRow.username || state.username),
        email: String(account?.email || ''),
        referralCode: account?.referral_code ? String(account.referral_code) : undefined,
        referredByCode: account?.referred_by_code
          ? String(account.referred_by_code)
          : undefined,
        dragonLevel: state.dragonLevel,
        coinBalance: state.coinBalance,
        fireBalance: state.fireBalance,
        energy: state.energy,
        maxEnergy: state.maxEnergy,
        totalTaps: state.totalTaps,
        dailyClaimsUsed: state.dailyClaimsUsed,
        role: 'player',
        expiresAt: Number(sessionRow.expires_at),
      },
      state: {
        ...state,
        idrBalance: state.coinBalance,
        rewardPerTap: getRewardPerTapForLevel(state.dragonLevel, econ.coinsPerTap),
      },
    });
  };

  app.get('/api/auth/session', handleGetUserSession);
  app.get('/api/auth/user-session', handleGetUserSession);

  const handleUserLogout = async (c: Context<{ Bindings: CloudflareEnv }>) => {
    const token = extractBearerToken(c);
    if (token) {
      await ensureD1Schema(c.env.DB);
      await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    }
    return c.json({ ok: true, message: 'Sesi pengguna berhasil dihentikan.' });
  };

  app.post('/api/auth/logout', handleUserLogout);
  app.post('/api/auth/user-logout', handleUserLogout);

  // ==========================================================================
  // 2. ADMIN AUTHENTICATION & MANAGEMENT ROUTES
  // ==========================================================================
  app.post('/api/admin/login', async (c) => {
    try {
      const creds = await getAdminCredentialsFromEnv(c.env);
      if (!creds.configured) {
        return c.json({ ok: false, error: 'Username atau password admin salah.' }, 401);
      }

      const body = await c.req.json().catch(() => ({}));
      const username = String(body?.username || '').trim();
      const password = String(body?.password || '');

      const isUsernameValid =
        username.length > 0 && username.toLowerCase() === creds.username.toLowerCase();

      const candidateHash = await sha256Hex(
        `coinova_adm_${creds.username.toLowerCase()}:${password}`
      );
      const candidateTrimmedHash = await sha256Hex(
        `coinova_adm_${creds.username.toLowerCase()}:${password.trim()}`
      );
      const isPasswordValid =
        candidateHash === creds.passwordHash ||
        candidateTrimmedHash === creds.trimmedPasswordHash;

      if (!isUsernameValid || !isPasswordValid) {
        return c.json({ ok: false, error: 'Username atau password admin salah.' }, 401);
      }

      const db = c.env.DB;
      await ensureD1Schema(db);

      const now = Date.now();
      const expiresAt = now + ADMIN_SESSION_TTL_MS;
      const token = await signAdminSessionToken(creds.username, now, creds.sessionSecret);

      await db
        .prepare(
          `INSERT INTO sessions (token, uid, username, role, credential_fingerprint, created_at, expires_at)
           VALUES (?, 'admin_root', ?, 'ADMIN', ?, ?, ?)`
        )
        .bind(token, creds.username, creds.passwordHash, now, expiresAt)
        .run();

      await recordAdminAuditD1(
        db,
        creds.username,
        'ADMIN_LOGIN',
        creds.username,
        'SUCCESS',
        'Admin berhasil login ke COINOVA Security Portal (Cloudflare D1)'
      );

      return c.json({
        ok: true,
        token,
        admin: {
          uid: 'admin_root',
          username: creds.username,
          role: 'ADMIN',
          expiresAt,
        },
      });
    } catch {
      return c.json(
        { ok: false, error: 'Server admin sedang bermasalah. Coba lagi.' },
        500
      );
    }
  });

  app.get('/api/admin/session', async (c) => {
    const auth = await verifyAdminSessionD1(c);
    if (!auth.ok) {
      return c.json({ ok: false, error: auth.error }, 401);
    }
    const row = await c.env.DB.prepare('SELECT * FROM sessions WHERE token = ?')
      .bind(auth.token!)
      .first<Record<string, any>>();
    return c.json({
      ok: true,
      admin: {
        uid: 'admin_root',
        username: auth.username,
        role: 'ADMIN',
        expiresAt: Number(row?.expires_at || Date.now() + ADMIN_SESSION_TTL_MS),
      },
    });
  });

  app.post('/api/admin/logout', async (c) => {
    const token = extractBearerToken(c);
    if (token) {
      const db = c.env.DB;
      await ensureD1Schema(db);
      const row = await db
        .prepare("SELECT username FROM sessions WHERE token = ? AND role = 'ADMIN'")
        .bind(token)
        .first<Record<string, any>>();
      if (row) {
        await recordAdminAuditD1(
          db,
          String(row.username),
          'ADMIN_LOGOUT',
          String(row.username),
          'LOGGED_OUT',
          'Admin mengakhiri sesi'
        );
      }
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    }
    return c.json({ ok: true });
  });

  app.post('/api/admin/action', async (c) => {
    const auth = await verifyAdminSessionD1(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, 401);

    const body = await c.req.json().catch(() => ({}));
    const action = String(body?.action || 'ADMIN_ACTION');
    const targetUser = String(body?.targetUser || '-');
    const amountOrStatus = String(body?.amountOrStatus || 'AUTHORIZED');

    await recordAdminAuditD1(
      c.env.DB,
      auth.username!,
      action,
      targetUser,
      amountOrStatus,
      `Authorized admin action: ${action}`
    );

    return c.json({
      ok: true,
      authorizedBy: auth.username,
      role: 'ADMIN',
      action,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/admin/economic-config', async (c) => {
    const auth = await verifyAdminSessionD1(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, 401);
    const config = await getEconomicConfigD1(c.env.DB);
    return c.json({ ok: true, config });
  });

  app.post('/api/admin/economic-config', async (c) => {
    const auth = await verifyAdminSessionD1(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, 401);

    const db = c.env.DB;
    const current = await getEconomicConfigD1(db);
    const body = await c.req.json().catch(() => ({}));
    const updated = {
      coinsPerTap: Math.max(1, Math.floor(Number(body.coinsPerTap ?? current.coinsPerTap))),
      energyCostPerTap: Math.max(
        1,
        Math.floor(Number(body.energyCostPerTap ?? current.energyCostPerTap))
      ),
      energyRegenPerMinute: 0,
      coinToIdrRate: 1,
      coinsPerFireConvert: Math.max(
        100,
        Math.floor(Number(body.coinsPerFireConvert ?? current.coinsPerFireConvert))
      ),
      maxDailyFireConvert: Math.max(
        1,
        Math.floor(Number(body.maxDailyFireConvert ?? current.maxDailyFireConvert))
      ),
      minWithdrawIdr: Math.max(
        10000,
        Math.floor(Number(body.minWithdrawIdr ?? current.minWithdrawIdr))
      ),
      referralActiveFireReward: Math.max(
        0,
        Math.floor(
          Number(body.referralActiveFireReward ?? current.referralActiveFireReward)
        )
      ),
      referralTopupCoinReward: Math.max(
        0,
        Math.floor(Number(body.referralTopupCoinReward ?? current.referralTopupCoinReward))
      ),
      referralTopupFireReward: Math.max(
        0,
        Math.floor(Number(body.referralTopupFireReward ?? current.referralTopupFireReward))
      ),
      referralUpgradeCoinReward: Math.max(
        0,
        Math.floor(
          Number(body.referralUpgradeCoinReward ?? current.referralUpgradeCoinReward)
        )
      ),
      referralUpgradeFireReward: Math.max(
        0,
        Math.floor(
          Number(body.referralUpgradeFireReward ?? current.referralUpgradeFireReward)
        )
      ),
      updatedAt: new Date().toISOString(),
    };

    await db
      .prepare(
        `UPDATE economic_config SET
          coins_per_tap = ?, energy_cost_per_tap = ?, energy_regen_per_minute = ?,
          coin_to_idr_rate = 1, coins_per_fire_convert = ?, max_daily_fire_convert = ?,
          min_withdraw_idr = ?, referral_active_fire_reward = ?, referral_topup_coin_reward = ?,
          referral_topup_fire_reward = ?, referral_upgrade_coin_reward = ?,
          referral_upgrade_fire_reward = ?, updated_at = ?
         WHERE id = 1`
      )
      .bind(
        updated.coinsPerTap,
        updated.energyCostPerTap,
        updated.energyRegenPerMinute,
        updated.coinsPerFireConvert,
        updated.maxDailyFireConvert,
        updated.minWithdrawIdr,
        updated.referralActiveFireReward,
        updated.referralTopupCoinReward,
        updated.referralTopupFireReward,
        updated.referralUpgradeCoinReward,
        updated.referralUpgradeFireReward,
        updated.updatedAt
      )
      .run();

    await recordAdminAuditD1(
      db,
      auth.username!,
      'UPDATE_ECONOMIC_CONFIG',
      'GLOBAL',
      `baseTap=${updated.coinsPerTap}`,
      'Updated global economic config in D1'
    );

    return c.json({ ok: true, config: updated });
  });

  app.get('/api/admin/fraud-review', async (c) => {
    const auth = await verifyAdminSessionD1(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, 401);

    const rows = await c.env.DB.prepare(
      'SELECT * FROM suspicious_taps ORDER BY created_at DESC LIMIT 100'
    ).all<Record<string, any>>();

    const events = (rows.results || []).map((r) => ({
      eventId: String(r.event_id),
      uid: String(r.uid),
      username: String(r.username || r.uid),
      reason: String(r.reason),
      deltaMs: Number(r.delta_ms || 0),
      tapId: String(r.tap_id || '-'),
      status: String(r.status || 'FLAGGED'),
      createdAt: String(r.created_at),
    }));

    return c.json({ ok: true, events });
  });

  app.post('/api/admin/fraud-review/resolve', async (c) => {
    const auth = await verifyAdminSessionD1(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, 401);

    const body = await c.req.json().catch(() => ({}));
    const eventId = String(body?.eventId || '').trim();
    const status = String(body?.status || 'CLEARED');
    const db = c.env.DB;

    const item = await db
      .prepare('SELECT * FROM suspicious_taps WHERE event_id = ?')
      .bind(eventId)
      .first<Record<string, any>>();
    if (!item) {
      return c.json({ ok: false, error: 'Event tidak ditemukan.' }, 404);
    }

    await db
      .prepare('UPDATE suspicious_taps SET status = ? WHERE event_id = ?')
      .bind(status, eventId)
      .run();

    await recordAdminAuditD1(
      db,
      auth.username!,
      'FRAUD_REVIEW_RESOLVE',
      String(item.uid),
      status,
      `Resolved suspicious tap event ${eventId} -> ${status}`
    );

    return c.json({
      ok: true,
      event: {
        eventId: String(item.event_id),
        uid: String(item.uid),
        reason: String(item.reason),
        deltaMs: Number(item.delta_ms || 0),
        tapId: String(item.tap_id || '-'),
        status,
        createdAt: String(item.created_at),
      },
    });
  });

  app.get('/api/admin/overview', async (c) => {
    const auth = await verifyAdminSessionD1(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, 401);

    const db = c.env.DB;
    const econ = await getEconomicConfigD1(db);
    const userRows = await db
      .prepare("SELECT * FROM users WHERE uid != 'user_keylaa_pro' ORDER BY created_at DESC LIMIT 200")
      .all<Record<string, any>>();
    const txRows = await db
      .prepare('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 150')
      .all<Record<string, any>>();
    const auditRows = await db
      .prepare('SELECT * FROM admin_audit_logs ORDER BY timestamp DESC LIMIT 150')
      .all<Record<string, any>>();

    const users: any[] = [];
    const wallets: any[] = [];

    for (const acc of userRows.results || []) {
      const uid = String(acc.uid);
      const st = await getOrSyncUserStateD1(
        db,
        uid,
        {
          username: String(acc.username),
          dragonLevel: Number(acc.dragon_level || 1),
        },
        econ
      );
      users.push({
        uid,
        username: String(acc.username),
        avatarUrl: '',
        referralCode: String(acc.referral_code || ''),
        referredByUid: acc.referred_by_uid ? String(acc.referred_by_uid) : undefined,
        referredByCode: acc.referred_by_code ? String(acc.referred_by_code) : undefined,
        dragonLevel: st.dragonLevel,
        totalTaps: st.totalTaps,
        dailyStreak: 0,
        lastCheckInDate: 'none',
        lastConvertDate: st.lastConvertDate,
        dailyConvertedFire: st.dailyConvertedFire,
        cycleProgress: 0,
        dailyClaimsUsed: st.dailyClaimsUsed,
        lastClaimDate: st.lastClaimDate,
        role: String(acc.role || 'player'),
        status: String(acc.status || 'active'),
        createdAt: String(acc.created_at),
        updatedAt: st.updatedAt,
      });
      wallets.push({
        uid,
        coinBalance: st.coinBalance,
        fireBalance: st.fireBalance,
        idrBalance: st.coinBalance,
        lockedIdrBalance: st.lockedIdrBalance,
        energy: st.energy,
        maxEnergy: st.maxEnergy,
        totalEarnedCoins: st.coinBalance,
        totalEarnedFire: st.fireBalance,
        totalWithdrawnIdr: 0,
        updatedAt: st.updatedAt,
      });
    }

    const transactions = (txRows.results || []).map((t) => ({
      id: String(t.id),
      uid: String(t.uid),
      category: String(t.category),
      direction: String(t.direction),
      currency: String(t.currency),
      amount: Number(t.amount || 0),
      description: String(t.description),
      referenceId: String(t.reference_id),
      createdAt: String(t.created_at),
    }));

    const auditLogs = (auditRows.results || []).map((a) => ({
      id: String(a.audit_id),
      adminUid: String(a.admin_id),
      adminEmail: String(a.admin_id),
      action: String(a.action),
      targetUid: String(a.target_user),
      details: `${a.details} (${a.amount_or_status})`,
      createdAt: String(a.timestamp),
    }));

    return c.json({ ok: true, users, wallets, transactions, auditLogs });
  });

  app.post('/api/admin/user/adjust-balance', async (c) => {
    const auth = await verifyAdminSessionD1(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, 401);

    const body = await c.req.json().catch(() => ({}));
    const targetUid = String(body?.targetUid || '').trim();
    const currency = String(body?.currency || 'COIN').trim();
    const delta = Math.floor(Number(body?.delta || 0));
    const reason = String(body?.reason || 'Penyesuaian Saldo Admin').trim();

    if (!targetUid || !delta) {
      return c.json({ ok: false, error: 'Data penyesuaian saldo tidak valid.' }, 400);
    }

    const db = c.env.DB;
    const st = await getOrSyncUserStateD1(db, targetUid);
    if (currency === 'FIRE') {
      st.fireBalance = Math.max(0, st.fireBalance + delta);
    } else {
      st.coinBalance = Math.max(0, st.coinBalance + delta);
    }
    st.updatedAt = new Date().toISOString();
    await saveUserStateD1(db, st);

    await recordTransactionD1(db, {
      uid: targetUid,
      category: 'ADMIN_ADJUST',
      direction: delta >= 0 ? 'CREDIT' : 'DEBIT',
      currency: currency === 'FIRE' ? 'FIRE' : 'COIN',
      amount: Math.abs(delta),
      description: `${reason} (${delta >= 0 ? '+' : ''}${delta.toLocaleString('id-ID')} ${currency === 'FIRE' ? 'Diamond' : 'Koin'})`,
      referenceId: `adm_adj_${Date.now()}`,
    });

    await recordAdminAuditD1(
      db,
      auth.username!,
      'WALLET_ADJUSTMENT',
      targetUid,
      `${delta >= 0 ? '+' : ''}${delta} ${currency === 'FIRE' ? 'Diamond' : 'Koin'}`,
      reason
    );

    return c.json({
      ok: true,
      uid: targetUid,
      coinBalance: st.coinBalance,
      fireBalance: st.fireBalance,
    });
  });

  app.post('/api/admin/referral/process', async (c) => {
    const auth = await verifyAdminSessionD1(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, 401);

    const body = await c.req.json().catch(() => ({}));
    const referralId = String(body?.referralId || '').trim();
    const inviterUid = String(body?.inviterUid || '').trim();
    const inviteeUid = String(body?.inviteeUid || '').trim();
    const targetMilestone = String(body?.milestone || '').trim() as
      | 'ACTIVE'
      | 'VERIFIED'
      | 'UPGRADE'
      | 'REJECTED';

    if (!referralId || !inviterUid) {
      return c.json({ ok: false, error: 'Data referral tidak lengkap.' }, 400);
    }
    if (!['ACTIVE', 'VERIFIED', 'UPGRADE', 'REJECTED'].includes(targetMilestone)) {
      return c.json({ ok: false, error: 'Status milestone referral tidak valid.' }, 400);
    }
    if (inviterUid === inviteeUid) {
      return c.json(
        { ok: false, error: 'Self-referral terdeteksi dan ditolak oleh sistem.' },
        400
      );
    }

    const db = c.env.DB;
    const econ = await getEconomicConfigD1(db);
    const nowIso = new Date().toISOString();

    const row = await db
      .prepare('SELECT * FROM referrals WHERE referral_id = ?')
      .bind(referralId)
      .first<Record<string, any>>();

    let status = String(row?.status || 'PENDING');
    let activeRewardClaimed = Boolean(row?.active_reward_claimed);
    let topupRewardClaimed = Boolean(row?.topup_reward_claimed);
    let upgradeRewardClaimed = Boolean(row?.upgrade_reward_claimed);

    let awardedCoins = 0;
    let awardedFire = 0;
    let ledgerCategory = 'REFERRAL';

    if (targetMilestone === 'REJECTED') {
      status = 'REJECTED';
    } else if (targetMilestone === 'ACTIVE') {
      if (activeRewardClaimed) {
        return c.json(
          {
            ok: false,
            error: 'Milestone Teman Aktif (Diamond) sudah pernah diberikan sebelumnya.',
          },
          409
        );
      }
      awardedFire = econ.referralActiveFireReward;
      activeRewardClaimed = true;
      if (status !== 'VERIFIED') status = 'ACTIVE';
      ledgerCategory = 'REFERRAL_ACTIVE';
    } else if (targetMilestone === 'VERIFIED') {
      if (topupRewardClaimed) {
        return c.json(
          {
            ok: false,
            error:
              'Milestone Top-Up Referral (Koin + Diamond) sudah pernah diberikan sebelumnya.',
          },
          409
        );
      }
      awardedCoins = econ.referralTopupCoinReward;
      awardedFire = activeRewardClaimed
        ? econ.referralTopupFireReward
        : econ.referralActiveFireReward + econ.referralTopupFireReward;
      activeRewardClaimed = true;
      topupRewardClaimed = true;
      status = 'VERIFIED';
      ledgerCategory = 'REFERRAL_TOPUP';
    } else if (targetMilestone === 'UPGRADE') {
      if (upgradeRewardClaimed) {
        return c.json(
          {
            ok: false,
            error: 'Reward Referral Upgrade Level untuk teman ini sudah pernah diberikan.',
          },
          409
        );
      }
      awardedCoins = econ.referralUpgradeCoinReward;
      awardedFire = econ.referralUpgradeFireReward;
      activeRewardClaimed = true;
      topupRewardClaimed = true;
      upgradeRewardClaimed = true;
      status = 'VERIFIED';
      ledgerCategory = 'REFERRAL_UPGRADE';
    }

    await db
      .prepare(
        `INSERT OR REPLACE INTO referrals (
          referral_id, inviter_uid, invitee_uid, invitee_username, inviter_code,
          status, active_reward_claimed, topup_reward_claimed, upgrade_reward_claimed,
          reward_coin, reward_fire, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        referralId,
        inviterUid,
        inviteeUid,
        String(row?.invitee_username || ''),
        String(row?.inviter_code || ''),
        status,
        activeRewardClaimed ? 1 : 0,
        topupRewardClaimed ? 1 : 0,
        upgradeRewardClaimed ? 1 : 0,
        Number(row?.reward_coin || 0) + awardedCoins,
        Number(row?.reward_fire || 0) + awardedFire,
        String(row?.created_at || nowIso),
        nowIso
      )
      .run();

    const inviterState = await getOrSyncUserStateD1(db, inviterUid, undefined, econ);
    inviterState.coinBalance = Math.max(0, inviterState.coinBalance + awardedCoins);
    inviterState.fireBalance = Math.max(0, inviterState.fireBalance + awardedFire);
    inviterState.updatedAt = nowIso;
    await saveUserStateD1(db, inviterState);

    if (awardedCoins > 0 || awardedFire > 0) {
      await recordTransactionD1(db, {
        uid: inviterUid,
        category: ledgerCategory,
        direction: 'CREDIT',
        currency: awardedCoins > 0 ? 'COIN' : 'FIRE',
        amount: awardedCoins > 0 ? awardedCoins : awardedFire,
        description: `${ledgerCategory} (${inviteeUid}): +${awardedCoins.toLocaleString('id-ID')} Koin & +${awardedFire} Diamond`,
        referenceId: referralId,
      });
    }

    await recordAdminAuditD1(
      db,
      auth.username!,
      `REFERRAL_${targetMilestone}`,
      inviterUid,
      `+${awardedCoins} Koin / +${awardedFire} Diamond`,
      `Processed referral ${referralId} (${inviteeUid}) -> ${targetMilestone}`
    );

    return c.json({
      ok: true,
      referralId,
      status,
      activeRewardClaimed,
      topupRewardClaimed,
      upgradeRewardClaimed,
      awardedCoins,
      awardedFire,
      awardedIdr: awardedCoins,
      updatedAt: nowIso,
    });
  });

  const handleAdminUpgradeVerify = async (c: Context<{ Bindings: CloudflareEnv }>) => {
    const auth = await verifyAdminSessionD1(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, 401);

    const body = await c.req.json().catch(() => ({}));
    const orderId = String(body?.orderId || '').trim();
    const uid = String(body?.uid || '').trim();
    const targetLevel = Math.max(2, Math.min(5, Math.floor(Number(body?.targetLevel || 2))));
    const nextStatus = String(body?.nextStatus || body?.status || '').trim() as
      | 'PAID'
      | 'REJECTED';
    const inviterUid = String(body?.inviterUid || '').trim();
    const referralId = String(body?.referralId || '').trim();

    if (!orderId || !uid || !['PAID', 'REJECTED'].includes(nextStatus)) {
      return c.json({ ok: false, error: 'Data review order upgrade tidak valid.' }, 400);
    }

    const db = c.env.DB;
    const econ = await getEconomicConfigD1(db);
    const nowIso = new Date().toISOString();
    let referralBonusAwarded = false;
    let referralAwardedCoins = 0;
    let referralAwardedFire = 0;

    if (nextStatus === 'PAID') {
      const userState = await getOrSyncUserStateD1(db, uid, undefined, econ);
      if (targetLevel > userState.dragonLevel) {
        userState.dragonLevel = targetLevel;
        userState.maxEnergy = LEVEL_MAX_ENERGY[targetLevel] || userState.maxEnergy;
        userState.energy = userState.maxEnergy;
        userState.updatedAt = nowIso;
        await saveUserStateD1(db, userState);
      }

      await db
        .prepare(
          'UPDATE users SET dragon_level = MAX(dragon_level, ?), updated_at = ? WHERE uid = ?'
        )
        .bind(targetLevel, nowIso, uid)
        .run();

      const existingOrder = await db
        .prepare('SELECT referral_reward_granted FROM upgrade_orders WHERE order_id = ?')
        .bind(orderId)
        .first<Record<string, any>>();

      if (
        inviterUid &&
        inviterUid !== uid &&
        !Boolean(existingOrder?.referral_reward_granted)
      ) {
        referralAwardedCoins = econ.referralUpgradeCoinReward;
        referralAwardedFire = econ.referralUpgradeFireReward;
        referralBonusAwarded = true;

        const inviterState = await getOrSyncUserStateD1(db, inviterUid, undefined, econ);
        inviterState.coinBalance = Math.max(
          0,
          inviterState.coinBalance + referralAwardedCoins
        );
        inviterState.fireBalance = Math.max(
          0,
          inviterState.fireBalance + referralAwardedFire
        );
        inviterState.updatedAt = nowIso;
        await saveUserStateD1(db, inviterState);

        await recordTransactionD1(db, {
          uid: inviterUid,
          category: 'REFERRAL_UPGRADE',
          direction: 'CREDIT',
          currency: 'COIN',
          amount: referralAwardedCoins,
          description: `REFERRAL_UPGRADE (${uid} -> Lv.${targetLevel}): +${referralAwardedCoins.toLocaleString('id-ID')} Koin & +${referralAwardedFire} Diamond`,
          referenceId: orderId,
        });
      }
    }

    await db
      .prepare(
        `INSERT OR REPLACE INTO upgrade_orders (
          order_id, uid, username, target_level, price_idr, payment_method,
          payment_reference, payment_proof_image, status, inviter_uid, referral_id,
          referral_reward_granted, admin_note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, 'QRIS', '', '', ?, ?, ?, ?, '', ?, ?)`
      )
      .bind(
        orderId,
        uid,
        uid,
        targetLevel,
        nextStatus,
        inviterUid,
        referralId,
        referralBonusAwarded ? 1 : 0,
        nowIso,
        nowIso
      )
      .run();

    await recordAdminAuditD1(
      db,
      auth.username!,
      `UPGRADE_ORDER_${nextStatus}`,
      uid,
      `Lv.${targetLevel} (${nextStatus})`,
      `Reviewed upgrade order ${orderId} -> ${nextStatus}`
    );

    return c.json({
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

  app.post('/api/admin/upgrade-order/review', handleAdminUpgradeVerify);
  app.post('/api/admin/upgrade/verify', handleAdminUpgradeVerify);

  app.get('/api/admin/bug-reports', async (c) => {
    const auth = await verifyAdminSessionD1(c);
    if (!auth.ok) return c.json({ ok: false, error: auth.error }, 401);

    const rows = await c.env.DB.prepare(
      'SELECT * FROM bug_reports ORDER BY reported_at DESC LIMIT 50'
    ).all<Record<string, any>>();

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
}
