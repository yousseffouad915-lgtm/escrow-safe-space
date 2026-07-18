
# TrustLaunch — Phase 1: Backend (schema, escrow, KYC, admin, i18n, AI support)

Backend-only phase per your direction. Dashboards and full UI come in Phase 2. Everything below runs on **Lovable Cloud** (managed Supabase — DB, Auth, Storage, Realtime). No external keys needed; I'll ask for your Super-Admin user ID after you sign up once in the app.

## Locked-in decisions
- Payments: simulated wallet now, Stripe-swappable later (via a single `escrow.server.ts` abstraction).
- KYC: in-app ID + selfie upload → status auto-set to `pending`; sensitive actions gated on `approved`.
- Disputes: **3-day** auto-release window; client can approve early or dispute; disputes go to Super-Admin.
- Notifications: in-app only via Supabase Realtime.
- Fees: **flat 5% platform fee** on every `approved_released` transaction.
- Admin: **single hardcoded Super-Admin UUID** — no admin role ever assignable at runtime.
- Localization: global EN/AR provider with RTL support.
- AI Support: Lovable AI chatbot with scam/legitimacy escalation to `joo15572ny@gmail.com` (email hidden otherwise).

---

## 1. Lovable Cloud + Auth
Enable Cloud. Email/password + Google sign-in. Every new user auto-creates a `profiles` row via trigger.

## 2. Roles — hardcoded Super-Admin
Enum `app_role`: `client | freelancer | admin`. Table `user_roles(user_id, role)` holds only `client`/`freelancer` self-assignments (or dual). **Admin is never inserted.** Instead:

```sql
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when _role = 'admin' then _user_id = '<YOUR_UUID_HERE>'::uuid
    else exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
  end
$$;
```

A trigger on `user_roles` rejects any insert/update with `role = 'admin'`. Result: admin cannot be granted through the API, only by editing this function via migration.

## 3. Storage — KYC bucket
Private bucket `kyc-documents`. Path convention: `{user_id}/id.<ext>` and `{user_id}/selfie.<ext>`. RLS on `storage.objects`:
- User can `insert`/`select` only under their own `{auth.uid()}/…` prefix.
- Super-Admin can `select` everything.
- No public read, ever.

`kyc_submissions(id, user_id, id_document_path, selfie_path, status, submitted_at, reviewed_at, reviewed_by, notes)` with status `pending | approved | rejected`. On upload, the `submitKyc` server fn inserts a row with `status='pending'` atomically. Admin `approveKyc` / `rejectKyc` server fns update status and fan out a `kyc_status_changed` notification.

## 4. Core schema

```text
profiles(id=auth.uid, display_name, avatar_url, locale, bio, created_at)
user_roles(user_id, role)              -- client|freelancer only

wallets(user_id PK, available_cents, locked_cents)
wallet_ledger(id, user_id, delta_cents, kind, related_contract_id, memo, created_at)
  kind: deposit | escrow_lock | escrow_release | escrow_refund | platform_fee

platform_wallet(id=1 singleton, collected_fees_cents)  -- fee sink

projects(id, client_id, title, description, budget_cents, deadline, status, created_at)
  status: open | awarded | closed | cancelled

proposals(id, project_id, freelancer_id, cover_letter, bid_cents, estimated_days, status, created_at)
  status: submitted | accepted | rejected | withdrawn

contracts(id, project_id, client_id, freelancer_id, amount_cents,
          fee_bps DEFAULT 500,           -- 5% locked at contract creation
          status, auto_release_at, created_at, submitted_at,
          approved_at, disputed_at, resolved_at)
  status: pending_funding | funded_locked | work_submitted |
          approved_released | disputed | refunded | cancelled

escrow_transactions(id, contract_id, state, amount_cents, fee_cents,
                    actor_id, reason, created_at)
  state: Pending | Locked | Released | Refunded | Disputed

notifications(id, user_id, type, title, body, related_id, read_at, created_at)
  type: new_proposal | escrow_deposit_confirmed | revision_requested |
        payment_released | contract_funded | dispute_opened |
        dispute_resolved | kyc_status_changed
```

All tables get explicit `GRANT`s per Lovable rules; RLS enabled on every one.

## 5. Escrow state machine + 5% fee

