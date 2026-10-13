# GeraiCuan Pricing Review for GeraiExpress

- Reviewed: 2026-10-13; internal product/engineering research.
- Request: Study GeraiCuan pricing and carry useful behavior into the existing GeraiExpress specification.
- Preferred source: `/home/ongki/Projects/geraicuan-completion`, clean HEAD `1199406c5c6fb67d6607add624cea487c91ad029`.
- Older baseline: `/home/ongki/Projects/geraicuan`, HEAD `3e3ebf6a860a87c55b41f1e48f52c77362aa3032`, with pre-existing changes. Its earlier money/COGS decisions are not the latest behavior.
- Scope: Source, specifications, synthetic examples and selected local tests. No real customer records, provider invoices, credentials, database or authenticated API were accessed.
- Authority: [GeraiExpress PRD](../spec/02-PRD.md), CTX-24 through CTX-26. GeraiCuan commercial decisions and historical rate observations are reference evidence, not automatically GeraiExpress policy.

## Product-owner clarification after this source study

CTX-27/CTX-28 now select **normal undiscounted Mengantar customer/resi shipping**
and **separate discounted seller cost**, including applicable COD/insurance
components once. Platform-assigned discount terms must match verified provider
activation/billing. GeraiCuan's cost-break-even COD Ongkir and synthetic legacy
333-bps example below are historical observations, not GeraiExpress's selected
customer pricing. PR-22/PR-23 and the existing technical/data/IAM/UX contracts
own the current behavior. The reviewed Partner routes do not edit seller rates.

## 1. Main findings

| Question | GeraiCuan behavior in the preferred source | Consequence for GeraiExpress |
|---|---|---|
| Does the app charge a subscription? | PR-81 prohibits plans/prices/upgrades/payment for using GeraiCuan; the reference describes free access | This is GeraiCuan's policy. GeraiExpress monetization remains a separate decision |
| Is there a freely configurable customer price list/markup? | Explicitly outside reference v3.1 scope; packing/cardboard/admin add-ons are an unimplemented owner decision | Do not claim a markup editor exists or silently invent its prices |
| What is the customer shipping basis? | The chosen provider `price`, with separate collection rules for COD and COD Ongkir | Preserve customer charge versus provider deduction as separate quantities |
| Where can a shipping spread arise? | Customer-facing list price versus account-specific deducted shipping, after actual fee/return effects | It is not a guaranteed discount, commission, customer payment or net profit |
| Does COD Ongkir earn the same spread? | Current computed charge uses the **deducted** shipping break-even, not the customer list-price basis | New default COD Ongkir leaves only rounding difference, commonly 0–1 rupiah under the historical model |
| Who sees internal money? | Tenant Admin sees deductions/payout/margin; COD operator/customer views use a customer-facing split | Reuse the role boundary concept, repair incomplete DTO projection before porting |

Relevant owner documents: reference `docs/spec/02-PRD.md` PR-9, PR-64, PR-78,
PR-81, PR-93 and its amended decisions; `docs/spec/19-METRICS-ANALYTICS-CONTRACT.md`
COD, CUSTOMER-ONGKIR and OWN-* sections. Source paths below are relative to the
preferred checkout and identify actual code, not newly implemented GeraiExpress modules.

## 2. Price sources and normalization

| Quantity | Source behavior | Important qualification |
|---|---|---|
| Customer/list shipping | `shippingAmountIdr` from provider `price` | Provider quote, not a gerai-configurable price |
| Normal quote | `normalPriceIdr` from `estimatedPrice` | Separate field/provenance; do not substitute it into unrelated price bases |
| Special quote | `specialPriceIdr` from `estimatedSpecialPrice` | Account/service-specific and nullable; not a guaranteed entitlement |
| Deducted shipping estimate | `specialPriceIdr ?? normalPriceIdr ?? shippingAmountIdr` | A reference fallback for the shipping estimate, not universal proof of actual billed cost |
| Provider discount | `discountIdr` from `discount` | Display-only; source does not calculate settlement from this field |
| Cargo | `cargoPrice`, `cargoEstimatedPrice`, `cargoEstimatedSpecialPrice`, `cargoDiscount` | Keep cargo-tier fields together; do not combine a cargo list price with regular-service deductions |
| Insurance | Normalizer currently returns null amount/source | Optional column/UI support does not prove enabled insurance calculation or a current account response |
| COD fee | Historical constant 333 basis points in `mengantar-cod-fee.ts` | Reference assumption from prior observations, not a currently verified universal tariff |

