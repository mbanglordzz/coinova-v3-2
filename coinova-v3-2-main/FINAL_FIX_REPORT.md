# COINOVA V3.2 — FINAL CORE ENERGY + REFRESH PERSISTENCE FIX

Implemented from the latest `COINOVA_V3.2_MASTER_BUGFIX.zip` source.

## Fixed
- Removed automatic Core Energy regeneration from the active Vercel/Express backend.
- Removed the paid Coin-based energy refill endpoint and frontend action.
- Core Energy can only decrease through taps and be restored through the existing approved level-up flow.
- When Core Energy reaches 0, tap is rejected with an upgrade-level message.
- Existing level upgrade flow still restores Energy to the new level's configured maximum after payment is verified.
- Mirrored Cloudflare Worker/D1 gameplay path updated to the same non-regeneration rule.
- Refresh/session restore now waits for authoritative server state instead of rendering the clean default state as real account data.
- Critical Firestore state reads are strict: database read errors no longer become a fake `0 Coin / full Energy` state.
- Missing authoritative state for an existing account no longer silently creates a fresh wallet during a read/refresh.
- Tap mutations no longer fall back to stale in-memory wallet state when the authoritative Firestore state cannot be read.
- Client game-state requests no longer send the client dragon level as an authoritative state hint.
- Legacy energy-regeneration configuration is retained only for schema/backward compatibility and is set to 0 / has no gameplay effect.

## Verification performed in this environment
- TypeScript/TSX syntax transpilation check passed for every changed TypeScript file.
- Static audit found no active `refill-energy`, `refillEnergyFirestore`, Instant Boost, or automatic regeneration logic in the active source paths.
- No UI redesign or unrelated economy/navigation feature was intentionally changed.

## Important
A full production browser/build test could not be executed in this environment because the project dependencies are not installed and network package installation is unavailable here. The source was syntax-checked and the relevant server/client logic was audited directly.

## Launch database reset (2026-09-30)
- Changed the active Firestore `SERVER_REALM_MARKER` to `coinova_launch_2026_09_30_v1`.
- Previous-launch player documents remain physically stored but are isolated by the old realm and cannot be loaded by this build.
- Bundled `data/server_ledger.json` was scrubbed of previous player accounts, balances, withdrawals, referrals, transactions, challenge records, and suspicious-tap history.
- Admin/config/QRIS remain preserved.
