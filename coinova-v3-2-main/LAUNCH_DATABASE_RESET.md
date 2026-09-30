# COINOVA V3.2 — Launch Database Reset

This build starts COINOVA in a **new server realm**:

`coinova_launch_2026_09_30_v1`

All player/account/state/transaction documents from the previous launch use the old realm and are therefore **not loaded, not credited, and not accessible through the normal COINOVA app flow**.

Preserved intentionally:
- Admin authentication/configuration
- QRIS configuration
- App/economic configuration
- Admin-controlled global settings

Reset locally bundled player data:
- `data/server_ledger.json` contains no previous player accounts, balances, withdrawals, referrals, transactions, challenge records, or suspicious-tap history.

## Important
This is a **logical production reset/isolation**, not a physical deletion of the old Firestore documents. The old documents remain in Firestore for safety/audit purposes but belong to the previous realm and are ignored by this build.

If a physical deletion is required later, it should be performed from the Firebase/Firestore admin environment after verifying backups.
