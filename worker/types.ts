export interface D1Result<T = Record<string, any>> {
  results: T[];
  success: boolean;
  meta?: Record<string, any>;
}

export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = Record<string, any>>(colName?: string): Promise<T | null>;
  run<T = Record<string, any>>(): Promise<D1Result<T>>;
  all<T = Record<string, any>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, any>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

export interface CloudflareEnv {
  DB: D1Database;
  GEMINI_API_KEY?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_PASSWORD_SALT?: string;
  ADMIN_SESSION_SECRET?: string;
  CORS_ORIGIN?: string;
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

export interface ServerUserState {
  uid: string;
  username: string;
  dragonLevel: number;
  coinBalance: number;
  fireBalance: number;
  lockedIdrBalance: number;
  energy: number;
  maxEnergy: number;
  lastEnergyRegenMs: number;
  cycleProgress: number;
  dailyClaimsUsed: number;
  lastClaimDate: string;
  lastConvertDate: string;
  dailyConvertedFire: number;
  totalTaps: number;
  claimedInviteTargets: number[];
  lastTapMs: number;
  recentTapIntervals: number[];
  updatedAt: string;
}

export const DEFAULT_ECONOMIC_CONFIG: ServerEconomicConfig = {
  coinsPerTap: 10,
  energyCostPerTap: 1,
  energyRegenPerMinute: 0,
  coinToIdrRate: 1,
  coinsPerFireConvert: 1000,
  maxDailyFireConvert: 10,
  minWithdrawIdr: 500000,
  referralActiveFireReward: 2,
  referralTopupCoinReward: 25000,
  referralTopupFireReward: 8,
  referralUpgradeCoinReward: 25000,
  referralUpgradeFireReward: 10,
  updatedAt: '2026-09-28T00:00:00.000Z',
};

export const MIN_LEVEL_FOR_CONVERSION = 4;

export const LEVEL_TAP_MULTIPLIERS: Record<number, number> = {
  1: 1,
  2: 2,
  3: 5,
  4: 30,
  5: 50,
};

export const LEVEL_MAX_ENERGY: Record<number, number> = {
  1: 200,
  2: 400,
  3: 800,
  4: 5000,
  5: 10000,
};

export const LEVEL_DAILY_CLAIM_LIMITS: Record<number, number> = {
  1: 200,
  2: 400,
  3: 800,
  4: 5000,
  5: 10000,
};

export const OFFICIAL_LEVEL_PRICES: Record<number, number> = {
  2: 25000,
  3: 50000,
  4: 100000,
  5: 200000,
};

export const VALID_WITHDRAW_COIN_TIERS = [500000, 1000000, 2000000, 5000000];

export const USER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
export const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

export function getRewardPerTapForLevel(level: number, coinsPerTap = 10): number {
  const cleanLevel = Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));
  const baseCoins = Math.max(1, Math.floor(coinsPerTap || 10));
  const multiplier = LEVEL_TAP_MULTIPLIERS[cleanLevel] || 1;
  return baseCoins * multiplier;
}

export function getServerTodayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeIndoPhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+62')) {
    return '0' + digits.slice(3);
  }
  if (digits.startsWith('62')) {
    return '0' + digits.slice(2);
  }
  return digits.replace(/\D/g, '');
}

export function isValidEWalletNumber(phone: string): boolean {
  return /^08\d{8,13}$/.test(phone);
}

// ============================================================================
// WEB CRYPTO HELPERS (100% NATIVE CLOUDFLARE WORKERS EDGE RUNTIME)
// ============================================================================
export function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomInt(maxExclusive: number, minInclusive = 0): number {
  const range = Math.max(1, maxExclusive - minInclusive);
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return minInclusive + (arr[0] % range);
}

export async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashUserPassword(password: string): Promise<string> {
  return sha256Hex(`coinova_usr_${password}`);
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

const PERSISTED_SERVER_ADMIN_AUTH = {
  username: 'boyy',
  passwordHash:
    'a9318c1ce69fb5c8cdb8055ce9717a63a11feb1c45b08d39044fbf23bf3238e0',
  trimmedPasswordHash:
    'a9318c1ce69fb5c8cdb8055ce9717a63a11feb1c45b08d39044fbf23bf3238e0',
  sessionSecret: 'COINOVA_SESSION_2026_9fK7xP2mQ8vL4zR6nT1wY5',
};

export async function getAdminCredentialsFromEnv(env: CloudflareEnv): Promise<{
  configured: boolean;
  username: string;
  passwordHash: string;
  trimmedPasswordHash: string;
  sessionSecret: string;
}> {
  const username = String(env.ADMIN_USERNAME || '').trim();
  const password = String(env.ADMIN_PASSWORD || env.ADMIN_PASSWORD_SALT || '');
  const trimmedPassword = password.trim();
  const sessionSecret =
    String(env.ADMIN_SESSION_SECRET || '').trim() ||
    PERSISTED_SERVER_ADMIN_AUTH.sessionSecret;

  const configured = Boolean(username.length > 0 && trimmedPassword.length > 0);
  if (!configured) {
    return {
      configured: true,
      username: PERSISTED_SERVER_ADMIN_AUTH.username,
      passwordHash: PERSISTED_SERVER_ADMIN_AUTH.passwordHash,
      trimmedPasswordHash: PERSISTED_SERVER_ADMIN_AUTH.trimmedPasswordHash,
      sessionSecret,
    };
  }
  const passwordHash = await sha256Hex(`coinova_adm_${username.toLowerCase()}:${password}`);
  const trimmedPasswordHash = await sha256Hex(
    `coinova_adm_${username.toLowerCase()}:${trimmedPassword}`
  );

  return {
    configured,
    username,
    passwordHash,
    trimmedPasswordHash,
    sessionSecret,
  };
}

export async function signAdminSessionToken(
  username: string,
  issuedAt: number,
  sessionSecret: string
): Promise<string> {
  const nonce = randomHex(16);
  const payload = `${username}:${issuedAt}:${nonce}`;
  const sig = await hmacSha256Hex(sessionSecret, payload);
  return toBase64Url(`${payload}:${sig}`);
}

export async function verifyAdminTokenSignature(
  token: string,
  sessionSecret: string
): Promise<boolean> {
  try {
    const decoded = fromBase64Url(token);
    const parts = decoded.split(':');
    if (parts.length !== 4) return false;
    const [username, issuedAt, nonce, sig] = parts;
    const payload = `${username}:${issuedAt}:${nonce}`;
    const expectedSig = await hmacSha256Hex(sessionSecret, payload);
    return sig === expectedSig;
  } catch {
    return false;
  }
}
