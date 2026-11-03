# GeraiExpress — Indonesia Market Gap Analysis and PRD Completion Breakdown

- Version: 2 (2026-11-02), corrected after an independent evidence audit (verdict PASS WITH FIXES; 13 Medium and 9 Low wording findings, all applied). Version 1 (same day) was a single-pass desk review; version 2 integrates five parallel research lanes whose full reports are kept as evidence in [`evidence/2026-11-02/`](evidence/2026-11-02/):
  - Lane A — [official data and regulation](evidence/2026-11-02/lane-a-official-data-regulation.md) (BPS, BI, PMK, PP, Permenkomdigi; T1 only)
  - Lane B — [competitor and courier-agent programs](evidence/2026-11-02/lane-b-competitors-agent-programs.md) (14 aggregator or seller tools and 10 courier programs reviewed; about 12 aggregator-style and 8 courier programs actually recruit counters; T1/T2)
  - Lane C — [public-surface extraction](evidence/2026-11-02/lane-c-blackmagic-public-surface.md) (black-magic: 14 Play listings, 396 reviews, public JS bundles, public tracking pages; no login, no writes, no live AWB lookups, no secrets reproduced; raw data kept outside the repository at `~/Documents/work/research/geraiexpress-2026-11/lane-c-raw/`)
  - Lane D — [Mengantar current facts vs repository](evidence/2026-11-02/lane-d-mengantar-current.md) (CONFIRMED / CHANGED / NEW / UNKNOWN per item)
  - Lane E — [operator and sender voice](evidence/2026-11-02/lane-e-operator-voice.md) (26 findings, top-10 pains, Bahasa Indonesia interview guide)
- Audience: Paduka Ongki (owner); input to `docs/spec/02-PRD.md` and the owner decision list.
- Scope: documentation only. No provider call, credential, code change or deployment. Lane reports are research evidence, not requirements.
- Authority: repository disk and executed checks > `ARCHITECTURE.md` > `DECISIONS.md` / `CONTEXT-RECORD.md` > `docs/spec/`. This note proposes; it decides nothing. Requirements it motivates enter the PRD as **Proposed** (PR-38 to PR-46).
- Builds on: [market and regulatory research, 2026-10-28](geraiexpress-market-and-regulatory-research.md) (S1–S43). Source IDs here: N-series (this note), A/B/C/D/E-series (lane reports; numbered findings inside each lane).
- **Not legal or tax advice.** Rows marked *Counsel* or *Tax owner* need a qualified person.

Labels: **Observed** (read at source or on disk), **Inference**, **Assumption**, **Unknown**, **Proposal**. Tiers: T1 official/regulator/provider docs; T2 vendor self-description; T3 third-party or first-hand anecdote; T4 search-tool synthesis (never evidence). Vendor numbers are vendor claims, never market facts.

---

## 1. Executive verdict

GeraiExpress is technically strong and commercially thin. Version 2 sharpens three conclusions and adds two new risks.