Trace: `src/lib/mengantar-estimate.ts` normalizes →
`src/db/estimate-repository.ts` snapshots →
`src/lib/shipment-estimate-options.ts` builds role-projected choices →
confirmation reloads authoritative prices through `src/db/cod-totals-repository.ts`
and `src/db/order-batch-repository.ts` → immutable provider/invoice facts feed
shipment detail, labels and owner reporting.

Missing values remain unknown; explicit zero and missing are different. The
normalizer rejects malformed amounts, unsupported currency and contradictory
special/normal prices. Cargo zero fields are treated as unavailable rather than
free cargo prices. The draft payout helper has a scale-mismatch guard; its
particular 2× threshold is a source heuristic, not a vendor pricing contract.

## 3. Three collection modes and the actual formulas

Notation: `G` = goods value included in recipient collection, `P` = provider
customer/list shipping quote, `S` = account-specific deducted shipping estimate,
`C` = courier collection, `F` = COD fee. The following formulas describe the
**historical GeraiCuan 333-basis-point model**, excluding unverified insurance,
extra fees, adjustments and returns.

### Non-COD

Customer shipping baseline is `P` (plus supported insurance when separately
recorded). The reference assumes counter payment occurs outside its collection
system; it does not operate a cashier or prove receipt of cash.

```text
Estimated shipping spread = P − S
```

Owner reporting keeps this as an estimate because the reference does not have
per-resi Non-COD settlement evidence. The customer nota is a document, not proof
of payment. `InvoiceSheet` explicitly prints that distinction.

### Full COD

```text
C = ceil((G + P) × 10000 / 9667)
F = round_half_up(C × 333 / 10000)
Estimated seller payout = C − S − F
Customer-facing Ongkir = C − G
Estimated shipping spread = estimated seller payout − G
```

Actual source: `calculateCodAmounts` in `src/db/cod-totals-repository.ts`;
`mengantarCodFeeIdr`, `codChargeBreakdown` and `shippingMengantarDeductsIdr` in
`src/lib/mengantar-cod-fee.ts`; `deriveDraftProviderMoneyLines` in
`src/lib/shipment-draft-logic.ts`.

Gross-up accounts for a fee assessed on the final collection rather than adding
a percentage to a smaller base. The old additive formula/version 1 was retired;
its saved totals must not be silently recalculated or resubmitted. Current
confirmation rejects an unsubmitted retired-formula draft and asks for a new
properly estimated shipment. An already-sent unknown order must still reconcile
its original operation; this is not permission to create a replacement order.

Historical code describes the fee as containing a tax component and presents
that component inside the fee. Do not add that historic component again or treat
this source commentary as current tax guidance. Any current fee/tax treatment
requires the actual provider contract and applicable policy.

### COD Ongkir

Goods were paid outside the courier collection. The current path computes the
charge and rejects an altered browser value:

```text
C = max(1, ceil(S × 10000 / 9667))
F = round_half_up(C × 333 / 10000)
Estimated difference = C − S − F
```

`codOngkirAmount` and `computedCodOngkirChargeIdr` apply this rule. Older documents
and `calculateCodOngkirAmounts` still describe accepting an upward-adjusted charge,
but current confirmation requires the computed amount. Raised historical rows
remain historical records; their values do not authorize a new editable price.

This historical mode protects cost recovery rather than charging the list-price
spread. GeraiExpress now has an explicit selected basis in CTX-28: normal Mengantar
retail shipping R, including COD Ongkir, with verified applicable fees/insurance
counted once. The old cost-based formula is evidence only and must not define
new customer charges. No extra discretionary gerai fee has been selected.

## 4. Worked example — synthetic, not a live quote

Assume goods `150,000`, customer/list quote `8,000`, deducted shipping `5,600`,
and the historical 333-basis-point model. No insurance, overhead or return.

| Mode | Customer/courier collection | Fee | Estimated provider payout | Estimated gerai shipping spread |
|---|---|---|---|---|
| Non-COD | Customer shipping 8,000 at counter; actual payment not recorded | No COD fee | No COD payout | 2,400, before other costs and proof of payment |
| Full COD | Courier collects 163,443 = goods 150,000 + customer Ongkir 13,443 | 5,443 | 152,400 | 2,400 after subtracting goods 150,000 |
| COD Ongkir | Courier collects 5,793 shipping-only; goods outside this collection | 193 | 0 remaining after shipping/fee | 0 |

The extra COD amount above goods/list shipping covers the modelled provider fee;
it is not all gerai income. A COD payout includes goods proceeds owed under the
business relationship, not just shipping earnings. Do not advertise this sample
as an actual courier tariff or a promised margin.

