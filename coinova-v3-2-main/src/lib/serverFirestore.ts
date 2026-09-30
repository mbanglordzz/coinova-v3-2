import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// New launch realm: existing production player documents from the previous launch are
// intentionally isolated and cannot be loaded by the new launch. Admin/config docs remain shared.
export const SERVER_REALM_MARKER = 'coinova_launch_2026_09_30_v1';

export class FirestoreServerError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 503, code = 'FIRESTORE_ERROR') {
    super(message);
    this.name = 'FirestoreServerError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ServerFirebaseResolvedConfig {
  projectId: string;
  databaseId: string;
  apiKey: string;
  appId: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  hasServiceAccount: boolean;
  clientEmail?: string;
  privateKey?: string;
}

interface AppletConfigFile {
  projectId?: string;
  appId?: string;
  apiKey?: string;
  authDomain?: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

const FALLBACK_PROJECT_METADATA: AppletConfigFile = {
  projectId: 'gen-lang-client-0407129505',
  appId: '1:903601685733:web:30779f5261c25ad947c00c',
  apiKey: 'AIzaSyDE1gWMsqBbsXxLOnvf1ughVk7hSOFeYs0',
  authDomain: 'gen-lang-client-0407129505.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-6155f990-3034-42f5-aa1b-325341d85b3e',
  storageBucket: 'gen-lang-client-0407129505.firebasestorage.app',
  messagingSenderId: '903601685733',
};

let cachedFileConfig: AppletConfigFile | null = null;

function getModuleDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

function loadAppletConfigFromFile(): AppletConfigFile {
  if (cachedFileConfig) return cachedFileConfig;
  const moduleDir = getModuleDir();
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(process.cwd(), '..', 'firebase-applet-config.json'),
    path.resolve(moduleDir, '..', '..', 'firebase-applet-config.json'),
    path.resolve(moduleDir, '..', 'firebase-applet-config.json'),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as AppletConfigFile;
        if (parsed && typeof parsed === 'object' && parsed.projectId) {
          cachedFileConfig = { ...FALLBACK_PROJECT_METADATA, ...parsed };
          return cachedFileConfig;
        }
      }
    } catch {
      // continue to next candidate
    }
  }
  cachedFileConfig = FALLBACK_PROJECT_METADATA;
  return cachedFileConfig;
}

