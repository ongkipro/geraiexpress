# GeraiExpress — Personal Data and Lifecycle Decisions

- Status: Proposed engineering inventory; legal applicability and retention unresolved.
- Owner: Paduka Ongki
- Updated: 2026-10-29

## PRIV-1 — Purpose-bound operational data
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-3, CTX-11.
- Statement: Sender/recipient data and generated shipping documents shall be accessible only for accepted tenant operations and retained/deleted according to an explicit policy distinguishing reusable contacts from transaction records.
- Acceptance: Authorized contact reuse/detail/label access works; foreign/anonymous access fails, list/search payloads omit unnecessary detail, and an approved archive/delete workflow explains its effect on contacts and historical shipment snapshots.
- Constraints: TEN-1, TEN-2, DATA-1, DATA-2, SEC-1. Retention/erasure policy is unresolved and must be selected before lifecycle implementation.
- Evidence: User request and reference data model observed; no legal determination or new lifecycle test exists.

| Data | Purpose / exposure | Decision still required |
|---|---|---|
| Saved sender/recipient name, phone, addresses | Prefill future shipments within an allowed tenant; full or masked operational display must follow the selected role/purpose policy | Notice, permitted display/export roles, correction, archive/delete, retention |
| Shipment parties and pickup snapshots | Preserve what was submitted; provider fulfillment, authorized label and recovery | Transaction retention, correction history, eventual erasure obligations |
| Provider dropshipper master/mapping | Submit customer identity under the selected provider account | Authority to transmit customer data, provider-master lifecycle, rotation and contact-change handling |
| PDF labels and download capabilities | Authorized shipping and reprint | Whether to persist files, private storage, expiry/reprint/retention policy |
| User/membership/audit information | Access governance and accountability | Support/admin access, review and audit retention |
| Operational event metadata | Diagnose failure/replay and scoped counts | Minimum identifiers, log access and retention; no full names/phones/addresses or raw bodies |

Archiving a reusable contact is not erasing all historical shipment snapshots.
Changing a contact phone does not rewrite the provider identity on an existing
order. UI copy must explain this distinction. Contacts are not automatically
marketing leads, notification subscribers, or registered accounts.

Where masking is selected, it is a server-side projection requirement; hiding
a complete phone with CSS leaves it in the payload. The advanced reference
allows full phones in authorized operations; that policy is a candidate rather
than an automatic GeraiExpress grant. Ordinary authenticated users must not gain a
broader raw-table view than the intended workflow through direct Data API
access. Full details needed for authorized intake/detail/printing require a
separate explicit projection/command and matching grants.

Do not import the reference product's five-year transaction or 90-day archived
contact retention as GeraiExpress policy. Do not copy production customer data,
labels, credentials, or user sessions into the project or fixtures.

## Applicability and processing-location decisions

User/data-subject markets, operating legal entity, controller/processor roles,
cloud project regions, backups, support access locations, subcontractors,
cross-border flows, and contractual obligations are Unknown. Paduka Ongki owns
their resolution with qualified review where needed before deployment and
personal-data lifecycle acceptance. This file makes no current-law compliance
or provider-registration conclusion. CTX-10 records a historical ISP DNS symptom;
current official status remains unverified, and switching infrastructure does
not establish the cause or resolution of blocking.

## PRIV-2 — Seller account-owner data and provider agreement
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-17.
- Statement: New Mengantar seller registration shall use purpose-bound real account-owner details and recorded affirmative provider agreement, separately from shipment contacts, application signup, and marketing permission.
- Acceptance: An authorized owner can review the registered email and account-access instructions; missing agreement or unreadable/placeholder email prevents registration; other tenants cannot obtain owner details or acceptance records through UI/Data API/export.
- Constraints: PR-20, DATA-4, TEN-3, SEC-3. Exact provider policy URLs/versions, owner-verification method, retention and legal applicability remain unresolved.
- Evidence: Documented partner obligations; no legal conclusion or real personal-data processing performed.

The registration disclosure must explain that a real seller account is created
in the named owner's name and Mengantar holds its COD funds. Record the accepted
provider Terms/Privacy documents, versions/digests, disclosure revision, actor,
tenant, owner, and acceptance time before dispatch. Obtain actual policy links
from Mengantar; never invent URLs or treat a prechecked box as agreement.

Owner email must be readable because first access uses Mengantar's Lupa Password
flow. Never request, set, or store that provider password. Provider withdrawal,
phone/email verification, and bank-change identity approval are independent of
GeraiExpress login and remain provider responsibilities. Data subjects and
purposes differ from sender/recipient contacts; contact storage is not authority
to create a financial/shipping account for that person.

Select retention, correction and owner-transfer handling before implementation.
Deletion of a local connection is not a documented provider-account deletion
operation; no such endpoint is established by the four-route Partner contract.

## PRIV-3 — Registration, owner and invitation data purposes
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-31, CTX-34, CTX-35; PR-29 through PR-33.
- Statement: Registration shall collect only the data needed for verified identity and gerai setup, present the actual application policies, keep provider agreement separate, and define uncompleted/rejected application and invitation retention before real processing.
- Acceptance: Register/setup screens request no customer book, bank details or identity documents without an accepted purpose; actual policy references and affirmative required Terms acceptance are recorded, invitations expose only the intended scope, and rejected application cleanup cannot erase unrelated memberships or provider history.
- Constraints: PRIV-1, PRIV-2, DATA-7, SEC-5, ARCH-3; retention, operating entity and qualified applicability review remain unresolved.
- Evidence: Proposed inventory and lifecycle requirements; no legal compliance conclusion or real records collected.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.

| Information | Purpose / allowed audience | Policy gate |
|---|---|---|
| Auth email and account credential | Application-owned identity/recovery (`auth.users`, `auth.sessions`, `auth.otp_codes`, `auth.mfa_factors`, ADR-0002); password hashes (`scrypt`), HMAC code digests, SHA-256 refresh hashes and sealed TOTP secrets stay in schema `auth` and HttpOnly session cookies (`gx_at`, `gx_rt`) | Actual database/mail processing locations and lifecycle |
| Applicant owner/business/contact and pickup | Own setup and purpose-bound Super Admin business review; not a global customer directory | Minimal required fields, notice, correction/resubmission and review retention |
| Application policy acknowledgment/Terms acceptance | Evidence of the specific application terms/policy presented; version/time/actor/application | Actual legal entity, URLs/versions and retention; not implied consent to all processing |
| Intended staff email and invitation history | Deliver scoped invitation and prevent unauthorized acceptance | Invite lifetime, issuer access and unaccepted/revoked retention |
| Authentication email content/metadata | Deliver code/recovery/account-security messages | Application and mail-provider access (DEC-020, DEC-021; formerly Cloudflare/Supabase), suppression/log retention and diagnostic minimization |

Application Terms acceptance, privacy notice presentation, Mengantar agreement
and optional marketing permission are separate records/purposes. No marketing
opt-in is required to register; no provider acceptance is prechecked or inferred
from app signup. Use the actual approved application documents before receiving
real signups. Authentication emails contain sensitive codes/links: omit their
bodies and identifiers that expose credentials from telemetry and review artifacts.

Rejected gerai registration is not deletion of the person's Auth account or all
other memberships. Account erasure/owner transfer must account for administrator
continuity, transaction records and provider ownership without silently claiming
that local deletion removes an external seller. Choose and test those policies
before exposing destructive lifecycle actions; no retention duration is invented.
