# GeraiExpress — Market, Pricing, Masking, Regulatory and Pickup Research

- Reviewed: 2026-10-28. Every source below was accessed on 2026-10-28 unless the register says otherwise.
- Audience: Paduka Ongki (owner) and the qualified Indonesian counsel the owner appoints. This is research for the owner and counsel to verify. **It is not legal advice.** Section 4.7 lists what needs a lawyer.
- Scope: documentation only. No Mengantar call was made, no credential was used, no file other than this note was edited.
- Authority: repository disk and executed checks, then `ARCHITECTURE.md`, then `DECISIONS.md` and `docs/spec/CONTEXT-RECORD.md` (DEC-011..DEC-017, CTX-39..CTX-42). This note records evidence about those decisions; it does not change them. Section 6 and the hand-off list what the lead may want to record.
- Related notes: [Mengantar Partner API](geraiexpress-mengantar-partner-api.md), [Mengantar Public API](geraiexpress-mengantar-public-api.md), [reference pricing review](geraiexpress-reference-pricing-review.md).

## 0. Method, labels and source reliability

Labels used on every non-trivial statement: **Observed** (read at the cited source), **Decision** (recorded owner decision), **Assumption**, **Proposal**, **Unknown** (no reliable source found), **Evidence** (a check that was run), **Inference** (my reasoning from observed facts; stated so it is not mistaken for a fact).

Source tiers, used in the register at the end:

| Tier | Meaning | Use |
|---|---|---|
| T1 | Official: statute or regulation text from a government portal, or the provider's own contract/terms/documentation | May support a statement of fact about that text or provider |
| T2 | Vendor self-description (marketing pages, help centers of aggregators and couriers) | Supports "the vendor says X"; never a market fact |
| T3 | Third-party or user-generated writing (blogs, personal articles, news commentary) | Colour only; never a number |
| T4 | Machine-synthesized answers returned by the search tool | **Not evidence.** Used only to find candidate URLs; every claim was re-read at the URL, and claims that could not be confirmed are listed in section 7 |

Limits: no market-size statistic for counters (gerai or agen) was found from an official source. Where the note writes Unknown it means exactly that; no number was estimated. Several pages did not render or could not be fetched (listed in section 7).

## 1. Market structure of shipping counters, agents and aggregators

### 1.1 Who the segments are

| Segment | What sources say | Label and source |
|---|---|---|
| Single-courier agent or drop point | Takes parcels for one courier brand. A KiriminAja-affiliated article says a drop point serves only one courier, so a sender using three couriers needs three places, and that a multi-courier agent serves "banyak ekspedisi dari satu meja" with a margin on top of the official tariff. Mengantar's own page says JNE cannot be dropped at a JNE agent, only a branch. | Observed, T2 [S30], [S6] |
| Multi-courier counter ("gerai", "agen multi ekspedisi", "loket") | At least four vendors market a package for this: AutoKirim agent program, Fastpay "Franchise Multi Ekspedisi" (bundled with payment-point services), Everpro "Mitra Offline", Kurir Pedia partner account. All describe one dashboard for several couriers, thermal-label printing and courier pickup at the counter. | Observed, T2 [S20], [S21], [S22], [S30] |
| Online seller, including COD social-commerce | Mengantar, Komship, KiriminAja and OnOrder are self-serve dashboards for sellers. Komship says it serves "13000+ pebisnis online" in its page metadata and "puluhan ribu" in its page text; the two figures disagree. | Observed, T2 [S3], [S28], [S29]; the counts are vendor claims |
| Dropshipper | Sells goods held by a supplier and wants its own name on the label. Shopee, Mengantar and KiriminAja each document a feature for this (section 3). | Observed, T1/T2 [S35], [S2], [S26] |
| Reseller (goods) | Holds own stock and ships under its own identity. No source in this research defines or sizes this segment separately. | Unknown |

Size of the counter population: the association ASPERINDO states "Kantor Pusat Berizin sebanyak 276 perusahaan (Dinamis)" and "Kantor Pusat, Cabang, Agen, dan Gerai sebanyak lebih dari 50.000 titik layanan" across its members. That is a self-reported association figure for member companies' service points. It does not say how many are independent multi-courier counters, and it says nothing about trend. **Number of independent multi-courier gerai in Indonesia: Unknown.** Observed, T1-association page, last updated 2025-11-25 [S31].

The planning figure "about 50 tenants" (CTX-39) is an **Assumption**; no source tests it.

### 1.2 Tools and aggregators in use

| Product | Positioning as published | Pickup/drop-off | Discount or earning wording | Source |
|---|---|---|---|---|
| Mengantar | Seller platform for 9 couriers (JNE, SiCepat, SAP, iDexpress, J&T, Lion Parcel, Anteraja, Pos Indonesia, SPX); Public API and a private Partner API | Both; see section 5 | Volume steps from 20% (section 2) | [S6], [S1], [S2] |
| Komship (Komerce) | Seller aggregator; "tanpa minimum jumlah pengiriman" | Free pickup "tanpa minimal" is claimed | "diskon ongkir mulai dari 25%"; per-courier table JNE 25%, SiCepat 25%, ID Express 25%, SAPX 30%, Ninja 40%, J&T 25%, SPX 25%, Lion 25%; footnote "Harga & diskon dapat berubah sewaktu-waktu"; the hero line says "hingga 50%" | [S28] |
| KiriminAja | Multi-courier seller aggregator; members with more than 200 resi per month are "VIP" with cashback; points and vouchers for regular members; affiliate program | Pick up and "Drop Off (Cashless)" | Cashback percentage for VIP is not stated on the page read | [S24], [S25], [S23] |
| AutoKirim | Agent program: "Komisi Ongkir Mulai dari 25%"; "Bebas atur porsi keuntungan biaya untuk Anda dan Mitra"; free pickup for all couriers; "terdaftar menjadi drop point ekspedisi" | Pickup | Commission share configurable by the agent | [S20] |
| Fastpay | Payment-point (PPOB) operator adding a multi-courier counter; "Fee Ekspedisi Sampai Dengan 30%"; "Paket akan dijemput kurir tanpa minimum jumlah paket"; page states BI authorization for its payment business | Pickup | "Sampai dengan 30%" fee | [S21] |
| Everpro | "Mitra Offline" franchise for home or shop counters; "12+ Pilihan Partner Ekspedisi"; "cashback sampai jutaan" (unquantified) | Not stated on the text read | Cashback, no rate | [S22] |
| OnOrder | Order-management dashboard with "tarif khusus OnOrder" for 11 couriers, label printing, pickup request | Pickup request | Special tariff, no rate | [S29] |
| Kurir Pedia | Explains drop point vs pickup vs agent and invites readers to join as a partner agent | n/a | None | [S30] |