| Dimension | Verdict | Reason (evidence) |
|---|---|---|
| Engineering foundation | **Strong** | Tenant isolation, idempotent dispatcher, owned auth, 933 unit tests (56 files) and 432 DB tests per `STATUS.md`, three-viewport e2e; spec traceability PASS (section 2). Counter cashier roles with audit and duplicate-resi protection were not seen on any competitor counter page (B synthesis); KiriminAja has seller-team staff activity and shifts, which is a different model (C 2.1). |
| Core counter job | **Good, unproven live** | Built and sandbox-proven; no courier scan of the local label; no production order. |
| Counter-business completeness | **Weak, but the gap is also an opening** | Among the public surfaces read, no competitor combines counter receipt with quote-charge parity, cashier/shift close, Bluetooth thermal printing and a privacy-minimal tracking page (C 2.9; in-app features behind login were not checked). bosAgen (~1k installs) and SIMASRIM (~500 installs) come closest. |
| Competitive position | **Weak on price, open on trust** | About 12 aggregator-style and 8 courier programs recruit counters (B). GeraiExpress's 20% gerai share is at or below most headline rates (20–40%); some per-program or per-courier rates are lower (KirimAja SubConsole 10%, Paxel 9%, SIMASRIM 5–20% per courier). Among users of agent and seller-aggregator apps (mostly online sellers, not counter-specific), the loudest review complaints are money access, support and account locks, not commission (C 1.2). |
| Unit economics | **Zero platform revenue under current decisions** | Mengantar still publishes no partner, referral or rebate program (D 2). Default 20% minus gerai 20% = 0; DEC-016 collects no fee. |
| Regulation | **New concrete triggers** | Permenkomdigi 15/2025 defines KBLI 53202 *Aktivitas Agen Kurir*; Permenkomdigi 8/2025 Art 75 puts agents' liability under the operator; **Art 77 requires a QR on the resi containing sender and recipient name, address, phone, postcode, item and tariff** — a direct question for DEC-017's local masked label (A 23). PP 33/2026 (UU PDP implementing regulation) exists with a 3×24-hour breach notice (A 29). |
| Market evidence | **Still absent for the segment** | BPS covers only medium/large courier firms (15,848 warehousing+expedition+courier businesses, 2023); micro counters are outside the frame (A 1–2). Owner voices report falling walk-in volume and agent closures (E1–E4, anecdote). |

**New risks found in version 2:**

1. **DEC-017 vs Permenkomdigi 8/2025 Art 77** (A 23): the licensed operator must provide a QR on the resi carrying the sender's name and address. A locally printed label showing a different sender, with only a Code128 AWB, may not match the courier's record of the resi. Counsel and the courier scan test (T-048) must answer this before any masking claim. Return path: returns go to the provider pickup address, or to a configured return address only when origin and destination are both on Java (D 8); courier exceptions exist (Anteraja manual drops return to the dropping agent; SPX returns must be collected by the shipper, E15). In no case does a return go to the printed masked sender.
2. **Recipient-data exposure and COD scams (Inference).** Twelve of 177 negative reviews, mostly in seller apps, describe recipients receiving scam WhatsApp messages after shipping through an aggregator (C 1.2); lane C reads this as possible data leakage. Several competitor public tracking pages *map* full names, addresses, driver details or proof-of-delivery links in their client code (C 3; read statically, not verified with a live AWB). A GeraiExpress tracking page should be stricter than the field.

---

## 2. Repository review — what exists

Observed on disk (2026-11-02, HEAD `f8746c6`):

| Area | State | Pointer |
|---|---|---|
| Stack | Next.js 16.4.3 standalone container, PostgreSQL 17 + PostgREST, owned auth, Turnstile; Vultr + Coolify direction | DEC-020/021/022 |
| Workspace | Dashboard `/`, `pengiriman` (list, baru, detail, label, invoice, batch print), `kontak`, `anggota`, `pengaturan` | `src/app/(workspace)/**` |
| Platform | `admin` (overview, pengajuan, integrasi, diskon, tenant, akses, audit), TOTP | `src/app/admin/**` |
| Provider | Quotes, orders, two-pass COD, batch payment, pickup, Partner onboarding and key rotation, dispatcher with reconciliation | `src/lib/mengantar/**` |
| Spec governance | 16 spec files; traceability PASS | `docs/spec/`, `TASKS.md` |

Absent (scan of `src/`): payment-method field or QRIS record, cash/shift close, customer receipt (`invoice-content.ts`: "The invoice is a charge document, not a receipt"), public tracking page, customer WhatsApp share, content declaration, insurance, billable-weight calculation (dimensions are collected but sent neither to the estimate nor to create-order — `EstimateRequest` has no dimension field and the Public API has none (D 5) — and no local volumetric rule exists), claims, RTS state, low-balance warning, PWA manifest, Bluetooth printing. The label renders a recipient postal code field (`src/lib/label-content.ts`) but no QR.

### 2.1 Documentation drift (fix in the owning file)