function parseServiceAccountFromEnv(): {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
} {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    try {
      const decoded = rawJson.startsWith('{')
        ? rawJson
        : Buffer.from(rawJson, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === 'object') {
        return {
          projectId: parsed.project_id || parsed.projectId,
          clientEmail: parsed.client_email || parsed.clientEmail,
          privateKey:
            typeof parsed.private_key === 'string'
              ? parsed.private_key.replace(/\\n/g, '\n')
              : undefined,
        };
      }
    } catch (err) {
      console.warn(
        '[COINOVA-FIRESTORE] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const rawPrivateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim();
  const privateKey = rawPrivateKey
    ? rawPrivateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n')
    : '';

  return {
    projectId: (process.env.FIREBASE_PROJECT_ID || '').trim() || undefined,
    clientEmail: clientEmail || undefined,
    privateKey: privateKey || undefined,
  };
}

export function resolveServerFirebaseConfig(): ServerFirebaseResolvedConfig {
  const fileCfg = loadAppletConfigFromFile();
  const sa = parseServiceAccountFromEnv();

  const projectId = (
    sa.projectId ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    fileCfg.projectId ||
    FALLBACK_PROJECT_METADATA.projectId!
  ).trim();

  const databaseId = (
    process.env.FIREBASE_DATABASE_ID ||
    process.env.FIRESTORE_DATABASE_ID ||
    process.env.VITE_FIREBASE_DATABASE_ID ||
    fileCfg.firestoreDatabaseId ||
    FALLBACK_PROJECT_METADATA.firestoreDatabaseId!
  ).trim();

  const apiKey = (
    process.env.FIREBASE_API_KEY ||
    process.env.VITE_FIREBASE_API_KEY ||
    fileCfg.apiKey ||
    ''
  ).trim();

  const appId = (
    process.env.FIREBASE_APP_ID ||
    process.env.VITE_FIREBASE_APP_ID ||
    fileCfg.appId ||
    FALLBACK_PROJECT_METADATA.appId!
  ).trim();

  const authDomain = (
    process.env.FIREBASE_AUTH_DOMAIN ||
    process.env.VITE_FIREBASE_AUTH_DOMAIN ||
    fileCfg.authDomain ||
    `${projectId}.firebaseapp.com`
  ).trim();

  const storageBucket = (
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    fileCfg.storageBucket ||
    `${projectId}.firebasestorage.app`
  ).trim();

  const messagingSenderId = (
    process.env.FIREBASE_MESSAGING_SENDER_ID ||
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    fileCfg.messagingSenderId ||
    FALLBACK_PROJECT_METADATA.messagingSenderId!
  ).trim();

  const hasServiceAccount = Boolean(
    sa.clientEmail &&
      sa.privateKey &&
      sa.privateKey.includes('BEGIN PRIVATE KEY')
  );

  return {
    projectId,
    databaseId,
    apiKey,
    appId,
    authDomain,
    storageBucket,
    messagingSenderId,
    hasServiceAccount,
    clientEmail: sa.clientEmail,
    privateKey: sa.privateKey,
  };
}

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;
let serviceAccountTokenDisabled = false;

async function getServiceAccountBearerToken(
  cfg: ServerFirebaseResolvedConfig
): Promise<string | null> {
  if (
    serviceAccountTokenDisabled ||
    !cfg.hasServiceAccount ||
    !cfg.clientEmail ||
    !cfg.privateKey
  ) {
    return null;
  }

  const nowMs = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAtMs - nowMs > 60_000) {
    return cachedAccessToken.token;
  }

  try {
    const iat = Math.floor(nowMs / 1000);
    const exp = iat + 3600;
    const headerB64 = Buffer.from(
      JSON.stringify({ alg: 'RS256', typ: 'JWT' })
    ).toString('base64url');
    const claimB64 = Buffer.from(
      JSON.stringify({
        iss: cfg.clientEmail,
        sub: cfg.clientEmail,
        aud: 'https://oauth2.googleapis.com/token',
        scope: 'https://www.googleapis.com/auth/datastore',
        iat,
        exp,
      })
    ).toString('base64url');

    const unsignedJwt = `${headerB64}.${claimB64}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedJwt);
    signer.end();
    const signatureB64 = signer.sign(cfg.privateKey, 'base64url');
    const assertion = `${unsignedJwt}.${signatureB64}`;

    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });

    if (!resp.ok) {
      console.warn(
        `[COINOVA-FIRESTORE] Service account OAuth token exchange returned HTTP ${resp.status}; falling back to Firebase API Key.`
      );
      serviceAccountTokenDisabled = true;
      return null;
    }

    const tokenData = (await resp.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!tokenData.access_token) {
      serviceAccountTokenDisabled = true;
      return null;
    }

    cachedAccessToken = {
      token: tokenData.access_token,
      expiresAtMs: nowMs + (Number(tokenData.expires_in) || 3600) * 1000,
    };
    return cachedAccessToken.token;
  } catch (err) {
    console.warn(
      '[COINOVA-FIRESTORE] Service account JWT sign error, falling back to Firebase API Key:',
      err instanceof Error ? err.message : String(err)
    );
    serviceAccountTokenDisabled = true;
    return null;
  }
}

function getDocumentsBaseUrl(cfg: ServerFirebaseResolvedConfig): string {
  if (!cfg.projectId || !cfg.databaseId) {
    throw new FirestoreServerError(
      'FIREBASE_PROJECT_ID atau FIREBASE_DATABASE_ID belum dikonfigurasi di server.',
      503,
      'MISSING_FIREBASE_CONFIG'
    );
  }
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    cfg.projectId
  )}/databases/${encodeURIComponent(cfg.databaseId)}/documents`;
}

async function buildFirestoreRequestUrlAndHeaders(
  endpointUrl: string
): Promise<{ url: string; headers: Record<string, string> }> {
  const cfg = resolveServerFirebaseConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const bearer = await getServiceAccountBearerToken(cfg);
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
    return { url: endpointUrl, headers };
  }

  if (!cfg.apiKey) {
    throw new FirestoreServerError(
      'FIREBASE_API_KEY (atau firebase-applet-config.json) belum dikonfigurasi di server.',
      503,
      'MISSING_FIREBASE_API_KEY'
    );
  }

  const sep = endpointUrl.includes('?') ? '&' : '?';
  return {
    url: `${endpointUrl}${sep}key=${encodeURIComponent(cfg.apiKey)}`,
    headers,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    throw new FirestoreServerError(
      `Gagal menghubungi Firestore API: ${
        err instanceof Error ? err.message : String(err)
      }`,
      503,
      'FIRESTORE_NETWORK_ERROR'
    );
  } finally {
    clearTimeout(timer);
  }
}

type FirestoreRestValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreRestValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreRestValue> } };

