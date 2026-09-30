# Panduan Deploy COINOVA ke Cloudflare Pages + Workers + D1

Proyek **COINOVA** kini telah siap 100% untuk di-deploy ke ekosistem **Cloudflare** tanpa menghilangkan fungsionalitas atau tampilan yang sudah berjalan:
- **Frontend**: React 19 + Vite + Tailwind CSS (`dist/`) -> **Cloudflare Pages**
- **Backend API**: Hono Edge Runtime (`worker/index.ts` & `functions/api/[[route]].ts`) -> **Cloudflare Pages Functions** atau **Cloudflare Workers**
- **Database**: **Cloudflare D1 (SQLite Edge Database)** (`migrations/0001_coinova_d1_schema.sql`)

---

## Struktur File Baru yang Ditambahkan

| File / Folder | Fungsi |
| :--- | :--- |
| `migrations/0001_coinova_d1_schema.sql` | Skema lengkap 14 tabel Cloudflare D1 (`users`, `sessions`, `user_states`, `transactions`, `referrals`, `withdrawals`, `admin_audit_logs`, `bug_reports`, `suspicious_taps`, `economic_config`, `diamond_challenges`, `task_claims`, `processed_tap_ids`, `upgrade_orders`) beserta seed default. |
| `worker/types.ts` | Tipe binding `CloudflareEnv` (`DB: D1Database`), konstanta ekonomi server, serta helper **Web Crypto API** (`crypto.subtle` SHA-256 & HMAC-SHA256) murni tanpa ketergantungan Node.js. |
| `worker/db.ts` | Layer akses database Cloudflare D1, auto-init schema (`ensureD1Schema`), regenerasi Core Energy pasif berbasis waktu server, serta pencatatan mutasi & audit. |
| `worker/routes/authAndAdmin.ts` | Endpoint `/api/auth/*` (Register, Login, Session, Logout) dan `/api/admin/*` (Login Admin, Session, Economic Config, Fraud Review, Overview, Adjust Balance, Referral & Upgrade Review). |
| `worker/routes/gameAndUgc.ts` | Endpoint `/api/game/*` (Tap Coin, Math Challenge Diamond, Cyber Vault, Task Claim, Konversi Koin->Diamond Lv.4/5, Withdraw E-Wallet, Upgrade Order, Bug Report) dan `/api/ugc/*` (AI UGC Affiliate + Video Reference). |
| `worker/index.ts` | Entry point utama aplikasi Hono untuk Cloudflare Worker. |
| `functions/api/[[route]].ts` | Adapter otomatis **Cloudflare Pages Functions** agar seluruh endpoint `/api/*` langsung berjalan satu domain dengan frontend Cloudflare Pages. |
| `wrangler.toml` | Konfigurasi Cloudflare Pages + D1 binding (`DB`). |
| `wrangler.worker.toml` | Konfigurasi opsional jika ingin men-deploy backend sebagai Cloudflare Worker terpisah (`coinova-api`). |
| `src/config/api.ts` | Helper URL API frontend (`VITE_API_BASE_URL`). |

---

## Langkah 1: Persiapan & Login Wrangler CLI

Pastikan Anda sudah menginstal dependencies proyek:
```bash
npm install
```

Login ke akun Cloudflare Anda:
```bash
npx wrangler login
```

---

## Langkah 2: Buat Database Cloudflare D1 (`coinova-db`)

Jalankan perintah berikut untuk membuat database D1 baru di akun Cloudflare Anda:
```bash
npm run cf:d1:create
# atau: npx wrangler d1 create coinova-db
```