| # | Drift | Files | Status |
|---|---|---|---|
| C1 | PRD said the research note "is pending" | `02-PRD.md` | Fixed in this pass |
| C2 | PR-14 "Deferred, no task" although T-078 delivered its first form | `02-PRD.md` | Fixed in this pass |
| C3 | "no Coolify, no Vultr" | `ARCHITECTURE.md` ~l.794 | Open; DEC-022 re-selects Vultr + Coolify |
| C4 | "Supabase plan/region and PITR decision" | `TASKS.md` Deferred | Open; should read PostgreSQL hosting/backup/PITR |
| C5 | "DEC-001 to DEC-021" | `docs/spec/README.md`, `02-PRD.md` header | Open; DEC-022 exists |
| C6 | Mengantar facts now CHANGED/NEW (Delete Batch refund fields, volumetric rule, Java-only return address, web 2-hour vs API 90-minute pickup lead, Lost final status) | `docs/research/geraiexpress-mengantar-*.md` | Open; lane D lists each with source; update those notes when the related task is touched |

---

## 3. Market evidence

### 3.1 Demand side

| ID | Fact | Tier | Use |
|---|---|---|---|
| N1 | e-Conomy SEA 2025: Indonesian e-commerce GMV projected at US$71 billion (>14%); video-commerce sellers and shops +75% to 800 thousand | T2 | National tailwind, not counter demand |
| A1–A4 | BPS VPEK-2024 (data year 2023): 15,848 warehousing+expedition+courier businesses, **medium/large only**; 66.17% of expedition/courier firms earn < Rp2 bn/yr; regular service 51.79% of shipments; outside Jawa-Bali most courier orders are placed **conventionally (offline)** — Sumatera 66.98%, Kalimantan 69.86%, Sulawesi 62.25%, Nusra-Maluku-Papua 77.25%; Jawa-Bali mostly online | T1 | Offline ordering is the norm outside Jawa-Bali (firm-level, not counter count). Pilot geography matters. |
| A5 | BPS 2024/2025 edition exists; its PDF text layer is unreadable | T1 | Request a readable copy from BPS PST |
| A7–A9 | QRIS: 38 million merchants (BI, Jun 2025); **44.86 million merchants, 96.68% UMKM, 65.77 million users by Jun 2026** (BI release 17 Aug 2026); from 1 Oct 2026 MDR 0% for transactions up to Rp100,000 (all merchants) and up to Rp500,000 (micro), MDR may not be charged to the consumer | T1 (BI text retrieved via provider capture; one BI value contradiction noted in lane A) | A walk-in sender can expect to pay by QRIS; a typical shipping fee incurs 0% MDR; no QRIS surcharge may be added |
| E1–E4 | Owner voices: Denpasar JNE agent volume from "hundreds" to 50–100 resi/day, omzet −60% (2019); Jakarta agent reduced to commission earner after marketplace cashless (~2016); JNE Yogyakarta: 11 partners closed / 9 opened in 2025, 7 closed / 1 opened by Apr 2026; marketplace drop-point fee "Rp200-an per paket" | T3 anecdote | Walk-in counters are under pressure; value must come from service and trust, not volume alone |
| — | Number of independent multi-courier gerai, parcels per gerai per day, payment mix at counters | — | **Unknown**; only the pilot or interviews can close it (E §4) |

### 3.2 Supply side

Lane B read 14 aggregator-style counter programs (AutoKirim, Fastpay/FastXpress, SIMASRIM, bosAgen, UKURIR, Everpro, Kurir Pedia, Lincah, Komship, KiriminAja, KirimAja SubConsole, Mitra Bukalapak, OnOrder, Biteship) and 10 courier programs (JNE, J&T MDP, SiCepat S&DP, Agenpos, Lion, SAPX, Ninja, Anteraja, ID Express, Paxel).