function toFirestoreValue(val: unknown): FirestoreRestValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      return { integerValue: '0' };
    }
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (val instanceof Date) {
    return { stringValue: val.toISOString() };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val
          .filter((item) => item !== undefined)
          .map((item) => toFirestoreValue(item)),
      },
    };
  }
  if (typeof val === 'object') {
    return {
      mapValue: {
        fields: toFirestoreFields(val as Record<string, unknown>),
      },
    };
  }
  return { stringValue: String(val) };
}

function toFirestoreFields(
  obj: Record<string, unknown>
): Record<string, FirestoreRestValue> {
  const fields: Record<string, FirestoreRestValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

function fromFirestoreValue(val: FirestoreRestValue | undefined): any {
  if (!val || typeof val !== 'object') return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    const arr = val.arrayValue?.values || [];
    return arr.map((item) => fromFirestoreValue(item));
  }
  if ('mapValue' in val) {
    return fromFirestoreFields(val.mapValue?.fields || {});
  }
  return null;
}

function fromFirestoreFields(
  fields: Record<string, FirestoreRestValue> | undefined
): Record<string, any> {
  const out: Record<string, any> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

export function sanitizeAccountKey(usernameLower: string): string {
  const clean = usernameLower
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_');
  return clean.slice(0, 100) || 'usr_default';
}

export function sanitizeFirestorePayload<T extends Record<string, any>>(
  obj: T
): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      out[k] = v.filter((item) => item !== undefined);
    } else if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
      out[k] = sanitizeFirestorePayload(v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

// ============================================================================
// AUTHORITATIVE IN-MEMORY + DISK MIRROR & HTTP 429 QUOTA CIRCUIT BREAKER
// Prevents FIRESTORE_HTTP_429 from breaking login, registration, or admin sync
// ============================================================================
const MIRROR_FILE_PATH = path.resolve(
  process.cwd(),
  'data',
  'firestore_mirror.json'
);
const mirrorStore = new Map<string, Map<string, Record<string, any>>>();
const collectionLastListMs = new Map<string, number>();
const docLastFetchMs = new Map<string, number>();
const docLastWriteSignature = new Map<string, { json: string; ts: number }>();
const queryLastFetchMs = new Map<string, number>();
const inFlightGetMap = new Map<string, Promise<any>>();
const inFlightListMap = new Map<string, Promise<any[]>>();
const inFlightQueryMap = new Map<string, Promise<any[]>>();
let firestoreQuotaCooldownUntilMs = 0;
let mirrorLoaded = false;
let mirrorWriteTimer: ReturnType<typeof setTimeout> | null = null;

function ensureMirrorLoaded(): void {
  if (mirrorLoaded) return;
  mirrorLoaded = true;
  const moduleDir = getModuleDir();
  const candidates = [
    MIRROR_FILE_PATH,
    path.resolve(process.cwd(), '..', 'data', 'firestore_mirror.json'),
    path.resolve(moduleDir, '..', '..', 'data', 'firestore_mirror.json'),
    path.resolve(moduleDir, '..', 'data', 'firestore_mirror.json'),
  ];
  for (const candidatePath of candidates) {
    try {
      if (fs.existsSync(candidatePath)) {
        const raw = fs.readFileSync(candidatePath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<
          string,
          Record<string, Record<string, any>>
        >;
        if (parsed && typeof parsed === 'object') {
          for (const [col, docsObj] of Object.entries(parsed)) {
            if (docsObj && typeof docsObj === 'object') {
              const colMap = new Map<string, Record<string, any>>();
              for (const [id, data] of Object.entries(docsObj)) {
                if (data && typeof data === 'object') {
                  colMap.set(id, data);
                }
              }
              mirrorStore.set(col, colMap);
            }
          }
          break;
        }
      }
    } catch {
      // ignore corrupt or missing mirror file
    }
  }
}

function scheduleMirrorPersist(): void {
  if (process.env.VERCEL) return;
  if (mirrorWriteTimer) return;
  mirrorWriteTimer = setTimeout(() => {
    mirrorWriteTimer = null;
    try {
      const dir = path.dirname(MIRROR_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serializable: Record<string, Record<string, Record<string, any>>> =
        {};
      mirrorStore.forEach((colMap, col) => {
        const obj: Record<string, Record<string, any>> = {};
        colMap.forEach((val, id) => {
          obj[id] = val;
        });
        serializable[col] = obj;
      });
      fs.writeFileSync(
        MIRROR_FILE_PATH,
        JSON.stringify(serializable),
        'utf-8'
      );
    } catch {
      // ignore disk write errors in read-only environments
    }
  }, 250);
}

function getMirrorCollection(
  collectionName: string
): Map<string, Record<string, any>> {
  ensureMirrorLoaded();
  let colMap = mirrorStore.get(collectionName);
  if (!colMap) {
    colMap = new Map<string, Record<string, any>>();
    mirrorStore.set(collectionName, colMap);
  }
  return colMap;
}

function getMirrorDoc<T = Record<string, any>>(
  collectionName: string,
  docId: string
): T | null {
  const colMap = getMirrorCollection(collectionName);
  const found = colMap.get(docId);
  return found ? (found as T) : null;
}

function setMirrorDoc(
  collectionName: string,
  docId: string,
  data: Record<string, any>
): void {
  const colMap = getMirrorCollection(collectionName);
  colMap.set(docId, data);
  docLastFetchMs.set(`${collectionName}/${docId}`, Date.now());
  scheduleMirrorPersist();
}

function deleteMirrorDoc(collectionName: string, docId: string): void {
  const colMap = getMirrorCollection(collectionName);
  if (colMap.delete(docId)) {
    docLastFetchMs.delete(`${collectionName}/${docId}`);
    scheduleMirrorPersist();
  }
}

function isFirestoreInQuotaCooldown(): boolean {
  return Date.now() < firestoreQuotaCooldownUntilMs;
}

function markFirestoreQuotaExceeded(statusCode: number): void {
  if (statusCode === 429 || statusCode === 503) {
    // Cool down remote Firestore calls for 60s to prevent rate-limit cascades
    firestoreQuotaCooldownUntilMs = Date.now() + 60_000;
  }
}

function resolveDocIdFromParsed(
  docName: string | undefined,
  parsed: Record<string, any>
): string {
  if (docName) {
    const tail = docName.split('/').pop();
    if (tail) return tail;
  }
  return String(
    parsed.docKey ||
      parsed.usernameLower ||
      parsed.uid ||
      parsed.withdrawalId ||
      parsed.orderId ||
      parsed.referralId ||
      parsed.submissionId ||
      parsed.broadcastId ||
      parsed.code ||
      parsed.claimId ||
      parsed.auditId ||
      parsed.eventId ||
      parsed.id ||
      ''
  ).trim();
}

const CRITICAL_STATE_COLLECTIONS = new Set([
  'server_user_accounts',
  'server_user_states',
  'server_withdrawals',
  'server_wallet_transactions',
  'server_audit_logs',
  'server_task_claims',
  'server_reward_code_claims',
]);

function isCriticalStateCollection(collectionName: string): boolean {
  return CRITICAL_STATE_COLLECTIONS.has(collectionName);
}

export async function getServerDoc<T = Record<string, any>>(
  collectionName: string,
  docId: string,
  forceRefresh = false,
  strict = false
): Promise<T | null> {
  ensureMirrorLoaded();
  const cacheKey = `${collectionName}/${docId}`;
  const cached = getMirrorDoc<T>(collectionName, docId);
  const lastFetch = docLastFetchMs.get(cacheKey) || 0;

  const criticalState = isCriticalStateCollection(collectionName);

  // Critical player/admin state must not be hidden behind the global quota cooldown.
  // Keep only a very short per-document dedupe window to prevent request storms.
  if (!forceRefresh && isFirestoreInQuotaCooldown() && !criticalState) {
    return cached;
  }

  if (!forceRefresh && lastFetch > 0 && Date.now() - lastFetch < (criticalState ? 2_000 : 5_000)) {
    return cached;
  }

  const existingInFlight = inFlightGetMap.get(cacheKey);
  if (existingInFlight) {
    return existingInFlight as Promise<T | null>;
  }

  const fetchPromise = (async (): Promise<T | null> => {
    try {
      const cfg = resolveServerFirebaseConfig();
      const baseUrl = getDocumentsBaseUrl(cfg);
      const rawUrl = `${baseUrl}/${encodeURIComponent(
        collectionName
      )}/${encodeURIComponent(docId)}`;
      const { url, headers } = await buildFirestoreRequestUrlAndHeaders(rawUrl);

      const res = await fetchWithTimeout(url, {
        method: 'GET',
        headers,
      });

      if (res.status === 404) {
        docLastFetchMs.set(cacheKey, Date.now());
        return cached ?? null;
      }

      if (!res.ok) {
        markFirestoreQuotaExceeded(res.status);
        if (strict) {
          throw new FirestoreServerError(
            `Firestore read gagal (${res.status}) untuk ${collectionName}/${docId}.`,
            res.status >= 500 ? 503 : res.status,
            `HTTP_${res.status}`
          );
        }
        return cached ?? null;
      }

      const docJson = (await res.json()) as {
        fields?: Record<string, FirestoreRestValue>;
      };
      if (!docJson || !docJson.fields) {
        docLastFetchMs.set(cacheKey, Date.now());
        if (strict) {
          throw new FirestoreServerError(
            `Firestore mengembalikan data state yang tidak valid untuk ${collectionName}/${docId}.`,
            503,
            'INVALID_FIRESTORE_DOCUMENT'
          );
        }
        return cached ?? null;
      }
      const parsed = fromFirestoreFields(docJson.fields) as Record<string, any>;
      if (
        collectionName !== 'server_config' &&
        collectionName !== 'server_promo_codes' &&
        collectionName !== 'server_broadcasts' &&
        parsed.serverRealm !== SERVER_REALM_MARKER
      ) {
        docLastFetchMs.set(cacheKey, Date.now());
        if (strict) {
          throw new FirestoreServerError(
            `Dokumen Firestore ${collectionName}/${docId} bukan bagian dari realm COINOVA aktif.`,
            503,
            'INVALID_SERVER_REALM'
          );
        }
        return cached ?? null;
      }
      setMirrorDoc(collectionName, docId, parsed);
      return parsed as T;
    } catch (error) {
      markFirestoreQuotaExceeded(503);
      if (strict) {
        if (error instanceof FirestoreServerError) throw error;
        throw new FirestoreServerError(
          `Firestore read error untuk ${collectionName}/${docId}.`,
          503,
          'FIRESTORE_READ_ERROR'
        );
      }
      return cached ?? null;
    } finally {
      inFlightGetMap.delete(cacheKey);
    }
  })();

  inFlightGetMap.set(cacheKey, fetchPromise);
  return fetchPromise;
}

export async function setServerDoc<T extends Record<string, any>>(
  collectionName: string,
  docId: string,
  data: T
): Promise<void> {
  const cleanData = sanitizeFirestorePayload({
    ...data,
    serverRealm: SERVER_REALM_MARKER,
  });

  // Always update local mirror immediately for instant consistency
  setMirrorDoc(collectionName, docId, cleanData);

  const criticalState = isCriticalStateCollection(collectionName);
  if (isFirestoreInQuotaCooldown() && !criticalState) {
    return;
  }

  const cacheKey = `${collectionName}/${docId}`;
  const serialized = JSON.stringify(cleanData);
  const prevSig = docLastWriteSignature.get(cacheKey);
  const nowMs = Date.now();
  // Prevent duplicate identical Firestore writes within 10s
  if (prevSig && prevSig.json === serialized && nowMs - prevSig.ts < 10_000) {
    return;
  }
  docLastWriteSignature.set(cacheKey, { json: serialized, ts: nowMs });

  try {
    const cfg = resolveServerFirebaseConfig();
    const baseUrl = getDocumentsBaseUrl(cfg);
    const rawUrl = `${baseUrl}/${encodeURIComponent(
      collectionName
    )}/${encodeURIComponent(docId)}`;
    const { url, headers } = await buildFirestoreRequestUrlAndHeaders(rawUrl);

    const res = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        fields: toFirestoreFields(cleanData),
      }),
    });

    if (!res.ok) {
      markFirestoreQuotaExceeded(res.status);
    }
  } catch {
    markFirestoreQuotaExceeded(503);
  }
}

