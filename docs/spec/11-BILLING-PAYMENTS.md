# GeraiExpress — Shipping Money and Reconciliation

- Status: Proposed financial boundaries; the retail/net selection in CTX-28 and the first-release pricing model in DEC-016 (2026-10-28) are already owner decisions.
- Owner: Paduka Ongki
- Updated: 2026-10-28
- Scope: Shipping charges, provider spending authority, the gerai discount model and reconciliation. This document does not select a platform wallet, subscription, cashier, tax treatment or goods-settlement service. Decision (DEC-016): no platform fee is collected and no platform ledger or settlement exists in the first release.

The [selected pricing direction](02-PRD.md#selected-pricing-direction--normal-customer-tariff-discounted-seller-cost)
owns customer normal tariff versus private seller net cost. TD-9 owns provider
field mapping and numerical acceptance vectors; DATA-5 owns stored facts and
precision. This document owns who can authorize money movement and what an
observed amount can truthfully mean. No live financial operation was executed.

## BILL-1 — Money responsibilities and collection channels
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-27, CTX-28, CTX-36, CTX-37; PR-22, PR-23.
- Statement: Every enabled collection mode shall identify customer obligation, provider payer, component collection channel and goods ownership without treating quoted charges as payment or seller balance as platform funds.
- Acceptance: Each enabled mode has a reviewed component/payer mapping; no fee or premium is collected twice, customer goods are excluded from shipping earnings, and unsupported ownership/settlement paths cannot dispatch.
- Constraints: TD-9, DATA-5, IAM-5, IAM-6, UX-5; exact commercial terms and payment permissions remain owner decisions.
- Evidence: Documentation review and synthetic expected values only; no balance, debit, settlement or ledger proof.

| Fact / action | Authority and allowed interpretation | Boundary |
|---|---|---|
| Customer shipping-related obligation | Frozen normal Mengantar shipping plus applicable verified customer components | Not proof of cash received, courier collection or a tax invoice |
| Mengantar payer | Verified actual seller account bound to the tenant under the selected ownership model | App signup, a contact or a Super Admin role is not a funding source |
| Seller cost | Verified account/service net shipping plus applicable provider components, with exact inclusion/precision | Local discount assignment cannot change upstream billing |
| Provider funds/balance | Provider-authoritative observation with account, time and currency | Availability check is not a reservation or guarantee that a later charge succeeds |
| Platform remainder | Decision (DEC-016): provider discount minus gerai discount, derived (DATA-9), never typed | An estimate until the provider value is provider-verified; not collected, not distributable profit in the first release; excludes customer goods and unproved tax/overhead/returns (BILL-3) |
| COD goods proceeds | Amount attributable to the submitted customer sender/goods owner | Not platform revenue or distributable gerai profit; settlement obligations need acceptance before Full COD |
| Insurance | Explicit coverage, declared value, payer, premium and collection channel | Saving sender/recipient or choosing COD does not automatically select insurance |
| Refund, return or surcharge | Separate observed adjustment against the original shipment, with reason and source | No automatic refund/debt write-off/cash reimbursement or retroactive snapshot edit |
| Application monetization | Separate owner decision. Decision (DEC-016): no separate platform fee is collected from the gerai in the first release | No subscription, extra markup or platform commission is inferred from a seller discount |

Recommended pilot: enable Non-COD first after tariff, payer and label proof.
Enable COD Ongkir only after supported collection and fee/insurance behavior is
proved using the selected normal retail basis. Enable Full COD only when goods
ownership, recipient collection, seller receipt and customer-sender settlement
responsibilities are accepted and observable. This is sequencing advice, not a
change to the requested multi-mode product or an accepted restriction.

For every enabled mode, the release record must answer: which actor approves
provider spending; which account is charged; which components the counter or
courier collects; when and to whom goods proceeds become payable; and who handles
differences, failed collection, return and claim support. An unanswered required
responsibility disables that mode, not unrelated draft/contact functionality.
Existing Mengantar dashboard payments/withdrawals remain provider-controlled;
no platform custody or withdrawal API is assumed.

## BILL-2 — Financial authorization and reconciliation
- Status: Proposed
- Owner: Engineering owner
- Source: PR-5, PR-22, PR-23, PR-27; CTX-36, CTX-37.
- Statement: Provider spending shall bind to a reviewed versioned operation and reconcile observed results against the original account/order/batch, preserving quote, actual charge and adjustment separately.
- Acceptance: Duplicate, timeout, partial batch result, actual-cost mismatch and credential/account-change scenarios preserve one financial history and deny unauthorized replay; operator/customer projections reveal no net-cost data.
- Constraints: TD-3, TD-9, DATA-2, DATA-5, TEN-2, IAM-5; no universal provider idempotency, rollback or settlement guarantee.
- Evidence: Proposed control and proof conditions; implementation pending.

| Stage | Required authority / evidence | User-visible outcome |
|---|---|---|
| Quote | Actual account/service/input/assignment version, timestamp, complete required components | Estimate with its validity/revalidation conditions |
| Confirm | Current actor/outlet and permitted spending authority; immutable input/price digest | Durable operation receipt, not a payment success |
| Dispatch | Current account/credential and safe operation state; original authority still valid | Pending external result |
| Accepted unpaid | Original provider identities and explicit unpaid evidence | Original batch review; TD-3 requires all payable members and permitted amount/scope |
| Ambiguous result | Persist dispatch attempt and known evidence | Reconcile the same operation; no blind new order/payment |
| Actual result | Verified provider order/payment observation and correlation | Known result plus any difference from quoted facts; no invented collection/settlement |
| Difference or return | Original snapshot plus append-only adjustment/evidence | Attention item for the authorized owner; resolution records cause/outcome without rewriting history |

Do not pair an AWB array with local rows by position or equate batch count with
per-order payment proof. Queries and callbacks converge on the same scoped
transition rules. A provider field marked paid must be mapped to its documented
meaning; it cannot stand for customer cash receipt, COD payout and goods settlement
simultaneously. Exact settlement-report matching remains conditional on a
verified provider interface and accepted financial scope.

Any mode that needs an internal payable ledger must gain a separate accepted
ledger contract before enablement, including liabilities, reconciliation,
adjustments and access. This draft does not invent accounts, journal entries or
successful payouts to fill that gap. No real payment data is included here.

## BILL-3 — Gerai discount model and no platform fee in the first release
- Status: Decision (DEC-016 direction; discount meaning owner-delegated, DEC-018, 2026-10-28); provider terms unverified; Proposal (mechanics and the revisit trigger)
- Owner: Paduka Ongki
- Source: DEC-003, DEC-012, DEC-016; CTX-39, CTX-40, CTX-42; PR-22, PR-23; docs/review/2026-10-28-full-review.md section 8 item 3.
- Statement: In the first release the sender pays the full normal Mengantar tariff and the gerai receives a Super Admin-assigned discount; GeraiExpress collects no separate platform fee from the gerai and builds no platform ledger, settlement or payout path. The platform remainder (provider discount minus gerai discount) is derived, shown as an estimate until provider-verified, and a gerai discount above the provider-observed discount is blocked.
- Acceptance: The sender-facing and label price is the normal tariff in every case; the schema has no platform-fee, platform-ledger, payout or settlement record; the platform remainder cannot be typed; the gerai discount is configuration, not a constant in code; a gerai discount above the observed provider discount is refused (DATA-9); no public page states a percentage until it is provider-verified.
- Constraints: BILL-1, BILL-2, DATA-9, TD-9, IAM-5, PR-22, PR-23; DEC-003, DEC-012.
- Evidence: Owner decision 2026-10-28. Provider facts (Evidence, read 2026-10-28, CTX-42): Mengantar publishes volume steps 20%, 22.5%, 25%, 27.5% and 30% only above the 10,000 step, with neither unit nor period stated; the sandbox estimate example returns `discountPercent: 20`. Counter-evidence to the owner's 30% start: nothing read shows a partner-registered seller starting at 30%, a per-seller discount the partner can set, pooled volume across a partner's sellers, or any partner rebate (CTX-40, CTX-42). Nothing in this model is built.

Provider-account roles (kept from DEC-006 and DEC-012):

| Party | Role | Status |
|---|---|---|
| GeraiExpress | Owns the Mengantar Partner account and registers one seller per tenant; the Partner secret is a server-only environment secret (DEC-012, DEC-020; formerly a Worker secret) | Decision (DEC-012, DEC-006, DEC-020) |
| Gerai (tenant) | Holds its own Mengantar seller account (Partner-created or BYOK); the provider debits that seller's balance for each order, and balance and withdrawal stay provider-controlled | Decision (DEC-006); Evidence (CTX-40: sellers hold accounts "in their own name") |
| Sender (customer) | Pays the gerai the full normal tariff plus applicable COD fee or insurance; the product records no counter payment | Decision (DEC-016); Observed: no cashier or payment-receipt record exists |
| Mengantar | Charges the seller account under its own volume discount; no partner rebate or revenue share is documented | Evidence (CTX-40, CTX-42); Unknown whether a rebate exists outside the pages read |

What the discount means in the first release (Decision, owner-delegated default, DEC-018, 2026-10-28; resolves the earlier Assumption): a Mengantar seller account is the gerai's own account with its own balance (Evidence, CTX-40: "a normal Mengantar seller account in their own name", orders "at that seller's rates"), so GeraiExpress cannot change what Mengantar debits (BILL-1). The Super Admin assigns a discount per tenant (integer basis points, effective date, source reference, status owner-stated, provider-observed or provider-verified, audit; DATA-9, PR-23). That assigned value is the cost basis shown to the gerai and the amount the Super Admin is accountable for. Mengantar's actual debit follows the seller account's own rate (the quote's `estimatedSpecialPrice` basis). The Super Admin screen shows the variance between the assigned and the provider-observed discount; the variance is neither collected from nor subsidized to anyone (BILL-2 reconciles it). Assigning above the provider-observed discount stays blocked (DATA-9). The platform remainder stays a derived estimate and is 0 or Unknown until Mengantar answers (TASKS T-048). Consequence, stated plainly: with no platform fee and no collection path, the platform earns nothing from the discount in the first release. Rounding of every rupiah amount derived from basis points is a Decision (DEC-018): integer arithmetic, discount amount rounded down (DATA-9). Unknown: whether Mengantar pays the partner a rebate or requires the remainder to be collected from the gerai, which would need the settlement path that DEC-016 excludes (written Mengantar answer, T-048).

Risk (CTX-42, Evidence): with about 50 small sellers each seller may sit on its own volume step. If every seller is at 20% the gerai's 20% equals the provider's and the remainder is 0 points; if Mengantar gives a seller 30% while the gerai is assigned 20%, the 10 points have no collection path in this release.

Revisit trigger (Proposal, from CTX-42 and the TASKS deferred note): reconsider collection, settlement and a platform ledger only if Mengantar's written answer shows that the remainder must be collected from the gerai instead of paid to GeraiExpress, if the observed `discountPercent` for a seller changes, or if the owner changes the terms. Until then no platform-share design exists, and the previously proposed spread-based share model is withdrawn (DEC-016 replaces it).

Public marketing may state no discount percentage until the terms are provider-verified (DEC-012, TASKS T-036).