| Category | Features (B synthesis, C 2.9) |
|---|---|
| **Table stakes** (≥5 vendors) | Multi-courier quote and booking; free registration; 20–40% headline commission; courier pickup; COD; prepaid saldo; tracking in app; WhatsApp CS; Android app or mobile web |
| **Common** (2–4+) | Receiver risk score or fraud reports (KiriminAja, Lincah, Mengantar admin, Biteship, Everpro WA verification); PPOB/bill payments; paid starter kits with scale and thermal printer; RTS fee waivers; agent statistics; API/plugins; seller-team staff roles (KiriminAja, Lincah, Mengantar, Biteship) |
| **Rare** (1–2) | Customer WhatsApp notification among counter-oriented programs (UKURIR; Kurir Pedia claim) — note it is common in seller aggregators (KiriminAja, Mengantar, Biteship, Komship, Everpro; C 2.9), so lanes B and C disagree on prevalence by population; counter receipt/EDC/QRIS (SIMASRIM hardware, Fastpay); Bluetooth ESC/POS receipt printing from web (bosAgen); white-label resi (UKURIR, Rp300k/month); multi-branch HQ dashboard (SIMASRIM); weight/type verification before payment (KirimAja SubConsole) |
| **Not seen on any counter page** | Cash/shift close; per-cashier receipt; explicit duplicate-resi protection; staff roles with audit trail designed for a counter |
| **Sender masking for counters** | Not advertised by any counter vendor. Label-field toggles exist in seller tools (Biteship granular origin/receiver toggles; Mengantar hide address/phone and name masking; Lincah hide SPX COD amount). Kurir Pedia's FAQ requires a full and correct sender identity. |

Advertised counter earnings (T1 for courier programs, T2 for aggregators; none verified):

| Program | Earning | Entry cost / conditions |
|---|---|---|
| Mengantar (seller) | 20% → 30% above 10,000/month with proof | Free |
| GeraiExpress gerai (owner-stated) | 20% | Free |
| bosAgen | from 20% | Free |
| SIMASRIM | up to 25% (5–20% on instant page) | Free; EDC sold |
| AutoKirim | 25% / up to 30% / up to 40% (pages disagree) | Free; kits Rp2–5 jt |
| Komship | 25–40% per courier | Free |
| Fastpay | up to 30% | Packages Rp49k–899k |
| Mitra Bukalapak | up to 35% | Free |
| Lion Parcel agent | 20–35% | Rp10 jt administration fee |
| SAPX agent | 25% + 1% of COD | Rp350k–3.5 jt |
| KirimAja SubConsole | 10% | — |
| JNE sales counter | not published | Deposit, Rp2–50 jt trial target, 12 m² AC unit, 2 PCs, calibrated scales, 1 km spacing |

### 3.3 What app users complain about

Lane C coded 177 negative reviews (of 396 newest) across 11 agent and seller-aggregator apps (keyword coding, ±20%; some apps show 5★ review bursts). Six of the 11 are seller or aggregator apps, so reviewers are mostly online sellers, not counter operators; treat the ranking as directional for counters:

| Complaint | Mentions | Product implication |
|---|---|---|
| Saldo / withdraw / COD payout | 37 | Show provider balance and payout facts clearly; never hold gerai money (GeraiExpress does not) |
| Slow or template CS | 31 | Support path and response ownership for the pilot |
| App error / login / OTP | 31 | Reliability and session continuity are visible value |
| KYC friction | 30 | Onboarding clarity; Mengantar may show a KYC banner even for partner sellers (D 15, Unknown) |
| COD / retur / claim / lost | 24 | PR-44 |
| Account suspended with balance locked | 14 | Transparency on provider holds |
| **Scam WhatsApp to COD recipients** | 12 | Minimal public data (PR-40); masked phones on labels |
| Pickup failed / late | 8 | Pickup state and fallback |
| Weight / ongkir changed after handover | 5 (but strongest in lane E: E6–E8) | PR-43 |
| **Counter charged more than app quote** (INDOPAKET) | 2 cases | Receipt from the exact accepted quote (PR-38) |
| Commission cut | 0 | Price is not what operators complain about in reviews |

Lane E ranked operator pains by evidence strength: (1) falling walk-in volume and thin margins; (2) weight/volumetric disputes after handover; (3) COD returns; (4) lost/damaged parcels with slow capped claims; (5) "where is my parcel" at the desk; (6) missed pickups and handover proof; (7) customers expect QRIS alongside cash; (8) resi sharing over WhatsApp; (9) manual bookkeeping errors; (10) single-courier contract risk.

---

## 4. Gap analysis — counter jobs