export async function listServerDocs<T = Record<string, any>>(
  collectionName: string,
  maxItems = 250,
  forceRefresh = false
): Promise<T[]> {
  ensureMirrorLoaded();
  const colMap = getMirrorCollection(collectionName);
  const lastList = collectionLastListMs.get(collectionName) || 0;

  // Cache collection list (including empty collections) since setServerDoc/deleteServerDoc keep colMap synchronized
  if (
    !forceRefresh &&
    (isFirestoreInQuotaCooldown() ||
      (lastList > 0 && Date.now() - lastList < 10_000))
  ) {
    return Array.from(colMap.values()) as T[];
  }

  const existingInFlight = inFlightListMap.get(collectionName);
  if (existingInFlight) {
    return existingInFlight as Promise<T[]>;
  }

  const listPromise = (async (): Promise<T[]> => {
    try {
      const cfg = resolveServerFirebaseConfig();
      const baseUrl = getDocumentsBaseUrl(cfg);
      const rawUrl = `${baseUrl}:runQuery`;
      const { url, headers } = await buildFirestoreRequestUrlAndHeaders(rawUrl);

      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: collectionName }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'serverRealm' },
                op: 'EQUAL',
                value: { stringValue: SERVER_REALM_MARKER },
              },
            },
            limit: maxItems,
          },
        }),
      });

      if (!res.ok) {
        markFirestoreQuotaExceeded(res.status);
        return Array.from(colMap.values()) as T[];
      }

      const rows = (await res.json()) as Array<{
        document?: {
          name?: string;
          fields?: Record<string, FirestoreRestValue>;
        };
      }>;
      if (!Array.isArray(rows)) {
        collectionLastListMs.set(collectionName, Date.now());
        return Array.from(colMap.values()) as T[];
      }
      for (const row of rows) {
        if (row?.document?.fields) {
          const parsed = fromFirestoreFields(row.document.fields) as Record<
            string,
            any
          >;
          const docId = resolveDocIdFromParsed(row.document.name, parsed);
          if (docId) {
            const existingLocal = colMap.get(docId);
            const localUpdMs = existingLocal?.updatedAt
              ? new Date(existingLocal.updatedAt).getTime()
              : 0;
            const remoteUpdMs = parsed?.updatedAt
              ? new Date(parsed.updatedAt).getTime()
              : 0;
            if (!existingLocal || remoteUpdMs >= localUpdMs) {
              colMap.set(docId, parsed);
            }
            docLastFetchMs.set(`${collectionName}/${docId}`, Date.now());
          }
        }
      }
      collectionLastListMs.set(collectionName, Date.now());
      scheduleMirrorPersist();
      return Array.from(colMap.values()) as T[];
    } catch {
      markFirestoreQuotaExceeded(503);
      return Array.from(colMap.values()) as T[];
    } finally {
      inFlightListMap.delete(collectionName);
    }
  })();

  inFlightListMap.set(collectionName, listPromise);
  return listPromise;
}