Terminal akan menampilkan output seperti berikut:
```toml
[[d1_databases]]
binding = "DB"
database_name = "coinova-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Salin nilai `database_id` tersebut lalu tempelkan ke dalam file **`wrangler.toml`** (dan **`wrangler.worker.toml`** jika menggunakan Worker terpisah).

---

## Langkah 3: Jalankan Migrasi Tabel D1

### A. Migrasi Database D1 Lokal (Untuk Testing di Komputer)
```bash
npm run cf:d1:migrate:local
```

### B. Migrasi Database D1 Remote (Production Cloudflare)
```bash
npm run cf:d1:migrate:remote
```

> **Catatan:** Backend Worker (`worker/db.ts`) juga dilengkapi fitur *Self-Healing Schema* (`ensureD1Schema`) yang otomatis menjalankan `CREATE TABLE IF NOT EXISTS` pada saat *cold start* jika tabel belum ada.

---

## Langkah 4: Konfigurasi Secrets / Environment Variables di Cloudflare

Setel variabel rahasia (Admin & Gemini API Key) agar sistem Login Admin dan AI UGC Affiliate berjalan dengan aman di Cloudflare:

### Jika Menggunakan Cloudflare Pages (Rekomendasi — Satu Domain Terpadu):
Buka **Cloudflare Dashboard** -> **Workers & Pages** -> Pilih project **coinova-app** -> **Settings** -> **Environment Variables**, lalu tambahkan:
- `ADMIN_USERNAME` = username admin Anda (contoh: `admin`)
- `ADMIN_PASSWORD` = password admin Anda
- `ADMIN_SESSION_SECRET` = string acak panjang untuk HMAC token admin
- `GEMINI_API_KEY` = API Key Google Gemini Anda

Dan pada bagian **Settings** -> **Functions** -> **D1 database bindings**, pastikan terdapat binding:
- Variable name: `DB` -> Database: `coinova-db`

### Jika Menggunakan CLI Wrangler (Untuk Standalone Worker):
```bash
npx wrangler secret put ADMIN_USERNAME -c wrangler.worker.toml
npx wrangler secret put ADMIN_PASSWORD -c wrangler.worker.toml
npx wrangler secret put ADMIN_SESSION_SECRET -c wrangler.worker.toml
npx wrangler secret put GEMINI_API_KEY -c wrangler.worker.toml
```

---

## Langkah 5: Build & Deploy ke Cloudflare

### Opsi A (Rekomendasi): Deploy Full-Stack ke Cloudflare Pages + Pages Functions + D1
Dengan opsi ini, Frontend (`dist/`) dan Backend (`/api/*` melalui `functions/api/[[route]].ts`) berjalan dalam **1 domain Cloudflare Pages** yang sama, sehingga Anda **tidak perlu** mengisi `VITE_API_BASE_URL` (cukup biarkan kosong `""`).

1. Test secara lokal menggunakan emulator Cloudflare Pages + D1:
   ```bash
   npm run cf:dev:pages
   ```
2. Deploy ke Production Cloudflare Pages:
   ```bash
   npm run cf:deploy:pages
   ```

### Opsi B: Deploy Terpisah (Cloudflare Worker untuk API + Cloudflare Pages untuk Frontend)
Jika Anda ingin memisahkan domain Worker API dan domain Pages Frontend:

1. Deploy Cloudflare Worker API terlebih dahulu:
   ```bash
   npm run cf:deploy:worker
   ```
   Catat URL Worker Anda (misal: `https://coinova-api.namasubdomain.workers.dev`).
2. Buat file `.env.production` (atau isi di Environment Variables Cloudflare Pages):
   ```env
   VITE_API_BASE_URL="https://coinova-api.namasubdomain.workers.dev"
   ```
3. Build dan deploy frontend ke Cloudflare Pages:
   ```bash
   npm run build
   npx wrangler pages deploy dist --project-name coinova-app
   ```

---

## Langkah 6: Verifikasi Setelah Deploy

1. Buka `/api/health` pada domain Anda untuk memastikan Worker dan D1 aktif:
   ```json
   {
     "ok": true,
     "service": "coinova-cloudflare-worker-d1",
     "runtime": "cloudflare-workers",
     "database": "cloudflare-d1"
   }
   ```
2. Uji fitur **Register & Login User**, **Tap Koin & Tantangan Matematika Diamond**, **Cyber Vault**, **Upgrade Level**, **Withdraw E-Wallet**, **AI UGC Affiliate (Product + Character + Video Reference)**, serta **Portal Admin**.