Severity is this note's Proposal; lane E's evidence strength per job is in [lane E §2](evidence/2026-11-02/lane-e-operator-voice.md). Where lane E rates the evidence Low or inferred (J5, J6, J9), the severity is provisional until the owner interviews (section 8).

| # | Job | Evidence | Today | Gap | Severity |
|---|---|---|---|---|---|
| J1 | Quick quote | E22–E23; all vendors | Intake quote | No quote-only surface | Low |
| J2 | Weigh and measure; avoid disputes | E6–E8 (High for the pain; Medium for counter applicability, most cases are marketplace shipments); Permenkomdigi 15/2025 KBLI 53202 requires a 0–50 kg scale with 100 g precision; **Mengantar formula now public: (L×W×H)/6000, JNE /4000, IDX Kargo /4000, heavier of actual and volumetric, 0.30 kg rounding tolerance (Lion 0.31), weight difference debited from saldo** (D 5) | Weight entered; dimensions passed but no local rule | No billable-weight estimate, no measured-value evidence | **High** |
| J3 | Content check | Art 22 prohibited items; JNE's "Pernyataan Isi Kiriman" form (B finding 4); Art 73(5)(e) excludes compensation for wrong content information | Nothing | No declaration | **High** |
| J4 | Insurance offer | Art 27; **Mengantar marketing: free under Rp500k, Rp1,000 above; no API field** (D 4) | Deferred (DEC-013) | No offer or recorded choice; API cannot carry it | Medium (provider capability unclear) |
| J5 | Take payment, give receipt | QRIS 44.86 million merchants (A 8); MDR 0% ≤ Rp100k (A 9); INDOPAKET quote-vs-charge complaints (C 1.2); DJP accepts retail receipts; no data on counter payment mix (lane E: Medium, inferred) | Invoice is not a receipt | No payment record, no receipt | **Critical (provisional)** |
| J6 | Close the day | E26 (weak; lane E: Low) | Nothing | No close or variance | High (provisional) |
| J7 | Balance before resi | Mengantar wallet; withdraw min Rp10k with OTP (D 12) | Unpaid-batch recovery | No pre-confirmation balance warning | Medium |
| J8 | Handover / pickup | E17–E19; Art 48: delivery time counts from counter handover or pickup request; **web pickup lead 2 h vs API 90 min** (D 9) | Pickup reservation, batch print | No handover record, no cut-off warning | Medium |
| J9 | Share resi | WhatsApp is the SME channel (E21; lane E: Medium, inferred); UKURIR notifies | Nothing | No share | **High (provisional)** |
| J10 | "Where is my parcel" | E2, E20; Art 12(1)(h); competitor tracking pages leak PII (C 3) | T-045 open | No tracking | **Critical** |
| J11 | Returns | E12–E16 (High); RTS 20–30% on aggregators (vendor figure); Mengantar return fare: discounted outbound only, SPX free; return address = pickup address unless Java-to-Java (D 8) | Nothing | RTS invisible | High |
| J12 | Claims | E9–E11 (High); Art 73: up to 10× fee unless insured, loss/damage 7 working days, delay 3 working days; Art 75 agent liability flows through the operator; **Mengantar: claim ≤14 days, per-courier filing windows (JNE 45/60 working days, SiCepat/IDX/Anteraja/Pos 14 days, J&T/Lion 30 days, lost-claim 3×24 h for IDX/J&T), no claims API** (D 13) | Nothing | No case, no deadline | High |
| J13 | Earnings | E1–E5 | Dashboard counts | No earnings view | Medium |
| J14 | Phone, EDC, Bluetooth printer | bosAgen Web-Bluetooth ESC/POS; SIMASRIM EDC; Fastpay printer complaints (C 2) | Responsive web | No PWA, no thermal receipt path | Medium |
| J15 | Ancillary income (PPOB) | Fastpay, SIMASRIM, bosAgen, Mitra Bukalapak | Out of scope | Strategy decision | Decision |

---

## 5. Unit economics