The existing estimate-options tests exercise actual full-COD calculation and
bounds. An independent Node check imported the real plain fee helper and checked
nine synthetic assertions: the example values, special-price priority, normal
fallback, invalid negative shipping and COD Ongkir cost recovery. The gross-up
expression in that independent check was calculated with exact BigInt arithmetic.

## 5. Customer, operator and owner presentation

| Audience | Reference display contract | Proposed GeraiExpress adaptation |
|---|---|---|
| Customer document, full COD | Goods + customer-facing Ongkir = collection; fee/rounding folded into Ongkir | Clear total and who collects it; no private provider cost/payout/spread |
| Customer document, COD Ongkir | Entire collection is Ongkir; no goods charged by courier | Explain shipping-only collection; no implied goods payment record |
| Customer document, Non-COD | List shipping and supported insurance; declared goods value is informational | Keep customer price and payment proof distinct |
| Operator | Customer-facing amounts for the current job | Server projection omits internal costs, discount economics and payout fields in every mode |
| Tenant Admin | Fee/deduction, payout estimate, settlement evidence and shipping spread if the feature is accepted | Private account-scoped details, explicit estimated versus confirmed basis |

Sources: `customerCollectBreakdown`, `moneyForRole`,
`issuanceOptionsForRole`, `invoiceForRole`, `invoiceV2CodLines`.
Invoice template version 2 folds full-COD fee/rounding into customer Ongkir;
version 1 is immutable and reprints its earlier layout. Reading only the older
PR-78 statement about list-price invoice totals would miss this later behavior.

**Transfer gap:** `issuanceOptionsForRole` returns Non-COD options unchanged,
while `buildShipmentEstimateOptions` adds `shippingDeductedIdr`. Both new-shipment
and detail pages pass those options to client components. Thus the reference's
Non-COD payload can contain the deducted shipping even when the UI does not draw
it. GeraiExpress must explicitly project its operator DTO in every mode if
provider cost is admin-only. This is a source-traced concern, not a rendered
browser exploit demonstration. Earlier version-1 invoice readback also has a
known broader historical projection; no legacy document migration is authorized.

The reference's money privacy rules were implemented on local HTML labels and
nota. GeraiExpress plans provider PDFs, whose printed financial content remains
unverified. Inspect that external output before promising the same customer
privacy; application DTO projection does not remove fields from a provider PDF.

The reference does not show the latest owner figures to operators. Original
merchandise COGS/net-profit tracking was withdrawn; newer `ownerMarginUnits`
reports shipping spread with an estimated/proven basis, not a restored goods
profit feature. Cleared charges and returns can make the spread negative;
refunds are kept separate. Missing goods/cost evidence does not become zero.

## 6. Provider evidence and transfer limits

