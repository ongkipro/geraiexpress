# GeraiExpress — Shipping Money and Reconciliation

- Status: Proposed financial boundaries; the retail/net selection in CTX-28 is already a user decision.
- Owner: Paduka Ongki
- Updated: 2026-10-13
- Scope: Shipping charges, provider spending authority and reconciliation. This document does not select a platform wallet, subscription, cashier, tax treatment or goods-settlement service.

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
| Shipping spread | Customer shipping-related obligation minus comparable verified provider cost | Estimated until actual costs are known; excludes customer goods and unproved tax/overhead/returns |
| COD goods proceeds | Amount attributable to the submitted customer sender/goods owner | Not platform revenue or distributable gerai profit; settlement obligations need acceptance before Full COD |
| Insurance | Explicit coverage, declared value, payer, premium and collection channel | Saving sender/recipient or choosing COD does not automatically select insurance |
| Refund, return or surcharge | Separate observed adjustment against the original shipment, with reason and source | No automatic refund/debt write-off/cash reimbursement or retroactive snapshot edit |
| Application monetization | Separate owner decision | No subscription, extra markup or platform commission is inferred from a seller discount |

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