| Scenario | Provider `p` | Gerai `g` | Remainder `p − g` | Platform revenue v1 |
|---|---|---|---|---|
| Mengantar default (D 1 CONFIRMED) | 20 | 20 | 0 | 0 |
| Owner's hoped terms (unverified) | 30 | 20 | 10 | 0 (not collected, DEC-016) |
| Match Komship/AutoKirim 25% | 20 | 25 | −5 | Blocked |

Lane D: no partner, reseller, affiliate, referral, cashback or rebate program is published; an undefined "Elite Seller" tier exists; the dashboard text suggests the discount step may grow automatically with in-app volume while the Terms require live-chat proof (contradiction). Aggregator comparison: for small COD values Mengantar's COD fee (3% + 11% VAT on the fee, about 3.33%, no minimum) is lower than KiriminAja's (3%, min Rp2,500); at larger values it is slightly higher; returns are free or discounted; payout is daily; Biteship sells SaaS subscriptions (Rp0 / Rp149,000 tiers) instead of discounts (D comparison table).

Options (Proposal, owner decision):

1. **Subscription per outlet** — market precedent exists (Biteship SaaS tiers, UKURIR Premium Rp300k/month, OnOrder Pro Rp159k/month). Requires a billing contract (`11-BILLING-PAYMENTS.md`), outside DEC-016.
2. **Per-resi platform fee** — simple; widens the earnings gap to competitors.
3. **Negotiated pooling with Mengantar** — only path to `p > g` at small volume; depends on the written answer (CTX-42) plus the new questions in section 8.
4. **Free core plus paid counter-ops tier** (receipt, day close, tracking page, branded label) — aligns revenue with the rare features nobody combines (C 2.9). Inference only.

