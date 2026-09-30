-- ============================================================================
-- COINOVA CLOUDFLARE D1 DATABASE SCHEMA (MIGRATION 0001)
-- ============================================================================

-- 1. Users / Accounts
CREATE TABLE IF NOT EXISTS users (
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
);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(username_lower);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- 2. Sessions (User & Admin Sessions)
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER',
  credential_fingerprint TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(uid);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- 3. User States / Wallet Balances
CREATE TABLE IF NOT EXISTS user_states (
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
);

-- 4. Transactions / Ledger
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  category TEXT NOT NULL,
  direction TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_uid ON transactions(uid);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

-- 5. Referrals
CREATE TABLE IF NOT EXISTS referrals (
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
);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter_uid ON referrals(inviter_uid);
CREATE INDEX IF NOT EXISTS idx_referrals_invitee_uid ON referrals(invitee_uid);

-- 6. Withdrawals
CREATE TABLE IF NOT EXISTS withdrawals (
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
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_uid ON withdrawals(uid);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- 7. Admin Audit Logs
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  audit_id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user TEXT NOT NULL,
  amount_or_status TEXT NOT NULL,
  details TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_timestamp ON admin_audit_logs(timestamp DESC);

-- 8. Bug Reports
CREATE TABLE IF NOT EXISTS bug_reports (
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
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_uid ON bug_reports(uid);

-- 9. Suspicious Taps (Fraud Review)
CREATE TABLE IF NOT EXISTS suspicious_taps (
  event_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  delta_ms INTEGER NOT NULL DEFAULT 0,
  tap_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'FLAGGED',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suspicious_taps_created_at ON suspicious_taps(created_at DESC);

-- 10. Economic Configuration
CREATE TABLE IF NOT EXISTS economic_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  coins_per_tap INTEGER NOT NULL DEFAULT 10,
  energy_cost_per_tap INTEGER NOT NULL DEFAULT 1,
  energy_regen_per_minute INTEGER NOT NULL DEFAULT 15,
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
);

-- 11. Diamond Math Challenges (Anti-Spam / Single-Use Validation)
CREATE TABLE IF NOT EXISTS diamond_challenges (
  challenge_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  question TEXT NOT NULL,
  expected_answer INTEGER NOT NULL,
  reward_fire INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diamond_challenges_uid ON diamond_challenges(uid);

-- 12. Task Claims & Progressive Invite Milestones
CREATE TABLE IF NOT EXISTS task_claims (
  claim_key TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  task_id TEXT NOT NULL,
  target_milestone INTEGER NOT NULL DEFAULT 0,
  coin_reward INTEGER NOT NULL DEFAULT 0,
  fire_reward INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_claims_uid ON task_claims(uid);

-- 13. Processed Tap Nonces (Idempotency / Anti-Replay)
CREATE TABLE IF NOT EXISTS processed_tap_ids (
  tap_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 14. Level Upgrade Orders
CREATE TABLE IF NOT EXISTS upgrade_orders (
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
);
CREATE INDEX IF NOT EXISTS idx_upgrade_orders_uid ON upgrade_orders(uid);

-- Seed Default Economic Config
INSERT OR IGNORE INTO economic_config (
  id, coins_per_tap, energy_cost_per_tap, energy_regen_per_minute,
  coin_to_idr_rate, coins_per_fire_convert, max_daily_fire_convert,
  min_withdraw_idr, referral_active_fire_reward, referral_topup_coin_reward,
  referral_topup_fire_reward, referral_upgrade_coin_reward, referral_upgrade_fire_reward,
  updated_at
) VALUES (
  1, 10, 1, 15, 1, 1000, 10, 500000, 2, 25000, 8, 25000, 10, '2026-09-28T00:00:00.000Z'
);

-- Seed Default Pro Account (Keylaa.)
INSERT OR IGNORE INTO users (
  uid, username, username_lower, email, password_hash, referral_code,
  dragon_level, role, status, created_at, updated_at
) VALUES (
  'user_keylaa_pro', 'Keylaa.', 'keylaa.', 'keylaa@coinova.id',
  'af8be87eb2a9bd0e8b1daff6f1f34770a8f4076fad7916bee6514f8c9aaed104',
  'F11B4A', 4, 'player', 'active', '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z'
);

INSERT OR IGNORE INTO user_states (
  uid, username, dragon_level, coin_balance, fire_balance, locked_idr_balance,
  energy, max_energy, last_energy_regen_ms, cycle_progress, daily_claims_used,
  last_claim_date, last_convert_date, daily_converted_fire, total_taps,
  claimed_invite_targets, last_tap_ms, recent_tap_intervals, updated_at
) VALUES (
  'user_keylaa_pro', 'Keylaa.', 4, 0, 0, 0,
  5000, 5000, 0, 0, 0,
  '', '', 0, 0,
  '[]', 0, '[]', '2026-09-28T00:00:00.000Z'
);