The saved official sandbox Public documentation retrieved earlier on 2026-10-13
contains `price`, `estimatedPrice`, `estimatedSpecialPrice`, cargo equivalents,
`codFee` and order `COD_FEE` examples. Some estimate examples have a nonzero
`codFee`. This contradicts any universal assumption that a quote always returns
zero fee or never includes it. No universal 3.33% rate was established in that
reviewed page. [Estimate contract](https://sandbox.mengantar.com/docs/#content-estimate),
[Public estimate](https://sandbox.mengantar.com/docs/#content-estimate-public),
[order contract](https://sandbox.mengantar.com/docs/#content-add-order).

A later re-fetch during this pricing review returned HTTP 403; the documented
comparison uses the earlier same-day saved official bytes (SHA-256
`278f4e8317eabf315fb119c99a65ba70ffe127600b79dbe83b95f86634611f18`). No new authenticated
contract probe occurred. Code comments claiming past live invoice verification
are historical reference claims; their underlying financial records were not
read or independently revalidated here.

Before real pricing enablement, verify each intended seller/service's current
customer quote, shipping deduction, COD fee base, minimum/maximum, rounding,
inclusion flags, insurance and settlement semantics. Estimate and stored-order
`estimatedSpecialPrice` can have different inclusion semantics. Model source,
phase and inclusion explicitly; subtract a fee once. Do not silently switch
accounts/services, invent missing costs or hardcode historic percentages as
current entitlements.

## 7. Recommendation for GeraiExpress

Reuse the reference's **separate money quantities, durable snapshots, precise
arithmetic, customer projection and recovered-original-order discipline**.
Keep a provider-derived baseline with no unrequested free-form markup for the
initial proposal. Preserve candidate collection modes separately; activate COD
only after its rate, funding and customer-goods obligations are accepted.

| Decision | Recommended starting point | Still needed |
|---|---|---|
| Customer price | Owner-selected normal provider tariff before seller discount; explicit fee/insurance and collection; immutable at confirmation | Verify current normal/net fields and fee/insurance inclusion for intended accounts |
| Gerai internal cost | Separate private verified cost/deduction projection | Fee inclusion and actual-charge evidence |
| Additional gerai fees | No invented packing/admin/markup; COD fee and insurance follow selected CTX-28 policy | Current applicable provider components; separate owner decision for other add-ons |
| COD Ongkir earnings | Reference is cost break-even; the owner now selected normal retail basis for GeraiExpress in CTX-28 | Verify customer fee/insurance and separate discounted provider cost; do not copy the old customer formula |
| COD customer goods proceeds | Trace sender/customer ownership separately from gerai shipping earnings | Who receives/pays out goods proceeds; responsibilities for returns/refunds and any liability/accounting workflow |
| Platform revenue | No commission, subscription or discount-share entitlement established by the Partner API contract | Separate GeraiExpress commercial agreement/business-model decision |
| Financial reporting | Estimates stay labelled; confirmed outcomes use account-bound evidence | Finance/settlement requirements and testable definitions if accepted |

One Mengantar seller per gerai tenant means funds from several customer senders
can arrive under that tenant's seller account. A shipping spread calculation
alone is not a customer-payables or payout system. If full COD is in the live
scope, record its commercial obligations before enabling it. This product
boundary matters more here than in a merchant shipping only its own goods.

Canonical proposed owners: PR-22, TD-9, DATA-5, IAM-5 and UX-5 in the existing
pack. No new pricing implementation, migration, paid plan or actual customer
charge has been created by this review.

## 8. Executed checks and remaining proof

Selected source-only checks:

```sh
env -u DATABASE_URL -u APP_DATABASE_URL pnpm exec vitest run --config vitest.integration.config.mts tests/mengantar-estimate.integration.test.ts tests/shipment-estimate-options.integration.test.ts tests/invoice-print.integration.test.ts
```

Result: **3 test files, 34 checks passed**. Estimate HTTP tests mock transport;
invoice rendering uses synthetic records. These are existing Node/static-render
checks, not browser, database, Workers or live provider proofs. The independent
plain-helper example passed nine assertions. Twenty-one selected source/test/doc
fingerprints and the advanced Git status remained unchanged.

Reproduce the independent example from the preferred checkout with
`node --experimental-strip-types --input-type=module` and this script on stdin:

```javascript
import assert from 'node:assert/strict';
import { mengantarCodFeeIdr, shippingMengantarDeductsIdr,
  codOngkirBreakEvenIdr, codOngkirSellerDifferenceIdr } from './src/lib/mengantar-cod-fee.ts';
const goods = 150000, list = 8000, special = 5600;
const cod = Number((BigInt(goods + list) * 10000n + 9666n) / 9667n);
const fee = mengantarCodFeeIdr(cod);
const charged = shippingMengantarDeductsIdr({
  normalPriceIdr: list, shippingAmountIdr: list, specialPriceIdr: special,
});
const shippingOnly = codOngkirBreakEvenIdr(special);
assert.equal(cod, 163443);
assert.equal(fee, 5443);
assert.equal(charged, 5600);
assert.equal(cod - fee - charged - goods, 2400);
assert.equal(shippingOnly, 5793);
assert.equal(mengantarCodFeeIdr(shippingOnly), 193);
assert.equal(codOngkirSellerDifferenceIdr(shippingOnly, special), 0);
assert.equal(codOngkirBreakEvenIdr(-1), null);
assert.equal(shippingMengantarDeductsIdr({
  normalPriceIdr: 8000, shippingAmountIdr: 9000, specialPriceIdr: null,
}), 8000);
console.log('PASS: 9 synthetic pricing assertions; historical 333-bps assumption only');
```

An initial broader selection also attempted `customer-money-t271` and
`owner-money-render-t275`. The former failed to import and the latter had one
case fail because nested page/action imports require `APP_DATABASE_URL`; those
files did not complete successfully without a database configuration. No real
connection was supplied and the source was not altered to force a pass. The
successful bounded result above excludes those two files. Existing DB/settlement
suites and historical financial fixtures were not run/read.

Target proof still required: independent fee/inclusion/rounding vectors; current
account-specific sandbox amounts; operator DTO denial in all collection modes;
confirmed-versus-estimated totals; price/account replacement and stale quotes;
unknown/unpaid order recovery; and accepted customer COD obligations. Source
fingerprints, commands and bounded results are retained in `reference-scan.json`.