Observed: none of the pages read shows a counter-specific product with tenant isolation, a configurable gerai discount administered by a platform operator and a locally printed masked label together. **Whether a competitor already offers exactly that combination: Unknown** (the vendors' private dashboards and contracts were not visible).

### 1.3 How counters earn

| Mechanism | What is documented | Reliability |
|---|---|---|
| Tariff spread: customer pays the normal tariff, counter pays the discounted tariff, counter keeps the difference | Described in the AutoKirim "bebas atur porsi", Komship and KiriminAja material; this is the model in DEC-016 | Observed, T2 [S20], [S28] |
| Fixed or percentage commission from a courier for parcels it receives | A third-party blog states Rp2,000 to Rp3,500 per J&T drop-off parcel and Rp1,000 to Rp1,500 per pickup parcel, "bonus target bulanan" 5% to 10%, and deposits of Rp5,000,000 to Rp10,000,000. Not confirmed by any J&T source. | T3 [S33]; **do not rely** |
| Aggregator "fee" or "komisi ongkir" up to 25% to 30% | Vendor headline numbers: Fastpay up to 30%, AutoKirim from 25%, Komship from 25% | T2 [S21], [S20], [S28] |
| Points, vouchers, referral commission | KiriminAja: acquisition commission "up to 5%" in the first month, "up to 1%" long-term; "Mitra" tier "up to 10%" and "up to 2%" with 100 active members and 1,000 shipments | Observed, T2 [S23] |
| Ancillary: packing materials, payment-point services | Fastpay lists PPOB, bill payments, e-money top-up, cash services next to the courier counter | T2 [S21] |

No official source states the average spread, average parcels per counter per day, or counter profitability. **Unknown.**

### 1.4 Competing and substitute products

Observed substitutes for a gerai customer: the courier's own agent or branch (single-courier); an aggregator app the sender uses at home with pickup; marketplace-integrated shipping (Shopee, Tokopedia); a courier pickup booked without any partnership (JNE states pickup "Bisa, dengan pembayaran tunai / non tunai (transfer)" [S37]).

### 1.5 Counter-evidence (disconfirming searches)

Six disconfirming searches were run. Results, with what they change:

| ID | Hypothesis tested | Finding | Effect |
|---|---|---|---|
| D1 | Counters are consolidating or closing | No official or statistical source found. A first-person article (Kompasiana, 2026-10-18) says a village agent handles "10 sampai 20 paket" a day, commission is thin and risks include shortage payments. Another blog gives high fixed costs. Both are anecdote. The search tool's claims of mass closures and Rp500 to Rp1,500 handling fees were not found on any page read. | **Unknown.** The target segment's health is contested by anecdote and unmeasured. Weakens confidence in CTX-39's premise that counters are an attractive buyer; does not disprove it. [S32], [S33] |
| D2 | Aggregators squeeze margins | No primary evidence of aggregators cutting discounts or cashback was found. Opposite-direction evidence: marketplaces added logistics service fees to sellers from May 2026 (TikTok Shop, Shopee) and some sellers said they were moving to their own sites (detikFinance, 2026-05-06). Komship carries "Harga & diskon dapat berubah sewaktu-waktu". | Unknown for aggregators. Marketplace fee pressure is a tailwind for non-marketplace shipping, not proof of counter demand. [S34], [S28] |
| D3 | A competitor already offers multi-courier counter software | **Yes** (AutoKirim, Fastpay, Everpro, Kurir Pedia; section 1.2). | Weakens any claim that "one dashboard with every courier" is itself a differentiator. [S20]-[S22], [S30] |
| D4 | Competitors give agents a better discount than the owner's plan | Komship advertises 25% from the first shipment, no minimum; AutoKirim from 25%; Fastpay up to 30%. The owner's starting terms give the gerai 20%, and Mengantar's default is 20%. Comparison caveat: Mengantar's flat price already includes "Mengantar's markup" (section 2.2), so the base tariffs of different aggregators may not be equal. | Weakens DEC-016's commercial terms. [S28], [S20], [S21], [S2] |
| D5 | Couriers or aggregators forbid a different sender name on a label | No restriction found in Mengantar terms or help center; Mengantar, Shopee and KiriminAja document sender-name features. J&T terms could not be fetched (HTTP 418) and the Lion Parcel article body did not render. | Unknown for JNE, J&T, Lion Parcel; section 3. |
| D6 | Pickup is unavailable at low volume | Tokopedia (marketplace policy, SiCepat and "Kurir Rekomendasi" only) requires at least 125 orders in 30 days for pickup. JNE's own FAQ states no minimum. The search tool's claim of JNE corporate thresholds of Rp3,000,000 to Rp5,000,000 a month was not on the JNE page. | Pickup minimums are policy-specific; **no minimum was found for Mengantar** (Unknown). [S36], [S37] |

## 2. Courier-aggregator discount mechanics

### 2.1 How discounts are generally structured and communicated

Observed across vendors (T2):

- **Volume tiers published as "mulai X%"** (Mengantar: from 20% up to 30% at more than 10,000 [S3], [S4]).
- **A threshold to become a higher class**, reviewed by the vendor (KiriminAja: more than 200 resi per month for "VIP" with cashback [S24]; Mengantar: proof of the last 30 days' transactions sent to live chat [S4]).
- **Flat per-courier promotions** with a "can change anytime" footnote (Komship [S28]).
- **A commission share the agent can configure** (AutoKirim [S20]).
- **Non-cash rewards**: points, vouchers (KiriminAja [S24]).
- **Referral commission** separate from shipping discounts (KiriminAja [S23]).

Observed communication pattern: headline percentage first, conditions second, "may change" last; headline numbers across pages of the same vendor can disagree (Komship hero "hingga 50%" versus metadata "mulai dari 25%" [S28]).

### 2.2 What Mengantar documents

| Statement | Source |
|---|---|
| "Diskon Ongkos Kirim Mulai 20%", applies to COD and non-COD; steps 2,500-5,000 → 22.5%, 5,000-7,500 → 25%, 7,500-10,000 → 27.5%, "Lebih dari 10.000" → 30% | Observed, T1 help page (undated) [S3] |
| Terms page (modified 2023-12-29): 0–2,500 → 20%; 2,501–5,000 → 22.5%; 5,001–7,500 → 25%; 7,501–10,000 → 27.5%; more than 10,000 → 30%. "Jika pengirimanmu lebih dari 2.500 setiap bulannya, setelah mendaftar, kirimkan bukti jumlah transaksi 30 hari terakhirmu ke live chat … setelah divalidasi … diskon awalmu akan dinaikkan." | Observed, T1 [S4] |
| Inference from the two pages: the unit is shipments per month and the step is applied on request with proof, per account | Inference |
| `/allEstimatePublic` has a fixed discount: "Discount is always 20% for all users"; the account-bound estimate uses "Discount calculation is based on user's shipping volume, refer to Diskon Ongkos Kirim" | Observed, T1 [S2] |
| The flat estimate returns "standardized prices with Mengantar's markup and discount structure applied"; the 3PL estimate returns "raw courier rates without Mengantar markup or discount" | Observed, T1 [S2] |
| Sandbox example fields `discountPercent: 20`, `discountExtraPercent: 0`, `estimatedSpecialPrice` | Observed, T1 [S2] |
| COD fee "3% serta pajak pertambahan nilai (VAT) sebesar 11%" | Observed, T1 [S5]; the terms page also says "Fee COD 3%" [S4] |
| A partner-registered seller has "a normal Mengantar seller account in their own name"; "every order created with it is that seller's order, at that seller's rates" | Observed, T1 [S1] |
| Return shipping: only the discounted outbound fare is charged for returns on most couriers; SPX "RTS ongkir PP tidak bayar sama sekali" | Observed, T1 [S6] |

### 2.3 What Mengantar does not document (Unknown)

Keyword search of the Partner page and the Public API page, run again on 2026-10-28 (read-only fetch, text search): `cashback`, `commission`, `komisi`, `rebate`, `revenue`, `profit` return zero hits on both. `payout` appears once in the Public API page, inside a sandbox note that simulations never trigger "COD payout". `margin` returns zero. [S1], [S2]

| Question | Status |
|---|---|
| Does Mengantar pay a partner any cashback, commission or revenue share? | **Unknown.** Not documented on either page; no evidence either way outside them. Do not assume it exists. |
| Does a partner-registered seller start at 30%, or at the default 20%? | **Unknown.** The only observed partner-seller values are the sandbox `discountPercent: 20`. |
| Can a partner set or change a per-seller discount? | **Unknown.** No such endpoint or sentence. |
| Are a partner's sellers pooled for volume steps? | **Unknown.** The terms page speaks of "pengirimanmu" (the user's own shipments). |
| What are the unit and period of the steps? | Probably monthly per account (Inference from [S4]); the help page states neither [S3]. |
| Is the help-center page current? | The same help center says Mengantar works "dengan JNE dan SiCepat" and has helped "lebih dari 500 seller" ([S3], [S9]) while [S6] lists nine couriers. The discount pages may be older than the courier list. Treat both as possibly stale. |

### 2.4 Arithmetic illustration (calculation, not a forecast)

Observed thresholds: 20% up to 2,500 shipments per month; 2,500 per month is about 83 per day over 30 days. Assumption: a typical pilot gerai ships far fewer than 83 parcels a day (no measurement exists).

Per Rp100 of normal tariff, at the 20% step: provider discount 20, gerai discount 20 (owner's starting term, CTX-42), platform remainder 0. At the 30% step: remainder 10 points, which DEC-016 says has no collection path in v1. This repeats CTX-42's risk and adds the Terms-page mechanism (step-up requires proof of 30-day volume, per account).

### 2.5 Counter-evidence

- Komship advertises 25% with no minimum and a per-courier table up to 40% for Ninja (Ninja is "discontinued 1 September 2026" in Mengantar's own docs [S2]; Komship's table may be stale) [S28]. A counter on a competing aggregator may therefore keep more than 20% from the first shipment. Comparability with Mengantar is Unknown because of the markup caveat in 2.2.
- AutoKirim's "Komisi Ongkir Mulai dari 25%" and "bebas atur porsi" [S20] is the model DEC-016 implements, at a stated rate higher than the owner's 20% gerai share.
- No source shows a platform-level cashback or revenue share from Mengantar. The owner's belief that "newest API supports it" (CTX-40) is not supported by the pages read.

## 3. Sender-identity masking on labels

### 3.1 Two meanings of "masking resi"

Observed: Indonesian sources use the phrase for two different things.

1. **Recipient-data censoring on the label.** Mengantar's "Jaga Privasi Pelanggan" / "Perlindungan Data Penerima" hides the recipient's name, phone and (except city and province) address on all label sizes with one toggle. [S10], [S11]
2. **Sender-identity substitution.** A dropshipper's or shop's name and phone appear instead of the real supplier's. DEC-017 is this meaning.

### 3.2 How common and how treated

| Actor | Observation | Source |
|---|---|---|
| Shopee | "Dropship di Shopee" lets a seller sell and ship "atas nama kamu"; the order shows dropshipper information; "Penjual atau produsen akan tahu jika pesanan dibuat oleh seorang dropshipper" (2022-09-02) | T1 [S35] |
| Mengantar Public API | A Dropshipper feature must be enabled in Seller Web; "The canonical name and phone from the saved master become the shipment and label sender identity. The pickup address remains the seller address"; the order must carry a saved dropshipper reference | T1 [S2] |
| KiriminAja | "Alamat Pengirim" stores a sender name and phone per saved address; benefit stated "terutama untuk para dropshipper" (updated 2026-09-29) | T2 [S26] |
| Lion Parcel | Has an article titled "Kirim sebagai Dropshipper"; the body did not render in this session | Unknown [S39] |
| Prevalence (share of shipments using a substituted sender) | No statistic found | Unknown |

Conclusion: sender substitution is a recognized feature at a marketplace, at Mengantar and at an aggregator. In each documented case it is **entered into the provider's own system**, so the courier's data and the label agree. CTX-5 already records the Mengantar dropshipper behaviour and that "no account-specific request or printed-label test was executed".

### 3.3 Rules that touch a different sender on a label

- Mengantar Terms (modified 2023-12-29): no clause about sender name or label content. General clauses: account moderation and suspension, balance freeze on suspected fraud, withdrawals can be examined or frozen, and a clause that the user agrees not to use, modify, copy, "menjual kembali" or otherwise exploit the software, hardware, network or data of the site/app by automated or manual means without Mengantar's permission (B.5). Whether B.5 reaches a reseller platform operating under a Partner agreement is a question for counsel; the Partner agreement text is not available. [S4]
- Mengantar help, "My Address": hiding the sender address is allowed but "Hanya sembunyikan alamat jika terpaksa. Karena … jika terdapat alamat di parcel maka akan memudahkan kita dalam melakukan return." [S7]
- Mengantar fraud page: examples of misuse include shipping goods the recipient did not order by COD, mass use of invalid recipient contacts, fictitious orders and "gestun"; a proven violation can mean a 90-day review with withheld funds. It says orders, recipient data and claims must match "aktivitas sebenarnya". [S8]
- SPX terms (the courier's own account terms, not Mengantar's): shipper must give "Instruksi Pengiriman lengkap, benar, dan akurat" (5.3(a)); returns go to the address in the shipping instruction unless the shipper notifies SPX in writing (5.2(d)); an expired or wrong return address can lead to disposal at the shipper's cost (5.2(e), (f)); prohibited goods are the shipper's responsibility and are excluded from claims (5.3(e), 8.6(b)). [S38]
- JNE, J&T and Lion Parcel account terms: **Unknown** (J&T fetch failed; others not read).
- No Mengantar or courier text found says a gerai may not print a label showing a different sender; none says it may. **Unknown.**

### 3.4 Partner responsibility: what the Partner document implies

Observed, T1 [S1]: "No OTP, no captcha, and no identity verification: the account can create orders straight away, because you answer for who your users are." And: "Because the sellers you register skip identity verification, Mengantar treats their behaviour as your responsibility under your agreement. Mengantar can still restrict or verify an individual seller, and can switch off partner access entirely, if shipments from your platform turn out to be fraudulent or prohibited."

Implications (Inference unless stated):

1. GeraiExpress is the accountable party toward Mengantar for what every tenant ships. The Partner agreement text is not available; the contractual liability is **Unknown**.
2. The blast radius is the whole platform. `PARTNER_DEACTIVATED` stops new registration; existing sellers "keep working" per [S1], but Mengantar may still "switch off partner access entirely" for fraud. One bad tenant can therefore threaten all tenants.
3. A locally printed label that hides the pickup name reduces the courier's and recipient's ability to see who is accountable on the physical parcel. The provider's own record still carries the Mengantar seller and the pickup name (Inference: DEC-017 does not change the provider-side record). In a dispute the evidence is split between the physical label and the provider record.
4. Proposal (not a decision): per-shipment audit of the sender identity printed, per-tenant declaration of prohibited goods and acceptance of liability, tenant-owner identity capture (Mengantar does none), a per-tenant suspension control, and evidence retention for claims. These are design suggestions that follow from points 1 to 3.

### 3.5 Operational risks

| Risk | Observed basis | Label |
|---|---|---|
| Returns (RTS) go to the provider's pickup or return address, not to the masked sender | [S6], [S10] (return address feature exists for JNE, SiCepat, SAP, Java only); [S38] (SPX) | Observed; counter handling of returned parcels is an operating need |
| A courier hub or driver cannot match the label to the shipper | No source states courier acceptance of a locally printed label with a Code128 AWB; DEC-017 says it decodes to the AWB | **Unknown** (needs a physical test) |
| Claims | Mengantar claim exclusions and evidence rules (3-day report window, unboxing video, packing standard) [S13]; SPX excludes prohibited goods [S38] | Observed |
| Disputes over who sent the parcel | Recipients may refuse a parcel from an unknown sender name; Mengantar's own advice is to keep the address visible [S7] | Observed advice, Inference on disputes |
| Fraud and prohibited goods | [S8], [S1], [S38]; responsibility sits with the sender and, for Mengantar, with the partner | Observed |
| False personal data | UU PDP Art. 66 and Art. 68 (creating or falsifying personal data to benefit oneself or another and cause loss to a person) [S40]. An operator who types a fictitious sender or a real person's name without authority could fall near this. Whether truthful shop identities are safe: counsel. | Observed text; application is a lawyer item |

### 3.6 Counter-evidence

- The masking feature itself is mainstream (Shopee, Mengantar, KiriminAja) and not restricted by any text read. The weak point is narrower: **DEC-017 keeps the provider's data as pickup name and prints something else locally, and refuses the provider's dropshipper feature.** Every documented market example enters the substituted identity in the provider's system. That difference is where evidence is absent.
- Mengantar's own guidance prefers visible sender address for returns [S7].
- The label PDF is outside the standard key permissions (create order, check status, check fee, check balance) [S1], which supports DEC-017's decision not to depend on it; it does not show that couriers accept a local label.

## 4. Regulatory and policy context (official sources only)

**Not legal advice. Research for the owner and qualified counsel to verify.** Texts below were read from the official PDF or portal where the register says so; secondary commentary is flagged and not relied on.

### 4.1 Personal data protection (UU 27/2022)

Observed from the official PDF [S40]:

- Applies to every person, public body and international organization acting in Indonesia (Art. 2(1)); not to personal or household processing (Art. 2(2)).
- "Data Pribadi" is data about an identified or identifiable person, also in combination (Art. 1(1)); general data includes full name and "data yang dikombinasikan untuk mengidentifikasi seseorang" (Art. 4(3)). Sender and recipient name, phone and address are personal data under that definition (Inference).
- Controller: decides purposes and controls processing (Art. 1(4)); processor: processes on behalf of a controller (Art. 1(5)).
- A lawful basis is required (Art. 20): explicit consent; performance of a contract; legal obligation; vital interests; public interest; or other legitimate interests balanced against the data subject's rights. Consent requires prior notice of legality, purpose, data types, retention, processing period and rights (Art. 21).
- Controller duties: security measures and a security level matched to risk (Art. 35); confidentiality (Art. 36); supervision of everyone involved in processing under its control (Art. 37); prevent unauthorized access with a "reliable, safe and accountable" system (Art. 39); accountability (Art. 47).
- Breach: written notice within 3 x 24 hours to the data subject **and "lembaga"** with what was disclosed, when and how, and the remedy (Art. 46).
- Processor: acts on controller's instructions; written approval before engaging a sub-processor; processing outside instructions becomes the processor's responsibility (Art. 51); security and confidentiality duties also bind the processor (Art. 52).
- Data protection officer required in listed cases, including large-scale regular systematic monitoring and large-scale specific data (Art. 53(1)).
- Cross-border transfer: equivalent protection, else binding safeguards, else data-subject consent (Art. 56(2)-(4)).
- Administrative sanctions up to 2% of annual revenue (Art. 57(3)); criminal provisions for unlawful acquisition, disclosure, use and falsification (Art. 65-68).
- Transition: two years from promulgation on 2022-10-17 (Art. 74), so the obligations apply now.

Open facts (Unknown or needs counsel):

- **Roles.** Assumption: each tenant is a controller of its customers' data; GeraiExpress is a processor for tenant data and a controller for its own account and operations data; Mengantar is a separate controller. This is not confirmed.
- **Lawful basis for recipients** who never deal with GeraiExpress. Inference: contract performance with the sender (Art. 20(2)(b)) plus legitimate interest (20(2)(f)); consent from recipients is not practical.
- **The supervisory body.** On 2026-07-27 Komdigi told the Constitutional Court that the draft presidential regulation creating the Badan PDP had been submitted to the President on 2026-05-20, and that "belum ditetapkannya kedua peraturan" (the presidential regulation and the Art. 61 government regulation) is not a legal vacuum; Komdigi's directorate performs the function meanwhile. [S41] Consequence: to whom Art. 46 notice should go is a lawyer question.
- **Government regulation numbered "PP 33/2026".** A commercial legal database lists "PP 33/2026 Peraturan Pelaksanaan UU PDP", dated 2026-07-16 and effective 2027-01-16, and several law-firm pages repeat it. I could not confirm it on an official portal (JDIHN fetch failed with a TLS error; the BPK search was not productive). Whether it conflicts with the 2026-07-27 Komdigi statement or is a different instrument is **Unknown**. Counsel must check it on the official gazette. [S42]
- **Cross-border.** The hosting regions of Cloudflare, Supabase and the Vultr gateway are an architecture fact the DEC-011 design must record; transfer analysis (Art. 56) is a lawyer item.

Proposal (not a decision): a minimal personal-data register (what sender and recipient fields are kept, where, how long), a breach runbook that can meet 3 x 24 hours, and a processor agreement template for tenants. Mengantar's own censoring toggle [S10] shows the market treats minimizing recipient data on labels as ordinary.

### 4.2 Electronic system provider registration (PSE)

Observed from Permenkominfo 5/2020, official text [S43]:

- "Setiap PSE Lingkup Privat wajib melakukan pendaftaran" (Art. 2(1)) before the system is used by users (Art. 2(3)). Covered systems include those used to "menyediakan, mengelola, dan/atau mengoperasikan penawaran dan/atau perdagangan barang dan/atau jasa" (Art. 2(2)(b)(1)) and for "pemrosesan Data Pribadi untuk kegiatan operasional melayani masyarakat yang terkait dengan aktivitas Transaksi Elektronik" (Art. 2(2)(b)(6)). Inference: a multi-tenant shipping-counter service that processes customers' personal data plausibly falls within the second item. Counsel to confirm.
- Registration is through OSS (Art. 3); the form covers the system overview, information security, personal data protection and system worthiness (Art. 3(3)).
- Unregistered PSE: access blocking (Art. 7(2)). Failure to report changes or wrong information: written warning, temporary suspension, then blocking and revocation after 7 days without confirmation (Art. 7(3)). Normalization after compliance (Art. 7(4)-(5)).
- Duties: Indonesian-language usage instructions (Art. 9(2)); ensure the system does not contain or facilitate prohibited information (Art. 9(3)); prohibited classes are information that violates law, "meresahkan masyarakat dan mengganggu ketertiban umum" (as set by ministries) and information on how to access prohibited content (Art. 9(4)-(5)); takedown duty (Art. 13); a PSE with user-generated content needs governance rules and a public reporting channel (Art. 10); law-enforcement access to traffic data and subscriber information through a named contact (Art. 36).
- Normalization of a blocked system needs a written request, identity scans, evidence the content is gone, a recommendation from an authority or a court decision, with the ministry acting within 2 x 24 hours; it may refuse after more than 3 blockings (Art. 20).
- Initial deadline of 6 months from 2020 (Art. 47) has passed.

Status unknowns: whether Permenkominfo 10/2021 changed these articles (it appears only as the amending instrument named in a Kompas.id article title in search results; its text was not opened), and whether the rule has since been replaced. A secondary source says a 2025 ministerial regulation covers only the public sector; not verified. **Whether GeraiExpress, owner.geraiexpress.com, app.geraiexpress.com, the webhook host and the marketing site are registered: Unknown.** No repository `.md` mentions a PSE registration (text search for "PSE Lingkup", "tanda daftar PSE", "pse.komdigi", 2026-10-28).

### 4.3 Brand and keyword filtering (the blocked-keyword policy)

Context, Observed in the repository: T-029 rebuilt the marketing pages as a "Komdigi-clean" standalone brand, and a unit test requires zero occurrences of a blocked keyword in `src/` and `public/`. CTX-10 records that the legacy site was reported as possibly blocked by Komdigi, with status **Unknown**: root cause and current status are unverified, and a dated ISP DNS record is not an official blocking determination.

Observed in the regulation text [S43]: there is **no published list of keywords or brand names**; a text search of the regulation for "kata kunci" and "keyword" returns nothing. The access-blocking triggers in the text are non-registration (Art. 7), failing the prohibited-content duties (Art. 9(6)) and failing takedown duties (Art. 13). Prohibited class (b) is determined by the relevant ministry "sesuai dengan ketentuan peraturan perundang-undangan" (Art. 9(5)), which means a determination outside this text.

Therefore:

- The repository's keyword policy is a precaution. **Whether Komdigi blocks sites by brand or keyword, and which keyword, is Unknown.** Nothing read shows the policy is legally required or effective.
- Nothing read restricts a company from filtering its own repository for a keyword. No trademark or unfair-competition source was researched; if the blocked word or the legacy brand is also a third party's mark, that is a separate lawyer item.
- Related legal duty: if tenants can enter free text that appears to other users (names, notes), the UGC rules in Art. 10 may apply (Inference).

### 4.4 COD and customer funds: is OJK or Bank Indonesia licensing triggered when the platform does not hold funds?

Observed from the official Bank Indonesia regulation on payment service providers (PBI 23/6/PBI/2021) [S44]:

- A payment service provider (PJP) is a bank or non-bank "yang menyediakan jasa untuk memfasilitasi transaksi pembayaran" (Art. 1(4)). A "Penyelenggara Penunjang" supports a PJP technically (Art. 1(6)).
- "Payment initiation dan/atau acquiring services" cover forwarding payment transactions, including forwarding payment instructions or "data transaksi pembayaran", acquiring merchants, advancing payment and "meneruskan dana (disbursement)" to providers of goods or services (Art. 4).
- A Penyelenggara Penunjang may operate only if control of payment processing stays with the PJP, it provides only technical support, and it "tidak diperbolehkan mengakses dan/atau menatausahakan Sumber Dana" (Art. 9).
- The payment-system regulator in this text is Bank Indonesia. The boundary of OJK's role was not verified from an official text in this session (the BI licensing page did not render). **OJK licensing triggers: Unknown**, other than the observation that the PJP regime above is Bank Indonesia's.

Facts of the product (Observed in repository decisions and Mengantar documents): the sender pays the gerai; the gerai's Mengantar balance pays non-COD fares; Mengantar "will hold the money from their COD shipments" and the seller withdraws it ([S1], [S12], [S4]); GeraiExpress collects no platform fee and builds no platform ledger in v1 (DEC-016).

Inference (counsel to confirm): while GeraiExpress never receives, holds, forwards or disburses money belonging to others and does not forward payment instructions, nothing in the PBI text read describes an activity it performs, so no PJP authorization appears to be triggered. Boundaries where the answer could change:

1. **A future settlement path** that collects the platform remainder from gerai. Collecting own service revenue into GeraiExpress's own account is distinct from holding others' funds, but the line needs counsel.
2. **Any top-up or COD funds** passing through a GeraiExpress account or virtual account.
3. **Forwarding COD amounts** to Mengantar as an order field. Art. 4(2)(b) mentions "penerusan data transaksi pembayaran". Inference: an order parameter is not payment-instrument data, but this is the sentence counsel should read first.
4. **Counterparty status:** whether Mengantar holds the licences its balance and withdrawal service needs is Unknown and is Mengantar's obligation, but it is a counterparty risk for DEC-012.
5. **Insurance (PR-3, deferred):** selling insurance would raise insurance-distribution rules; not researched. Keep deferred.

### 4.5 Consumer protection and advertising of price or commission claims

Observed from UU 8/1999 [S45]:

- Consumers have a right to "informasi yang benar, jelas, dan jujur" (Art. 4(c)).
- A business may not offer or advertise services "secara tidak benar" or as though they carry a discount or special price (Art. 9(1)(a)); may not make untrue or misleading statements about price or tariff or about "tawaran potongan harga" (Art. 10(a), (d)); may not advertise a special price in a limited time or quantity without intending to honour it (Art. 12).
- Advertisers may not make advertisements that mislead about price or tariff or contain wrong information (Art. 17(1)(a), (c)).
- Penalties: up to 5 years or Rp2,000,000,000 for Art. 9, 10 and 17(1)(a)-(c) and (e) breaches; up to 2 years or Rp500,000,000 for Art. 12 and 17(1)(d), (f) (Art. 62). Additional penalties include an order to stop an activity and revocation of a business licence (Art. 63).

Application: the existing rule that public marketing may state no percentage until provider-verified (CTX-39, DEC-012) is consistent with these articles. Whether a gerai buying a B2B service counts as a "konsumen" under the Act, and how UU ITE Art. 28(1) (false information causing loss in electronic transactions) applies, were **not researched** here: **Unknown / lawyer.** The Ministry of Trade is revising its e-commerce regulation (Permendag 31/2023) to require platforms to disclose all fees to merchants (detikFinance, 2026-05-06) [S34]. GeraiExpress is not a marketplace (Assumption), so applicability is Unknown.

### 4.6 Counter-evidence for the regulatory section

- No official source read says a shipping-counter software platform needs a licence beyond PSE registration and data protection compliance; that absence is not proof of none.
- Secondary commentary reports implementing rules and agency steps moving quickly in 2026; the primary text read here is from 2020 and 2022, so newer instruments may change the answer. Two items above are explicitly unreconciled (PP numbered 33/2026; the Badan PDP).
- Search-tool answers that stated confident rules (floor prices for couriers, specific penalties for label masking) had no matching official text and were discarded (section 7).

### 4.7 Items that need a lawyer

| # | Item | Why |
|---|---|---|
| L1 | Role mapping under UU PDP (tenant, GeraiExpress, Mengantar) and the lawful basis for recipient data | Determines duties and who gives notice |
| L2 | Breach notice target while the Badan PDP is not established; status and content of the government regulation numbered 33/2026 | Art. 46 cannot be met without it |
| L3 | PSE Lingkup Privat registration: whether required, which domains, current text after Permenkominfo 10/2021 and any replacement | Failure leads to access blocking (Art. 7(2)) |
| L4 | UGC duties under Art. 10 for free-text tenant fields | Governance and reporting channel |
| L5 | Cross-border transfer analysis for the hosting split (DEC-011) | Art. 56 |
| L6 | Whether any future settlement path or top-up triggers a Bank Indonesia PJP licence; reading of PBI Art. 4(2)(b) | Boundary of "not holding funds" |
| L7 | Review of the Mengantar Partner agreement: liability for tenant behaviour, resale of the service (Terms B.5), data processing terms, sender-label rights | The agreement text is not in the repository |
| L8 | UUPK and UU ITE application to pricing and commission claims to gerai (B2B) and to senders | Marketing and onboarding copy |
| L9 | Personal-data falsification exposure (Art. 66/68) for operator-entered sender identities | Masking design |
| L10 | Trademark or other risk if the filtered keyword or legacy brand is a third party's mark | Blocked-keyword policy |
| L11 | Tax: VAT or income-tax treatment of the platform remainder if later collected | Not researched |
| L12 | Whether a gerai receiving parcels from the public needs any postal-agent authorization of its own | Not researched |

## 5. Pickup reality

### 5.1 Documented by Mengantar

Courier-by-courier statements from the Mengantar logistics help page (times are WIB) [S6], [S5]:

| Courier | Same-day pickup cut-off | Pickup SLA stated | Drop-off |
|---|---|---|---|
| JNE | 15:00 | 7 days | Branch only; "tidak dapat didrop ke agen" |
| SiCepat | 12:00 | 7 x 24 hours | Any SiCepat gerai or point |
| SAP | 15:00 | 3 failed pickups | SAP branch |
| iDexpress | 11:00 | 14 days after a failed pickup | iDexpress branch |
| J&T | 12:00 | 7 days | Any J&T drop point |
| Lion Parcel | 15:00 | 7 days | Lion agent |
| Anteraja | 15:00 | 7 days | **Pickup only**; a manual drop means a return goes to the dropping agent |
| Pos Indonesia | 16:00 | 7 days | Any post office |
| SPX | 15:00 | 14 days | Gerai that accepts; must be scanned or a receipt signed; on return the shipper must collect the parcel |

Mengantar also says all parcels are better picked up than dropped, that the first one or two pickup requests can be late ("kendala yang kadang terjadi pada request pickup untuk pertama atau kedua kalinya"), and offers a "Pickup Assistance" ticket, usually answered within 30 minutes [S5].

API constraints [S2]: pickup type `scheduledPickup` or `dropOff`; a scheduled pickup needs a time record for a saved address; slots are hourly 09:00 to 18:00; the schedule must be at least 90 minutes ahead; the volume class is `volumeMotor`, `volumeMobil` or `volumeTruck`; SPX validates the slot against SPX's live slots and accepts `dropOff` only if SPX Drop Off is enabled for the account; a Pos Indonesia scheduled pickup needs the address pinpoint (latitude and longitude).

Minimum volume for pickup: **no minimum found in Mengantar documents (Unknown).**

### 5.2 Documented elsewhere

- JNE FAQ: pickup requested through customer service; operation 24/7; the officer comes at most 90 minutes after the ready time; pickup without a partnership is possible with cash or transfer [S37].
- Tokopedia Care: from 2023-10-01, for SiCepat and "Kurir Rekomendasi", a seller needs at least 125 orders in the last 30 days to request pickup, otherwise drop-off to a gerai. This is a marketplace policy, not a courier rule [S36].
- Vendors say pickup needs no minimum parcel count (Fastpay [S21], Komship [S28]) and the counter flow is "customer hands parcel in, courier collects at the counter" (Fastpay [S21]). T2 claims.
- A third-party article says some couriers set a minimum parcel count for pickup [S30]; no courier source was found for that statement.

### 5.3 How counters use pickup versus drop-off

No source gives the split among counters. **Unknown.** Observed: vendors market free pickup at the counter as a benefit [S20], [S21], [S28], so pickup is common in the multi-courier counter offer rather than a differentiator.

### 5.4 Counter-evidence

- Where the drop-off is poor, pickup is the only workable path on Mengantar: JNE accepts no agent drop and Anteraja accepts no drop at all [S6]. That supports making pickup a launch requirement.
- Against: cut-offs range from 11:00 to 16:00 and first-time pickups are described as unreliable [S5]; a counter with a late-afternoon rush loses same-day dispatch for some couriers.
- Tokopedia's threshold shows couriers can condition pickup on volume; whether any courier does so for a Mengantar seller is not documented.

## 6. What this research changes for the product

Verdict scale: **Supports**, **Weakens**, **Mixed**, **Unproven** (evidence neither confirms nor refutes). Each row names the single cheapest next verification.

| Item | Verdict | Why (evidence) | Cheapest next verification |
|---|---|---|---|
| DEC-014 Keep GeraiExpress as foundation and port selected legacy modules (pickup, cancel, webhook and tracking, `pay-unpaid`, masked label and invoice, settlement, CSV, wilayah, ops kit) | **Unproven** (partly supports the feature list) | Pickup, label printing, tracking and a balance view appear in several competitor offers, so those modules look like table stakes ([S20], [S21], [S28]). Market sources cannot test the build-versus-convert choice. One internal observation: DEC-014 lists "settlement" as a ported module while DEC-016 says no platform ledger is built in v1. | Lead reads DEC-014 and DEC-016 side by side and states which "settlement" scope T-042..T-047 covers. |
| DEC-015 Hosts: owner = Super Admin only, app = gerai only, apex public, webhook host separate | **Unproven** | Not a market question. Regulatory side: PSE registration is per system and the form asks about information security and data protection ([S43]); nothing read contradicts a host split. Whether each host must be listed in the PSE registration is Unknown. | Ask counsel or the PSE registration portal whether subdomains need separate entries (one question, answered in writing). |
| DEC-016 Pricing: sender pays full tariff; gerai discount is configuration; remainder derived; block gerai discount above provider-observed; no platform fee or ledger in v1 | **Mixed.** Direction **supports**; commercial terms **weakens** | The spread model is how competitors describe counter earnings ([S20], [S28]). Blocking a gerai discount above the provider's is consistent with the advertising-accuracy duties in UU 8/1999 Art. 9 and 10 (Inference). But Mengantar's default and sandbox value is 20%, and 30% needs more than 10,000 shipments per month with proof ([S2], [S3], [S4]); at 20% the platform remainder is 0 and the gerai gets no more than the provider gives. Komship and AutoKirim publish 25% or more ([S28], [S20]). | One written answer from Mengantar to the four questions in CTX-42, plus recording `discountPercent` from the first real partner-seller estimate. |
| DEC-017 Masking: local 10x15 label with Code128 to AWB; switch for gerai identity or operator-entered sender; no provider dropshipper | **Mixed.** Demand direction **supports**; the local-only design is **unproven and weakly supported** | Sender substitution is mainstream ([S35], [S2], [S26]) and no text read forbids it. Every documented example is entered in the provider's system; DEC-017 does not. No source says a courier hub accepts a locally printed label (CTX-5 notes that no printed-label test has been run). Mengantar warns that hiding the address hurts returns ([S7]). UU PDP Art. 66/68 makes truthful sender data important. | Send one real parcel per courier with the masked label through the pilot gerai (drop-off for SiCepat, J&T, Pos; pickup for JNE, Anteraja) and record scan, delivery and a simulated return in the sandbox. |
| CTX-39 Target market: offline gerai; one dashboard; pilot run by owner; ~50 tenants; pickup and masking as differentiators | **Mixed** | Supply side proves the offer exists and is contested by at least four vendors ([S20]-[S22], [S30]). Counter profitability is unmeasured and contested by anecdote ([S32]). Pickup is common, not a differentiator ([S20], [S21], [S28]). Masking as a differentiator for counters is untested. 50 tenants is an Assumption. | Pilot gerai logs four weeks of counter transactions (parcels per day, tariff, discount, share of shipments using masking). |
| CTX-40 Mengantar documents no cashback or revenue share | **Supports** (as an observation) | Re-run on 2026-10-28: both pages return zero hits for `cashback`, `commission`, `komisi`, `rebate`, `revenue`, `profit` ([S1], [S2]). Not proof the capability does not exist outside the pages. | Same written question as CTX-42 (item 4: does Mengantar pay a partner a rebate, and how is it settled). |
| CTX-41 Hosts and tenant naming (hosts accepted; proposals 11 to 17 open) | **Unproven** | As DEC-015. Proposal 11's reserved names and "blocked marketing keyword" rest on the keyword precaution in 4.3, which has no official basis found. | Same as DEC-015; separately decide whether the keyword rule stays as a precaution. |
| CTX-42 Owner starting terms: provider 30%, gerai 20%, remainder 10 points; Mengantar steps 20 to 30% | **Weakens** the 30% assumption | Terms page: above-20% requires proof of volume over 2,500 per month and a request; sandbox shows 20; the public estimate is fixed at 20% ([S4], [S2]). No source says a partner seller starts at 30%. The provider facts in CTX-42 are re-confirmed and extended by the Terms-page mechanism. | Same written Mengantar answer as DEC-016. |

## 7. Evidence discipline: what was not verified or was rejected

Could not read or verify:

- J&T terms (HTTP 418), the Lion Parcel dropshipper article body (not rendered), the Bank Indonesia licensing page (not rendered), the JDIHN record for the government regulation numbered 33/2026 (TLS error), UU ITE 1/2024 text (not opened), Permenkominfo 10/2021 text (not opened), the Mengantar Partner agreement and Terms/Privacy links (not in the repository).

Search-tool (T4) claims not found at any page read and not used:

- Aggregator cashback "25% to 35%" followed by cuts; a ministerial regulation setting courier "floor prices"; agent commissions "15% to 25%" falling to "Rp1,000 to Rp2,500" flat; mass drop-point closures; JNE corporate pickup threshold of Rp3,000,000 to Rp5,000,000 a month; J&T VIP pickup minimum of 10 to 20 parcels a day; criminal-liability citations for masking labels. Where a figure appears in this note it comes from a page named in the register.

## 8. Source register

All accessed 2026-10-28. Dates in brackets are the date shown on the page, not the access date.

| ID | Source | Tier |
|---|---|---|
| S1 | Mengantar Partner API documentation (private, noindex) https://sandbox.mengantar.com/docs/partner/ | T1 |
| S2 | Mengantar Public API documentation https://sandbox.mengantar.com/docs/ | T1 |
| S3 | Mengantar help, "Apa Kelebihan Mengantar?" https://help.mengantar.com/id/articles/5207011-apa-kelebihan-mengantar | T1 (undated; possibly stale) |
| S4 | Mengantar Terms & Conditions https://www.mengantar.com/terms/ [modified 2023-12-29] | T1 |
| S5 | Mengantar help, "Hal Dasar Sebelum Membuat Pesanan" https://help.mengantar.com/id/articles/5109199-hal-dasar-sebelum-membuat-pesanan | T1 |
| S6 | Mengantar help, courier comparison https://help.mengantar.com/id/articles/5502313-jne-sicepat-sap-idexpress-jandt-lion-parcel-anteraja-pos-ind-dan-spx | T1 |
| S7 | Mengantar help, "My Address" https://help.mengantar.com/id/articles/5111079-my-address | T1 |
| S8 | Mengantar help, "Kenali Aktivitas Fraud dan Penyalahgunaan Layanan Mengantar" https://help.mengantar.com/id/articles/14715377-kenali-aktivitas-fraud-dan-penyalahgunaan-layanan-mengantar | T1 |
| S9 | Mengantar help, "Kepercayaan & Keamanan" https://help.mengantar.com/id/articles/5134664-kepercayaan-and-keamanan | T1 (possibly stale) |
| S10 | Mengantar help, update post covering KYC for bank change, return address, recipient data protection https://help.mengantar.com/id/articles/13346863-yang-baru-di-mengantar-verifikasi-kyc-rekening-sensor-nama-and-nomor-buyer-di-label-resi-and-lainnya | T1 |
| S11 | Mengantar help, "Cara Mengaktifkan Fitur Jaga Privasi Pelanggan" https://help.mengantar.com/id/articles/12877793-cara-mengaktifkan-fitur-jaga-privasi-pelanggan | T1 |
| S12 | Mengantar help, "Balance" https://help.mengantar.com/id/articles/5111267-balance | T1 |
| S13 | Mengantar help, "Yang Belum Dapat Diajukan Klaim" https://help.mengantar.com/id/articles/6046101-yang-belum-dapat-diajukan-klaim | T1 |
| S20 | AutoKirim agent page https://autokirim.com/daftar-agen | T2 |
| S21 | Fastpay "Bisnis Ekspedisi" page https://www.fastpay.co.id/lp/bisnis-ekspedisi/ [modified 2024-07-25] | T2 |
| S22 | Everpro "Mitra Offline" page https://everpro.id/service/shipping/mitra-offline/frenchise-ekspedisi/ [modified 2026-03-24] | T2 |
| S23 | KiriminAja "Ajak Kirim" affiliate page https://kiriminaja.com/referral | T2 |
| S24 | KiriminAja blog, VIP and regular member benefits https://kiriminaja.com/blog/benefit-member-vip-reguler-kiriminaja [2024-03-05] | T2 |
| S25 | KiriminAja help, pick up and drop off https://help.kiriminaja.com/article/apa-itu-pickup-dan-dropoff-cashless [2025-12-31] | T2 |
| S26 | KiriminAja help, "Cara Atur Alamat Pengirim di Dashboard Baru" https://help.kiriminaja.com/article/cara-atur-alamat-pickup-paket-melalui-dashboard [2026-09-29] | T2 |
| S28 | Komship home page https://komship.id/ | T2 |
| S29 | OnOrder shipping page https://www.onorder.id/shipping | T2 |
| S30 | Kurir Pedia, "Beda Drop Point, Pickup, dan Agen Ekspedisi" https://kurirpedia.com/artikel/beda-drop-point-pickup-dan-agen [2026-08-04, updated 2026-10-17] | T2/T3 |
| S31 | ASPERINDO about page https://www.asperindo.id/tentang-kami/tentang-asperindo/ [updated 2025-11-25] | T1 (association, self-reported) |
| S32 | Kompasiana, first-person article on village agents https://www.kompasiana.com/bapriyanto/6ad425ec34777c12c3249fc2/jadi-agen-ekspedisi-di-desa-sepi-komisi-cekak-risiko-melimpah [2026-10-18] | T3 |
| S33 | Invlinic, blog on J&T agent income https://invlinic.com/rincian-penghasilan-agen-jnt/ [2025-09-12] | T3 |
| S34 | detikFinance, "Ramai Seller Ngeluh Gegara Ongkir Toko Online, Kemendag Buka Suara" https://finance.detik.com/berita-ekonomi-bisnis/d-8476747/ramai-seller-ngeluh-gegara-ongkir-toko-online-kemendag-buka-suara [2026-05-06] | T3 (news) |
| S35 | Shopee, "Cara Menjadi Dropship di Shopee" https://shopee.co.id/inspirasi-shopee/cara-menjadi-dropship-di-shopee/ [2022-09-02] | T1 (marketplace's own page) |
| S36 | Tokopedia Care, "Pengiriman Drop Off dan Pick Up" https://www.tokopedia.com/help/article/pengiriman-drop-off-dan-pick-up | T1 (marketplace policy) |
| S37 | JNE pick-up FAQ https://jne.co.id/pick-up | T1 |
| S38 | SPX Express terms of service https://spx.co.id/id/terms-of-service.html | T1 |
| S39 | Lion Parcel article "Kirim sebagai Dropshipper Artinya" https://lionparcel.com/info-seller/kirim-sebagai-dropshipper-artinya [2026-03-12]; body not rendered | n/a |
| S40 | UU 27/2022 official PDF https://peraturan.bpk.go.id/Download/224884/UU%20Nomor%2027%20Tahun%202022.pdf | T1 |
| S41 | Kompas.com, "Komdigi Ungkap Perpres Pembentukan Badan Perlindungan Data Pribadi Sedang Disusun" https://nasional.kompas.com/read/2026/07/27/15423511/komdigi-ungkap-perpres-pembentukan-badan-perlindungan-data-pribadi-sedang [2026-07-27] | T3 (news of an official statement) |
| S42 | Meridian Hukum, listing of "PP 33/2026" https://meridianhukum.com/peraturan/pp-no-33-tahun-2026 | T3 (commercial database); **unverified** |
| S43 | Permenkominfo 5/2020 official PDF https://peraturan.bpk.go.id/Download/197017/Nomor%205%20Tahun%202020.pdf | T1 |
| S44 | PBI 23/6/PBI/2021 official PDF https://peraturan.bpk.go.id/Download/213755/23.6.PBI.2021_penyedia%20jasa%20pembayaran.pdf | T1 |
| S45 | UU 8/1999 full text https://jdih.kemenkeu.go.id/api/download/fulltext/1999/8TAHUN~1999UU.htm | T1 |
| R1 | `DECISIONS.md` DEC-011..DEC-017 | repository |
| R2 | `docs/spec/CONTEXT-RECORD.md` CTX-38..CTX-42 | repository |
| R3 | `TASKS.md` T-029; `tests/unit/marketing-rebrand.test.ts` | repository |