export async function queryServerDocsByField<T = Record<string, any>>(
  collectionName: string,
  field: string,
  value: string | number | boolean,
  maxItems = 50,
  forceRefresh = false
): Promise<T[]> {
  ensureMirrorLoaded();
  const colMap = getMirrorCollection(collectionName);

  const filterMirrorByField = (): T[] => {
    const matches: T[] = [];
    for (const doc of colMap.values()) {
      if (doc && doc[field] === value) {
        matches.push(doc as T);
        if (matches.length >= maxItems) break;
      }
    }
    return matches;
  };

  const localMatches = filterMirrorByField();
  const queryKey = `${collectionName}:${field}=${String(value)}`;
  const lastQueryMs = queryLastFetchMs.get(queryKey) || 0;
  const lastListMs = collectionLastListMs.get(collectionName) || 0;

  if (
    !forceRefresh &&
    (localMatches.length > 0 ||
      isFirestoreInQuotaCooldown() ||
      (lastListMs > 0 && Date.now() - lastListMs < 120_000) ||
      (lastQueryMs > 0 && Date.now() - lastQueryMs < 60_000))
  ) {
    return localMatches;
  }

  const existingInFlight = inFlightQueryMap.get(queryKey);
  if (existingInFlight) {
    return existingInFlight as Promise<T[]>;
  }

  const queryPromise = (async (): Promise<T[]> => {
    try {
      const cfg = resolveServerFirebaseConfig();
      const baseUrl = getDocumentsBaseUrl(cfg);
      const rawUrl = `${baseUrl}:runQuery`;
      const { url, headers } = await buildFirestoreRequestUrlAndHeaders(rawUrl);

      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: collectionName }],
            where: {
              compositeFilter: {
                op: 'AND',
                filters: [
                  {
                    fieldFilter: {
                      field: { fieldPath: 'serverRealm' },
                      op: 'EQUAL',
                      value: { stringValue: SERVER_REALM_MARKER },
                    },
                  },
                  {
                    fieldFilter: {
                      field: { fieldPath: field },
                      op: 'EQUAL',
                      value: toFirestoreValue(value),
                    },
                  },
                ],
              },
            },
            limit: maxItems,
          },
        }),
      });

      if (!res.ok) {
        markFirestoreQuotaExceeded(res.status);
        return localMatches;
      }

      queryLastFetchMs.set(queryKey, Date.now());
      const rows = (await res.json()) as Array<{
        document?: {
          name?: string;
          fields?: Record<string, FirestoreRestValue>;
        };
      }>;
      if (!Array.isArray(rows)) return localMatches;
      const results: T[] = [];
      for (const row of rows) {
        if (row?.document?.fields) {
          const parsed = fromFirestoreFields(row.document.fields) as Record<
            string,
            any
          >;
          const docId = resolveDocIdFromParsed(row.document.name, parsed);
          if (docId) {
            colMap.set(docId, parsed);
            docLastFetchMs.set(`${collectionName}/${docId}`, Date.now());
          }
          results.push(parsed as T);
        }
      }
      if (results.length > 0) {
        scheduleMirrorPersist();
      }
      return results.length > 0 ? results : localMatches;
    } catch {
      markFirestoreQuotaExceeded(503);
      return localMatches;
    } finally {
      inFlightQueryMap.delete(queryKey);
    }
  })();

  inFlightQueryMap.set(queryKey, queryPromise);
  return queryPromise;
}

export async function deleteServerDoc(
  collectionName: string,
  docId: string
): Promise<void> {
  deleteMirrorDoc(collectionName, docId);
  docLastWriteSignature.delete(`${collectionName}/${docId}`);

  if (isFirestoreInQuotaCooldown()) {
    return;
  }

  try {
    const cfg = resolveServerFirebaseConfig();
    const baseUrl = getDocumentsBaseUrl(cfg);
    const rawUrl = `${baseUrl}/${encodeURIComponent(
      collectionName
    )}/${encodeURIComponent(docId)}`;
    const { url, headers } = await buildFirestoreRequestUrlAndHeaders(rawUrl);

    const res = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok && res.status !== 404) {
      markFirestoreQuotaExceeded(res.status);
    }
  } catch {
    markFirestoreQuotaExceeded(503);
  }
}
