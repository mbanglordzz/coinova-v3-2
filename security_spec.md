# COINOVA Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **Identity & Email Verification Invariant**: Every write operation requires an authenticated user (`request.auth != null`) with `request.auth.token.email_verified == true`.
2. **Split PII Isolation Invariant**: Personal Identifiable Information (`email`, `fullName`, `phone`, `ewalletNumber`, `ewalletAccountName`, `pinHash`) is strictly isolated in `/profiles/{userId}`. Only the owner (`request.auth.uid == userId`) or a verified Admin can read or write `/profiles/{userId}`.
3. **Self-Role Escalation Prevention**: When a user creates `/users/{userId}`, `role` MUST be `'player'` (unless the user is the bootstrapped verified admin `lordzmbang08@gmail.com` or exists in `/admins/{uid}`), and `status` MUST be `'active'`. Users can never update their own `role` or `status`.
4. **Wallet Integrity & Non-Negative Balances**: `/wallets/{userId}` requires `coinBalance >= 0`, `fireBalance >= 0`, `idrBalance >= 0`, `lockedIdrBalance >= 0`, `energy >= 0`, and `maxEnergy >= 100`.
5. **Immutable Ledger Invariant**: `/wallet_transactions/{txId}`, `/task_claims/{claimId}`, `/reward_code_claims/{claimId}`, and `/admin_audit_logs/{logId}` are append-only (no client updates or deletes allowed).
6. **Terminal State Locking Invariant**:
   - `/withdrawals/{withdrawalId}`: Once `existing().status` reaches `'PAID'` or `'REJECTED'`, non-admin updates are permanently locked, and only verified admins may transition withdrawal status.
   - `/creator_submissions/{submissionId}`: Once `existing().status` reaches `'APPROVED'` or `'REJECTED'`, updates are locked except for admin corrections.
7. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps on created/updated documents must equal `request.time`.
8. **Secure List Queries**: Every `allow list` rule restricts access via `resource.data` ownership (`resource.data.uid == request.auth.uid` or `isAdmin()`) except public configuration catalogs (`tasks`, `levels`, `game_settings`, `reward_codes`).

## 2. The "Dirty Dozen" Payloads

1. **Unverified Email Spoof**: Authenticated user with `email: "lordzmbang08@gmail.com"` and `email_verified: false` attempting to write `/game_settings/global`.
2. **Self-Admin Escalation on User Create**: Creating `/users/attacker_1` with `role: "admin"`.
3. **Shadow Field Injection on Wallet Update**: Updating `/wallets/user_1` with an extra field `"isVIP": true`.
4. **Cross-User PII Read**: Authenticated `user_2` attempting `get` on `/profiles/user_1`.
5. **Negative Wallet Balance Poisoning**: Updating `/wallets/user_1` with `idrBalance: -500000`.
6. **Forged Timestamp Attack**: Creating `/withdrawals/wd_1` with `createdAt` set to a past client timestamp instead of `request.time`.
7. **Withdrawal Self-Approval**: Owner `user_1` attempting to update `/withdrawals/wd_1` `status` from `'PENDING'` to `'PAID'`.
8. **Terminal Withdrawal Mutation**: Attempting to update a withdrawal already in `'PAID'` state.
9. **ID Poisoning Attack**: Creating a document with a 300-character or special-character document ID.
10. **Ledger Tampering**: Attempting to `update` or `delete` `/wallet_transactions/tx_1`.
11. **Unauthorized List Scraping**: Non-owner attempting un-filtered `list` on `/withdrawals` or `/wallet_transactions`.
12. **Orphaned Claim Creation**: User `user_1` attempting to create `/task_claims/claim_1` where `uid` is `"user_2"` or `/users/user_1` does not exist.