Tax (Tax owner, lane A 11–15): PPN *besaran tertentu* for package delivery is now 10% × 11/12 × 12% = 1.1% of the amount charged (PMK 71/2022 as amended by PMK 11/2025, effective for supplies from 1 Jan 2025); the text ties it to delivery "sesuai … peraturan … di bidang pos"; N10 (a DJP-hosted article carrying the author's personal-opinion disclaimer) states that the 1.1% rate applies to a PKP holding an *Izin Penyelenggaraan Pos*; whether a non-licensed counter or a platform fee qualifies is **Unknown**. PP 20/2026 makes the 0.5% final income tax open-ended for individuals and PT Perorangan up to Rp4.8 bn turnover, with individuals below Rp500 juta exempt; it excludes "perantara" services — whether a counter's spread is "perantara" income is **Unknown**. No rate may be hardcoded.

---

## 6. Regulatory map

| Instrument (lane A) | Requirement | Product implication (Proposal) |
|---|---|---|
| Permenkomdigi 15/2025, KBLI 53202 *Aktivitas Agen Kurir* (ditetapkan 20 Oct 2025; lane A records effect from 22 Oct 2025, not visible in the live text) | No capital or licence fee; obligations: 0–50 kg scale with 100 g precision, computer and printer, internet, service/complaint/waiting rooms, valid information on products, tariffs and complaint procedure, no dangerous goods, **a written agent agreement with a postal operator** | Onboarding may record the gerai's NIB/KBLI as optional business data; whether a gerai using a Mengantar seller account (no direct courier agreement) is a 53202 agent is **Counsel**. Postal licence (53201, Rp500 juta capital) applies to couriers, not counters. |
| Permenkomdigi 8/2025 Art 10, 26, 28, 75 | Agency and cooperation; **Art 75: compensation for agent-caused loss is the operator's responsibility to the user; the agent answers to the operator under contract** | Claims workflow (PR-44) records the courier/Mengantar case, never promises compensation on the gerai's behalf |
| Art 12, 20, 22, 27, 48, 73 | Operator duties: scales, tracking, complaints; return of undeliverable items with the return cost charged to the sender (Art 20(4)); prohibited items; insurance information; delivery time from handover; compensation caps and windows | PR-40 to PR-44 surface these truthfully; the duties stay with the operator |
| **Art 77, 84, 58(4)** | **Operator provides a QR on the resi containing sender and recipient names, addresses, postcode, phone, item and tariff; postcode on every shipment; product wrapped under the operator's brand** | **New gate on DEC-017 (PR-34, PR-46):** the local masked label prints a different sender and no QR. Counsel and the courier scan test must decide whether the label is acceptable, must carry the provider's own resi data, or must be a supplementary sticker. |
| Art 51 | Operator keeps shipping data in QR form ≥4 months with backup | Inference: aligning snapshot retention with the operator's duty is prudent; not a direct GeraiExpress obligation (PRIV-1 open decision) |
| Art 45 | Below-cost discounts ≤3 days a month | Do not plan on provider discounts rising |
| PP 33/2026 (UU PDP implementing regulation) | Art 114: written breach notice within 3×24 hours to data subjects and the agency; processors notify controllers "pada kesempatan pertama" (Art 118). Effective date conflicting in secondary sources; the PDP agency is not yet formed (Komdigi, Jul 2026) | Incident runbook (`OBSERVABILITY.md`) needs a breach-notice path; GeraiExpress is controller for gerai staff accounts and processor or controller for contacts — **Counsel** |
| Permenkominfo 5/2020 as amended (PSE Lingkup Privat) | Registration; Komdigi issued a Sep 2026 compliance notice to 25 PSEs with access blocking as the sanction | Register before public launch (owner gate) |
| BI QRIS MDR (from 1 Oct 2026) | MDR borne by merchant, not consumer; 0% ≤ Rp100k | PR-38 never adds a QRIS surcharge |

---

## 7. Requirement delta (PRD)

All Proposed; none has a task; each needs an owner decision.

| ID | Requirement | Closes | Priority (Proposal) | Key evidence |
|---|---|---|---|---|
| PR-38 | Counter payment record and receipt from the accepted quote | J5 | P0 before a paid pilot, after interview confirmation | A 8–9; C INDOPAKET; E24 |
| PR-39 | Outlet shift and day close | J6 | P1 | E26 (weak) — validate in interviews |
| PR-40 | Resi share and privacy-minimal public tracking | J9, J10 | P0 with T-045 | C 3; C scam reviews; E21 |
| PR-41 | Content declaration and prohibited-goods acknowledgement | J3 | P0 before live orders | Art 22, 73(5)(e); JNE form |
| PR-42 | Insurance offer and recorded choice | J4 | P1 after provider capability is verified | Art 27; D 4 (no API field) |
| PR-43 | Measured weight, dimensions and billable-weight estimate | J2 | **P0** (formula now public) | D 5; E6–E8 |
| PR-44 | Return-to-sender and claim cases | J11, J12 | P1 with T-045 | D 8, D 13; Art 73, 75 |
| PR-45 | Pilot measurement and earnings view | J13 | P0 for the pilot | E §4 gaps |
| PR-46 | Masked-label regulatory and return-path acceptance gate | DEC-017 risk | P0 before any masking claim | A 23 (Art 77); D 8; E15 |

Not proposed (decision, not defect): PPOB; native Android app (PWA first); payment-gateway processing of customer money (PR-38 records, it does not process).

---

## 8. Recommended order (Proposal)

1. **Evidence (owner, no code)**
   - Written Mengantar answers: CTX-42 questions plus Elite Seller criteria, the step-up mechanism, insurance on API orders, whether webhook `status_category` emits `LOST`, delete refunds per courier, KYC on partner sellers, a seller-data privacy notice (D next steps).
   - Counsel: Art 77 QR vs the masked label; KBLI 53202 status of a gerai; Art 75 liability chain; PP 33/2026 roles.
   - Tax owner: PPN besaran tertentu applicability; PP 20/2026 "perantara".
   - Run the 10-question owner interview guide (lane E §5) with at least five gerai owners, including the pilot gerai, before scheduling PR-38/39.
   - Four-week pilot log (T-048) measuring the lane E §4 gaps.
2. **Live-pilot blockers (code):** T-045 + PR-40; PR-43 (formula known); PR-38; PR-41; PR-46 gate with T-048.
3. **Daily operations:** PR-44, PR-39, PR-45, PR-42.
4. **Release gates already queued:** T-037, T-055, T-058–T-060, T-062, T-063, server/IPv4/backup, PSE registration.
5. **Positioning after proof (PR-35):** "tidak ada resi ganda", "struk sesuai harga yang ditawarkan", "data penerima tidak dibuka ke publik", "kasir dengan hak akses dan jejak audit".

---

## 9. Verification of this note

- Executed (2026-11-02): `python3 ~/dotfiles/skills/local/development-spec-suite/scripts/check-traceability.py docs/spec --tasks TASKS.md` — pre-v1 baseline `PASS files=16 declarations=228 tasks=53 findings=0`; after the v2 PRD edit `PASS files=16 declarations=237 tasks=53 findings=0`.
- Executed: keyword and route scans of `src/` (section 2); secret-pattern scan of the copied lane reports (no match).
- Lanes ran as independent agents; their reports state their own executed fetches and limits. Not executed anywhere: provider calls, logins, live AWB lookups, browser rendering of competitor tracking pages, App Store review collection.
- Known evidence limits: BPS 2024/2025 numbers unreadable; BI QRIS figures retrieved indirectly with one value contradiction; PP 33/2026 effective date unresolved; KBLI 2025 mapping of 53202 unverified; review coding is keyword-based on small samples; vendor in-app features behind login were not checked.

## 10. Source register (N-series; lane sources are in each lane report)

| ID | Source | Tier |
|---|---|---|
| N1 | e-Conomy SEA 2025, Google Indonesia blog (2025-11-13) https://blog.google/intl/id-id/company-news/outreach-initiatives/e-conomy-sea-2025-ekonomi-digital-indonesia-mendekati-gmv-us100-miliar/ | T2 |
| N2 | BPS, Statistik Pergudangan, Ekspedisi, dan Kurir 2024/2025 https://www.bps.go.id/id/publication/2025/12/30/500a0e25600532dccc733cc0/statistik-pergudangan--ekspedisi--dan-kurir-2024-2025.html | T1 |
| N3 | BPS, Statistik Pergudangan, Ekspedisi, dan Kurir 2024 (VPEK-2024) https://www.bps.go.id/id/publication/2025/02/11/ccdd2be371e2d7b2a325b8ab/statistik-pergudangan--ekspedisi--dan-kurir-2024.html | T1 |
| N4 | Permenkomdigi 8/2025, full text https://peraturan.go.id/files/permenkomdigi-no-8-tahun-2025.pdf and JDIH Komdigi | T1 |
| N5 | Permenkomdigi 15/2025 (KBLI standards) https://jdih.komdigi.go.id/storage/files/1761214807-PM_KOMDIGI_15_TAHUN_2025_PENGUNDANGAN.pdf | T1 |
| N6 | PMK 71/PMK.03/2022 https://peraturan.bpk.go.id/Download/209842/71_PMK.03_2022.pdf ; PMK 11/2025 https://www.pajak.go.id/sites/default/files/PMK%2011%20Tahun%202025.pdf | T1 |
| N7 | PP 20/2026 and DJP release https://www.pajak.go.id/id/siaran-pers/djp-tegaskan-komitmen-dukung-umkm-naik-kelas-melalui-pp-nomor-20-tahun-2026 | T1 |
| N8 | BI press release sp_2815926 (17 Aug 2026) and Cerita BI "MDR QRIS Bagi Merchant" (13 Oct 2026) | T1 (indirect retrieval) |
| N9 | Komdigi, "Gratis Ongkir Tetap Aman" (2025-05-17) https://portal.komdigi.go.id/kanal-publik/berita-kini/9343 ; PSE enforcement (2026-09-17) https://portal.komdigi.go.id/kanal-publik/berita-kini/10548 | T1 |
| N10 | DJP-hosted article, "Melongok Ketentuan PPN Jasa Ekspedisi Darat" (author's personal opinion) https://www.pajak.go.id/id/artikel/melongok-ketentuan-ppn-jasa-ekspedisi-darat | T2 |
| N11 | PP 33/2026 salinan (regency-hosted) — see lane A finding 29 | T1 (non-JDIH host) |
| N12 | Mengantar help and API pages listed in lane D (help articles 5109199, 5109167, 5502313, 5387484, 5596208, 8140017, 14715369, 14715371; sandbox.mengantar.com/docs) | T1 |
