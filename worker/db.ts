import {
  D1Database,
  DEFAULT_ECONOMIC_CONFIG,
  LEVEL_MAX_ENERGY,
  ServerEconomicConfig,
  ServerUserState,
  getServerTodayKey,
} from './types';

let schemaInitialized = false;

/**
 * Ensures all D1 tables and default seed records exist.
 * Runs once per Worker isolate cold-start so even if migrations were not manually
 * executed yet, the D1 database self-heals automatically.
 */
export async function ensureD1Schema(db: D1Database): Promise<void> {
  if (schemaInitialized) return;
  try {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS users (
        uid TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        email TEXT,
        password_hash TEXT NOT NULL,
        referral_code TEXT NOT NULL UNIQUE,
        referred_by_code TEXT,
        referred_by_uid TEXT,
        dragon_level INTEGER NOT NULL DEFAULT 1,
        role TEXT NOT NULL DEFAULT 'player',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'USER',
        credential_fingerprint TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS user_states (
        uid TEXT PRIMARY KEY,
        username TEXT NOT NULL DEFAULT 'Member',
        dragon_level INTEGER NOT NULL DEFAULT 1,
        coin_balance INTEGER NOT NULL DEFAULT 0,
        fire_balance INTEGER NOT NULL DEFAULT 0,
        locked_idr_balance INTEGER NOT NULL DEFAULT 0,
        energy INTEGER NOT NULL DEFAULT 200,
        max_energy INTEGER NOT NULL DEFAULT 200,
        last_energy_regen_ms INTEGER NOT NULL DEFAULT 0,
        cycle_progress INTEGER NOT NULL DEFAULT 0,
        daily_claims_used INTEGER NOT NULL DEFAULT 0,
        last_claim_date TEXT NOT NULL DEFAULT '',
        last_convert_date TEXT NOT NULL DEFAULT '',
        daily_converted_fire INTEGER NOT NULL DEFAULT 0,
        total_taps INTEGER NOT NULL DEFAULT 0,
        claimed_invite_targets TEXT NOT NULL DEFAULT '[]',
        last_tap_ms INTEGER NOT NULL DEFAULT 0,
        recent_tap_intervals TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        category TEXT NOT NULL,
        direction TEXT NOT NULL,
        currency TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS referrals (
        referral_id TEXT PRIMARY KEY,
        inviter_uid TEXT NOT NULL,
        invitee_uid TEXT NOT NULL UNIQUE,
        invitee_username TEXT NOT NULL DEFAULT '',
        inviter_code TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'PENDING',
        active_reward_claimed INTEGER NOT NULL DEFAULT 0,
        topup_reward_claimed INTEGER NOT NULL DEFAULT 0,
        upgrade_reward_claimed INTEGER NOT NULL DEFAULT 0,
        reward_coin INTEGER NOT NULL DEFAULT 0,
        reward_fire INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS withdrawals (
        withdrawal_id TEXT PRIMARY KEY,
        request_id TEXT UNIQUE,
        uid TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        method TEXT NOT NULL,
        account_number TEXT NOT NULL,
        account_name TEXT NOT NULL,
        amount_coins INTEGER NOT NULL,
        amount_idr INTEGER NOT NULL,
        coins_spent INTEGER NOT NULL,
        fire_spent INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        payment_reference TEXT NOT NULL DEFAULT '',
        admin_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS admin_audit_logs (
        audit_id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        target_user TEXT NOT NULL,
        amount_or_status TEXT NOT NULL,
        details TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS bug_reports (
        report_id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        username TEXT NOT NULL,
        description TEXT NOT NULL,
        feature_area TEXT NOT NULL,
        app_version TEXT NOT NULL,
        has_screenshot INTEGER NOT NULL DEFAULT 0,
        screenshot_file_name TEXT NOT NULL DEFAULT '',
        screenshot_data_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        reported_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS suspicious_taps (
        event_id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL,
        delta_ms INTEGER NOT NULL DEFAULT 0,
        tap_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'FLAGGED',
        created_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS economic_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        coins_per_tap INTEGER NOT NULL DEFAULT 10,
        energy_cost_per_tap INTEGER NOT NULL DEFAULT 1,
        energy_regen_per_minute INTEGER NOT NULL DEFAULT 0,
        coin_to_idr_rate INTEGER NOT NULL DEFAULT 1,
        coins_per_fire_convert INTEGER NOT NULL DEFAULT 1000,
        max_daily_fire_convert INTEGER NOT NULL DEFAULT 10,
        min_withdraw_idr INTEGER NOT NULL DEFAULT 500000,
        referral_active_fire_reward INTEGER NOT NULL DEFAULT 2,
        referral_topup_coin_reward INTEGER NOT NULL DEFAULT 25000,
        referral_topup_fire_reward INTEGER NOT NULL DEFAULT 8,
        referral_upgrade_coin_reward INTEGER NOT NULL DEFAULT 25000,
        referral_upgrade_fire_reward INTEGER NOT NULL DEFAULT 10,
        updated_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS diamond_challenges (
        challenge_id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        question TEXT NOT NULL,
        expected_answer INTEGER NOT NULL,
        reward_fire INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS task_claims (
        claim_key TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        task_id TEXT NOT NULL,
        target_milestone INTEGER NOT NULL DEFAULT 0,
        coin_reward INTEGER NOT NULL DEFAULT 0,
        fire_reward INTEGER NOT NULL DEFAULT 0,
        claimed_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS processed_tap_ids (
        tap_id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS upgrade_orders (
        order_id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        target_level INTEGER NOT NULL,
        price_idr INTEGER NOT NULL,
        payment_method TEXT NOT NULL DEFAULT 'QRIS',
        payment_reference TEXT NOT NULL DEFAULT '',
        payment_proof_image TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'WAITING_PAYMENT',
        inviter_uid TEXT NOT NULL DEFAULT '',
        referral_id TEXT NOT NULL DEFAULT '',
        referral_reward_granted INTEGER NOT NULL DEFAULT 0,
        admin_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
      db.prepare(`INSERT OR IGNORE INTO economic_config (
        id, coins_per_tap, energy_cost_per_tap, energy_regen_per_minute,
        coin_to_idr_rate, coins_per_fire_convert, max_daily_fire_convert,
        min_withdraw_idr, referral_active_fire_reward, referral_topup_coin_reward,
        referral_topup_fire_reward, referral_upgrade_coin_reward, referral_upgrade_fire_reward,
        updated_at
      ) VALUES (1, 10, 1, 15, 1, 1000, 10, 500000, 2, 25000, 8, 25000, 10, '2026-09-28T00:00:00.000Z')`),
      db.prepare(`INSERT OR IGNORE INTO users (
        uid, username, username_lower, email, password_hash, referral_code,
        dragon_level, role, status, created_at, updated_at
      ) VALUES (
        'user_keylaa_pro', 'Keylaa.', 'keylaa.', 'keylaa@coinova.id',
        'af8be87eb2a9bd0e8b1daff6f1f34770a8f4076fad7916bee6514f8c9aaed104',
        'F11B4A', 4, 'player', 'active', '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z'
      )`),
    ]);
    schemaInitialized = true;
  } catch (err) {
    console.warn('D1 schema init warning:', err);
  }
}

export async function getEconomicConfigD1(db: D1Database): Promise<ServerEconomicConfig> {
  await ensureD1Schema(db);
  const row = await db
    .prepare('SELECT * FROM economic_config WHERE id = 1')
    .first<Record<string, any>>();
  if (!row) return { ...DEFAULT_ECONOMIC_CONFIG };
  return {
    coinsPerTap: Number(row.coins_per_tap ?? 10),
    energyCostPerTap: Number(row.energy_cost_per_tap ?? 1),
    energyRegenPerMinute: 0,
    coinToIdrRate: Number(row.coin_to_idr_rate ?? 1),
    coinsPerFireConvert: Number(row.coins_per_fire_convert ?? 1000),
    maxDailyFireConvert: Number(row.max_daily_fire_convert ?? 10),
    minWithdrawIdr: Number(row.min_withdraw_idr ?? 500000),
    referralActiveFireReward: Number(row.referral_active_fire_reward ?? 2),
    referralTopupCoinReward: Number(row.referral_topup_coin_reward ?? 25000),
    referralTopupFireReward: Number(row.referral_topup_fire_reward ?? 8),
    referralUpgradeCoinReward: Number(row.referral_upgrade_coin_reward ?? 25000),
    referralUpgradeFireReward: Number(row.referral_upgrade_fire_reward ?? 10),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

export async function getOrSyncUserStateD1(
  db: D1Database,
  uid: string,
  hint?: Partial<ServerUserState>,
  econ?: ServerEconomicConfig
): Promise<ServerUserState> {
  await ensureD1Schema(db);
  const config = econ || (await getEconomicConfigD1(db));
  const today = getServerTodayKey();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const row = await db
    .prepare('SELECT * FROM user_states WHERE uid = ?')
    .bind(uid)
    .first<Record<string, any>>();

  if (!row) {
    const initLevel = Math.max(
      1,
      Math.min(5, Math.floor(Number(hint?.dragonLevel || (uid === 'user_keylaa_pro' ? 4 : 1))))
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

    const created: ServerUserState = {
      uid,
      username: hint?.username || (uid === 'user_keylaa_pro' ? 'Keylaa.' : 'Member'),
      dragonLevel: initLevel,
      coinBalance: Math.max(0, Math.floor(Number(hint?.coinBalance ?? 0))),
      fireBalance: Math.max(0, Math.floor(Number(hint?.fireBalance ?? 0))),
      lockedIdrBalance: Math.max(0, Math.floor(Number(hint?.lockedIdrBalance ?? 0))),
      energy: initEnergy,
      maxEnergy,
      lastEnergyRegenMs: nowMs,
      cycleProgress: 0,
      dailyClaimsUsed: initClaims,
      lastClaimDate: today,
      lastConvertDate: today,
      dailyConvertedFire: initConverted,
      totalTaps: Math.max(0, Math.floor(Number(hint?.totalTaps ?? 0))),
      claimedInviteTargets: [],
      lastTapMs: 0,
      recentTapIntervals: [],
      updatedAt: nowIso,
    };

    await db
      .prepare(
        `INSERT OR REPLACE INTO user_states (
          uid, username, dragon_level, coin_balance, fire_balance, locked_idr_balance,
          energy, max_energy, last_energy_regen_ms, cycle_progress, daily_claims_used,
          last_claim_date, last_convert_date, daily_converted_fire, total_taps,
          claimed_invite_targets, last_tap_ms, recent_tap_intervals, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        created.uid,
        created.username,
        created.dragonLevel,
        created.coinBalance,
        created.fireBalance,
        created.lockedIdrBalance,
        created.energy,
        created.maxEnergy,
        created.lastEnergyRegenMs,
        created.cycleProgress,
        created.dailyClaimsUsed,
        created.lastClaimDate,
        created.lastConvertDate,
        created.dailyConvertedFire,
        created.totalTaps,
        JSON.stringify(created.claimedInviteTargets),
        created.lastTapMs,
        JSON.stringify(created.recentTapIntervals),
        created.updatedAt
      )
      .run();

    return created;
  }

  let dragonLevel = Number(row.dragon_level || 1);
  if (uid === 'user_keylaa_pro' && dragonLevel < 4) {
    dragonLevel = 4;
  }
  if (hint?.dragonLevel !== undefined) {
    const hintedLevel = Math.max(1, Math.min(5, Math.floor(Number(hint.dragonLevel) || 1)));
    if (hintedLevel !== dragonLevel) {
      dragonLevel = hintedLevel;
    }
  }

  const maxEnergy = LEVEL_MAX_ENERGY[dragonLevel] || 200;
  let energy = Math.min(maxEnergy, Math.max(0, Number(row.energy ?? maxEnergy)));
  let lastEnergyRegenMs = Number(row.last_energy_regen_ms || nowMs);

  let lastClaimDate = String(row.last_claim_date || '');
  let dailyClaimsUsed = Number(row.daily_claims_used || 0);
  if (lastClaimDate !== today) {
    lastClaimDate = today;
    dailyClaimsUsed = 0;
  }

  let lastConvertDate = String(row.last_convert_date || '');
  let dailyConvertedFire = Number(row.daily_converted_fire || 0);
  if (lastConvertDate !== today) {
    lastConvertDate = today;
    dailyConvertedFire = 0;
  }

  // Core Energy never regenerates automatically. Time elapsed is irrelevant.

  let claimedInviteTargets: number[] = [];
  try {
    claimedInviteTargets = JSON.parse(String(row.claimed_invite_targets || '[]'));
  } catch {
    claimedInviteTargets = [];
  }

  let recentTapIntervals: number[] = [];
  try {
    recentTapIntervals = JSON.parse(String(row.recent_tap_intervals || '[]'));
  } catch {
    recentTapIntervals = [];
  }

  const state: ServerUserState = {
    uid,
    username: String(row.username || hint?.username || 'Member'),
    dragonLevel,
    coinBalance: Math.max(0, Number(row.coin_balance || 0)),
    fireBalance: Math.max(0, Number(row.fire_balance || 0)),
    lockedIdrBalance: Math.max(0, Number(row.locked_idr_balance || 0)),
    energy,
    maxEnergy,
    lastEnergyRegenMs,
    cycleProgress: Number(row.cycle_progress || 0),
    dailyClaimsUsed,
    lastClaimDate,
    lastConvertDate,
    dailyConvertedFire,
    totalTaps: Math.max(0, Number(row.total_taps || 0)),
    claimedInviteTargets,
    lastTapMs: Number(row.last_tap_ms || 0),
    recentTapIntervals,
    updatedAt: String(row.updated_at || nowIso),
  };

  return state;
}

export async function saveUserStateD1(db: D1Database, state: ServerUserState): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO user_states (
        uid, username, dragon_level, coin_balance, fire_balance, locked_idr_balance,
        energy, max_energy, last_energy_regen_ms, cycle_progress, daily_claims_used,
        last_claim_date, last_convert_date, daily_converted_fire, total_taps,
        claimed_invite_targets, last_tap_ms, recent_tap_intervals, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      state.uid,
      state.username,
      state.dragonLevel,
      state.coinBalance,
      state.fireBalance,
      state.lockedIdrBalance,
      state.energy,
      state.maxEnergy,
      state.lastEnergyRegenMs,
      state.cycleProgress,
      state.dailyClaimsUsed,
      state.lastClaimDate,
      state.lastConvertDate,
      state.dailyConvertedFire,
      state.totalTaps,
      JSON.stringify(state.claimedInviteTargets || []),
      state.lastTapMs || 0,
      JSON.stringify(state.recentTapIntervals || []),
      state.updatedAt
    )
    .run();
}

export async function recordTransactionD1(
  db: D1Database,
  tx: {
    uid: string;
    category: string;
    direction: 'CREDIT' | 'DEBIT' | 'HOLD' | 'REFUND';
    currency: 'COIN' | 'FIRE';
    amount: number;
    description: string;
    referenceId: string;
  }
): Promise<void> {
  const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO transactions (id, uid, category, direction, currency, amount, description, reference_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      tx.uid,
      tx.category,
      tx.direction,
      tx.currency,
      tx.amount,
      tx.description,
      tx.referenceId,
      createdAt
    )
    .run();
}

export async function recordAdminAuditD1(
  db: D1Database,
  adminId: string,
  action: string,
  targetUser: string,
  amountOrStatus: string,
  details: string
): Promise<void> {
  const auditId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO admin_audit_logs (audit_id, admin_id, timestamp, action, target_user, amount_or_status, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(auditId, adminId, timestamp, action, targetUser, amountOrStatus, details)
    .run();
}

export async function recordSuspiciousTapD1(
  db: D1Database,
  uid: string,
  reason: string,
  deltaMs: number,
  tapId: string
): Promise<void> {
  const eventId = `susp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO suspicious_taps (event_id, uid, username, reason, delta_ms, tap_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'FLAGGED', ?)`
    )
    .bind(eventId, uid, uid, reason, Math.max(0, Math.round(deltaMs)), tapId || '-', createdAt)
    .run();
}