```text
pending_funding ──client funds──▶ funded_locked
funded_locked   ──freelancer submits──▶ work_submitted (auto_release_at = now()+3d)
work_submitted  ──client approves────▶ approved_released    ← fee applied here
work_submitted  ──auto_release_at hit▶ approved_released    ← fee applied here
work_submitted  ──client disputes────▶ disputed
disputed        ──admin resolves─────▶ approved_released | refunded
funded_locked   ──both cancel────────▶ refunded             (no fee)
```

**Release accounting** (SECURITY DEFINER RPC, single transaction):
```
fee     = floor(amount * 0.05)
payout  = amount - fee
client.locked          -= amount
freelancer.available   += payout
platform.collected_fees+= fee
+ ledger rows: escrow_release (freelancer), platform_fee (platform)
+ escrow_transactions row with amount, fee
+ notifications to both parties
```
Refund path returns 100% (no fee) to client.

## 6. Server functions (TanStack `createServerFn`, all `requireSupabaseAuth`)
`submitKyc`, `createProject`, `listOpenProjects`, `getProject`, `submitProposal`, `acceptProposal`, `fundContract`, `submitWork`, `approveWork`, `requestRevision`, `openDispute`, `adminResolveDispute`, `adminReviewKyc`, `listNotifications`, `markNotificationRead`, `getMyWallet`. All money movement flows through one `escrow.server.ts` helper (Stripe swap point later). KYC-approved check gates: `submitProposal`, `acceptProposal`, `fundContract`.

## 7. Auto-release cron
`/api/public/cron/auto-release` server route, HMAC-verified via `CRON_SECRET` (generated automatically). Scheduled via `pg_cron` + `pg_net` every 15 min; picks up `work_submitted` where `auto_release_at <= now()` and calls the release RPC.

## 8. Realtime notifications
Client subscribes to `notifications` filtered by `user_id`. Every state-changing server fn inserts notification rows in the same transaction.

## 9. Global i18n (EN/AR + RTL)
Add `react-i18next` + a `LanguageProvider` wrapping the router. Locale persisted on `profiles.locale`, mirrored in `localStorage`. Setting Arabic flips `<html dir="rtl" lang="ar">`. All server-facing error strings return stable **codes** (e.g. `KYC_REQUIRED`, `INSUFFICIENT_FUNDS`); the client resolves them via translation dictionaries so system messages are localized too. Two JSON dictionaries created: `src/i18n/en.json`, `src/i18n/ar.json`, seeded with the strings Phase 1 emits.

## 10. AI Support Chatbot
- Backend: `src/routes/api/support-chat.ts` streaming route using Lovable AI Gateway (`openai/gpt-5.5`, provisioned via `LOVABLE_API_KEY`).
- System prompt: concise, helpful, TrustLaunch-scoped; **never mention any support email**.
- Server-side detection on the latest user message: if it matches scam/legitimacy intent (regex + keyword list in EN & AR: `scam|fraud|legit|legitimacy|نصب|احتيال|موثوق`), the server appends a structured `support_escalation` UI message-part with `email: joo15572ny@gmail.com`.
- Client renders escalation as a distinct card ("Contact support: joo15572ny@gmail.com"). Normal replies never show the email.
- Chat UI is a floating widget available on every page.

## 11. What's NOT in Phase 1
Client dashboard, freelancer dashboard, KYC upload UI, admin console, notification bell, "Funds Secured" badge, project browse pages. All scaffolded in Phase 2 on top of this backend.

---

## Technical notes
- Amounts as integer cents; fee stored in bps on the contract for future flexibility.
- All wallet/escrow mutations are SECURITY DEFINER RPCs; RLS forbids direct client writes to `wallets`, `wallet_ledger`, `escrow_transactions`, `platform_wallet`, and `contracts.status`.
- Schema, RLS, GRANTs, RPCs, storage bucket, and cron scheduling ship in migrations. `kyc-documents` bucket is created via the storage tool (not SQL).
- Super-Admin UUID is baked into `has_role` via migration once you provide it.

## One question before I build
Send me your Super-Admin `auth.users.id` after you sign up in the running app (or tell me to enable Cloud, wait for the sign-up UI, and come back with it). Everything else I can build now.
