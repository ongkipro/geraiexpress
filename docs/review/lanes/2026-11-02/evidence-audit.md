# Evidence audit: gap analysis v2 and the 2026-11-02 PRD additions

**Verdict: PASS WITH FIXES.** The overall conclusion holds up: strong engineering, thin commercial evidence, zero platform revenue under DEC-016, and Art 77 as a new gate on the masked label. I found no fabricated numbers, no secret values, and no requirement accepted or given a task by stealth. Thirteen Medium findings and nine Low findings need wording fixes. Most overstate a tier, mislabel who a claim is about, or put a legal duty on the wrong party. One PRD evidence pointer about the code is wrong.

Scope: read-only. I checked against the five lane reports and the 2026-10-28 research note. Five sources were checked live (below). Line numbers are approximate (≈±3) because the read tool shows no line numbers.

## 1. Verified claims (supported)

**Live checks of the sources themselves:**
- **Art 77, Permenkomdigi 8/2025 (live JDIH PDF).** The duty sits on the *Penyelenggara Pos* (the licensed courier operator): "Penyelenggara Pos menyediakan teknologi kode quick response … pada resi pengiriman". The QR must carry, at minimum, the names and addresses of both sender and recipient, the postcode, the phone number, item information and the tariff. Gap analysis §1/§6 and PR-46 attribute this correctly. High confidence.
- **Mengantar help 5387484 (live, updated 2026-10-19).** Every part of the claim matches:
  - (P×L×T)/6000;
  - JNE divides by 4000, and so does IDX Kargo;
  - the heavier of actual and volumetric weight applies;
  - rounding tolerance is 0.30 kg (Lion 0.31 kg);
  - a shortfall is charged to, and an overpayment returned to, "saldo tersedia".
- **Permenkomdigi 15/2025, KBLI 53202 (live).** Every part of the claim matches:
  - "Ketentuan Persyaratan –" and "Ketentuan Verifikasi –" are empty (no capital or licence-fee requirement);
  - a scale of 0–50 kg "atau lebih" with 100 g precision;
  - a computer and printer;
  - service, complaint and waiting rooms;
  - valid information to consumers;
  - no dangerous goods;
  - a "perjanjian kerja sama sebagai agen kurir dengan Penyelenggara Pos".
  - The "effective 22 Oct 2025" date could not be confirmed: the promulgation date is blank in the extracted text, and the regulation was set (ditetapkan) on 20 Oct 2025.
- **Art 75 (live).** The operator is responsible to the user; the agent is jointly liable to the operator. Supported.
- **Art 47(2)(i), Art 20, Art 84 (live).** The text matches, but Art 20(4) is misattributed in the PRD (see finding M9).

**Claims supported by the lane reports with the same meaning:**
- **Review counts.** 396 reviews, 177 negative, 11 apps, and every category count (37/31/31/30/24/14/12/8/5/0) match lane C. I re-added the per-app figures: 396 and 177 both reconcile.
- **BPS.** 15,848 businesses (medium/large firms only); 66.17%; regular service 51.79%; the regional offline shares (66.98 / 69.86 / 62.25 / 77.25%). All match lane A findings 1–4.
- **QRIS.** 38 million merchants (Jun 2025); 44.86 million merchants, 96.68% UMKM, 65.77 million users (Jun 2026); MDR rule from 1 Oct 2026. All match lane A findings 7–9, including the indirect-retrieval caveat.
- **Tax.** 1.1% = 10% × 11/12 × 12%, for supplies from 1 Jan 2025; PP 20/2026 0.5% rate, open-ended, Rp4.8 bn turnover cap, individuals below Rp500 juta exempt, "perantara" excluded. Matches lane A findings 11–15.
- **PP 33/2026.** Art 114 (3×24-hour notice) and Art 118 ("pada kesempatan pertama"); date conflict noted; PDP agency not yet formed. Matches lane A findings 29–30.
- **Advertised-earnings table (gap §3.2).** Every row matches lane B: Lion 20–35% + Rp10 jt fee; SAPX 25% + 1% COD; KirimAja SubConsole 10%; JNE requirements; AutoKirim's inconsistent pages; and so on.
- **Mengantar facts.** Java-only return address, 2 h web vs 90 min API pickup lead, minimum withdrawal Rp10k with OTP, claim within ≤14 days, per-courier filing windows, insurance marketing with no API field, Elite Seller, no partner/referral program. All match lane D.
- **Lane E anecdotes E1–E4** are quoted correctly and labelled T3 anecdote.

**Process checks (no issue):**
- PR-38 to PR-46 all carry Status "Proposed".
- Every owning task reads "none".
- Both change-history entries say no requirement was accepted and no task was created.
- Gap §7 and §8 are labelled Proposal.
- No secret values appear; lane C names variables only.

## 2. Contradicted claims

| Sev | Location | Problem | Exact correction |
|---|---|---|---|
| **Medium** | `02-PRD.md` ≈l.1060 (PR-43 Evidence) | "Dimensions are accepted by the order body (`public-api.ts`) but not priced." **Contradicted by the code.** `createOrderBody` sends no dimension field, `EstimateRequest` has none, and `estimate()` drops the dimension fields that `TwoPassCodEstimateInput` carries. Lane D also says the API has no dimension field. PR-4 already says "collected but not sent". | "Dimensions are collected at intake but sent neither to the estimate nor to create-order (`src/lib/mengantar/public-api.ts`); the Public API has no dimension field (lane D finding 5)." |
| **Medium** | gap ≈l.52 (§2 "Absent") | "dimensions are passed to the estimate input" is misleading for the same reason. | "dimensions are collected but not sent to Mengantar (no API field) and no local volumetric rule exists". |
| **Medium** | gap ≈l.4/5, ≈l.28, ≈l.82; `02-PRD.md` ≈l.84 | "14 aggregator programs and 10 courier programs **recruit counters**". **Contradicted by lane B:** <br>• OnOrder ("Online sellers (OMS), not counters") and Biteship (e-commerce/API) are not counter programs. <br>• Lane B found no counter programme for Anteraja or ID Express. <br>• Lane B's own summary says "at least 14 aggregator-style programs and **9** official courier agent programs". | PRD: "Lane B reviewed 14 aggregator or seller tools and 10 courier programs; about 12 aggregator-style and 8 courier programs recruit counters (Anteraja and ID Express have none; OnOrder and Biteship are seller tools)". The gap analysis header and §3.2 should match. |
| **Medium** | gap ≈l.28 (§1 Competitive) | "GeraiExpress's 20% gerai share is at or below every published rate". **Contradicted by the note's own §3.2 table:** KirimAja SubConsole 10%. Lane B also shows SIMASRIM instant-page couriers at 5–20%, J&T EZ 10%, Paxel ATM 9%, and Lincah from 15%. | "at or below most published headline rates (20–40%); some per-courier or per-program rates are lower (KirimAja SubConsole 10%, Paxel 9%, SIMASRIM 5–20% per courier)". |
| **Medium** | gap ≈l.88 (Rare row); `02-PRD.md` ≈l.84 | "customer WhatsApp notification … rare (UKURIR, Kurir Pedia)". **Lane C contradicts this:** its §2.9 matrix marks WhatsApp notification ✓ for KiriminAja, Mengantar, Biteship, Komship, Everpro and UKURIR, and quotes Komship's automatic WhatsApp. The note settles a lane B vs lane C conflict without saying so. | "rare among counter-oriented programs (UKURIR, Kurir Pedia claim); common in seller aggregators (KiriminAja, Mengantar, Biteship, Komship, Everpro; lane C §2.9)". Remove "customer WhatsApp notification" from the PRD's rare list, or add the same qualifier. |
| **Medium** | gap ≈l.73 (N1); `02-PRD.md` ≈l.83 | Live check of e-Conomy SEA 2025: US$71 bn is "diproyeksikan" (projected), and "+75% to 800 thousand" counts sellers and online shops in **video commerce**, not all online sellers. | "projected e-commerce GMV US$71 bn (>14%); video-commerce sellers and shops +75% to 800k". |

## 3. Weak, unclear or unsupported claims

| Sev | Location | Problem | Correction |
|---|---|---|---|
| **Medium** | gap §3.3 ≈l.109–111, §1 ≈l.28 ("operators' loudest complaints"); `02-PRD.md` ≈l.85 | **Population mislabelled.** Of the 11 pooled apps, 6 are seller or aggregator apps (BosCOD seller app, KiriminAja, Komship, Everpro, Lincah, Mengantar). The reviews are mostly online sellers, not counter operators. | Say "agent and seller-aggregator app users" instead of "operators", and add "mostly online sellers; not counter-specific". |
| **Medium** | gap ≈l.36 (New risk 2 heading) | "Counter data leaks feed COD scams" states a cause as fact. Lane C labels it inference ("[I] points to leakage"), and the reviews come from seller apps. Lane C also says the tracking-page fields were read from client code, not from rendered pages with a live AWB. | "Inference: recipient-data leakage may feed COD scams (12 seller-app reviews); competitor tracking pages *map* full names, addresses, driver data or POD links in client code (not live-verified, lane C §3)." |
| **Medium** | gap §4 J5 ≈l.139 (Critical), J6 ≈l.140 (High), J9 ≈l.143 (High) | Severity outruns the evidence. Lane E rates J5 Medium (inferred; no data on counter payment mix), J6 Low (weak), J9 Medium (inferred). The note also lists PR-38 as P0 while §8 and the PRD say interviews must come "before scheduling PR-38/39". | Add an "evidence strength" column taken from lane E §2, or mark J5/J6/J9 severity as "Proposal, pending interviews". Make PR-38 "P0 after interview confirmation". |
| **Medium** | gap J2 ≈l.136 | "E6–E8 (High)" drops lane E's qualifier: "medium that it applies to the counter". Most cases are marketplace cashless shipments, not walk-in. | Add "(High for the pain; Medium for counter applicability)". |
| **Medium** | `02-PRD.md` PR-40 ≈l.1025–1026 | The Statement and Acceptance contradict each other: <br>• "destination city only, with no names"; <br>• "shows the printed sender identity" for masked shipments; <br>• "names appear only as initials". <br>As written this cannot be tested. | Pick one rule. Suggested: "shows status history, courier, AWB, destination city and the sender and recipient as initials only (for a masked shipment, initials of the printed sender); never the real pickup identity". Apply it to both Statement and Acceptance. |
| **Medium** | `02-PRD.md` PR-44 Constraints ≈l.1069 | "Compensation amounts are the operator's decision". In this PRD "operator" means counter staff, which inverts Art 75 (the Penyelenggara Pos, the licensed courier, is responsible to the user). | "Compensation is decided by the courier (Penyelenggara Pos) or Mengantar; the system records the decided amount." |
| **Medium** | `02-PRD.md` PR-46 Statement and Acceptance ≈l.1087–1088; gap ≈l.35 | "a returned parcel goes to the real pickup address" is not universal: <br>• Java-to-Java shipments can use a configured return address (lane D finding 8); <br>• Anteraja returns of manually dropped parcels go to the dropping agent; <br>• SPX returns must be collected by the sender (lane E finding E15). <br>The Acceptance is also non-deterministic ("unavailable or marked unverified per the owner's decision"). | Statement: "returns go to the provider pickup address or configured return address under the courier's rule, never to the printed masked sender". Acceptance: name one behaviour, or mark the clause "blocked until the owner selects". |
| **Medium** | `02-PRD.md` ≈l.87 (Market table, Permenkomdigi row) | "return-cost … duties on licensed postal operators" is misattributed. The live text of Art 20(4) reads "Biaya pengembalian Kiriman … dibebankan kepada Pengirim" (the sender bears the return cost); the operator's duty is to return the parcel. | "return duty (with the cost charged to the sender, Art 20)". |
| **Low** | gap §6 Art 51 ≈l.182 | This is the operator's retention duty, presented as a GeraiExpress constraint. | "Inference: aligning snapshot retention with the operator's ≥4-month duty is prudent; not a direct GeraiExpress obligation." |
| **Low** | gap §6 PSE ≈l.185 | "actively enforced with access blocking in Sep 2026" overstates lane A finding 31, which describes a deadline notice threatening blocking. | "issued a Sep 2026 compliance notice to 25 PSEs with access blocking as the sanction". |
| **Low** | gap §5 ≈l.161 | "Mengantar's COD fee … is lower than KiriminAja's". Lane D says lower *for small parcels*. With VAT included Mengantar is about 3.33%, which is above 3% at larger amounts. | Add "for small COD values (no minimum)". |
| **Low** | gap §5 Tax ≈l.170 | Leaves out what its own source N10 says (live check): the 1.1% rate applies to a PKP holding an *Izin Penyelenggaraan Pos*. N10 is an author-opinion article (it says so), not a DJP ruling, so T1 overstates it. | Add: "N10 (DJP-hosted article, author's opinion) states the 1.1% rate requires an IPP holder"; downgrade N10 to T2 or T3. |
| **Low** | gap §3.2 Rare row ≈l.88 | The receiver risk score appears at ≥4 vendors (KiriminAja, Lincah, Mengantar, Biteship fraud reports, Everpro verification), so "Rare (1–2)" is wrong. | Move it to "Common". |
| **Low** | gap §1 ≈l.25; §8 step 5 | "Staff roles with audit … not seen on any competitor" sits awkwardly with KiriminAja's "Aktivitas Staff", staff OTP and shifts (lane C §2.1), even though that is a seller dashboard. | Add "(KiriminAja has seller-team staff activity and shifts, not counter cashier roles)". |
| **Low** | `02-PRD.md` PR-42 ≈l.1046 | Mengantar insurance figures are presented without lane D's caveat that the copy is identical to a 2023 page and may be stale. | Add "(marketing copy, possibly stale)". |
| **Low** | `02-PRD.md` PR-38 Constraints ≈l.1009 | "no payment gateway or licence is implied" reads as a legal conclusion. | "this requirement adds no payment processing; licensing remains a counsel item (market note L6)". |

## 4. Material source-quality concerns

- **BI QRIS figures** were obtained indirectly through a search provider's page capture, and one BI value conflicts with another BI release. The gap analysis notes this; the PRD market row does not. (Low.)
- **PP 33/2026** comes from a regency-hosted salinan; its effective date is unresolved. Disclosed in the note. (OK.)
- **N10** is a DJP-hosted article that carries a personal-opinion disclaimer; it is currently tiered T1 (finding in §3).
- **Lane C review sample**: keyword coding with ±20% error, 5★ review bursts, and seller-heavy apps. The PRD keeps "directional only". (OK.)
- **PR-44 cites Art 20 and 47(2)(i)**, and PR-43 cites Art 12(1)(f). None of these is in the lane evidence. My live check supports the article texts, but each is an operator duty. (Low: add "operator duty, context only".)

## 5. Internal consistency

| Sev | Location | Issue | Fix |
|---|---|---|---|
| Low | `02-PRD.md` status table ≈l.555–563 | PR-38 to PR-46 rows sit between PR-14 and PR-15. PR-42 shows State "Deferred" although its Status is Proposed and the other new rows read "Not implemented". | Move the rows after PR-37; use "Not implemented (insurance Deferred, DEC-013)". |
| Low | `02-PRD.md` PR-14 Evidence ≈l.740 and Gerai needs row ≈l.141 | Still "verification pending" and "PR-14 proposed after shipping pilot", which conflicts with the corrected "Partial, T-078" row. | Update both lines to point to T-078 or UX-16. |
| Low | `02-PRD.md` PR-39 Source ≈l.1016; open decisions ≈l.1245 | "interview guide (gap analysis section 8)". The guide lives in lane E §5; gap §8 only refers to it. | "lane E §5 (via gap analysis section 8)". |
| Low | `02-PRD.md` header ≈l.8 | "Updated: 2026-10-29" was not bumped. | Set it to 2026-11-02. |
| Low | gap §1 ≈l.25 | "900+ unit tests" vs the PRD's "47 files / 817 tests". | Use the current STATUS.md figure in both files. |
| Low | gap §9 | "v1 baseline … 228 → 237" (+9). That only works if 228 was taken *before* v1 added PR-38 to PR-45. | Say "pre-v1 baseline". |

Checked and consistent: requirement IDs PR-38 to PR-46, the priority table, the section cross-references in the market table (§3.1, §3.2, §3.3, §5, §6), the count of four new open-decision rows, and the change-history wording.

## 6. Contradictions between lanes or sources (recorded, not settled)

- **WhatsApp notification frequency:** lane B says rare, lane C shows it is common. The synthesis took lane B's view.
- **Return destination:** lane D (pickup address unless a Java return address is set) vs lane E finding E15 and market S6 (Anteraja → dropping agent; SPX → sender collects).
- **Mengantar discount step-up:** proof via live chat (Terms) vs automatic (dashboard). Recorded in the note.
- **BI QRIS H1-2026 value:** Rp1.12 quadrillion vs Rp600.7 trillion. Recorded in lane A.

## 7. Missing evidence and items not verified

- Whether T-078 exists and what state it is in (the basis of the PR-14 correction) was not checked against TASKS.md or STATUS.md.
- The traceability-check output and the test counts in gap §9 were not re-run.
- The Permenkomdigi 15/2025 promulgation and effective date was not visible in the live text.
- I did not read in-app competitor features or BI pages at source.

## 8. What this means for the conclusion

None of the findings overturns the gap analysis or the PRD direction. The fixes:
- narrow the claims about competitors and the WhatsApp feature, which slightly weakens the "nobody does this" positioning;
- put the J5, J6 and J9 severity labels, and PR-38's P0, behind the owner interviews;
- correct three regulatory attributions (Art 20 return cost, Art 75 versus "operator", Art 51 retention);
- make PR-40, PR-46 and PR-43 testable and accurate.

The Art 77 / DEC-017 risk and the zero-revenue unit economics are well supported and still stand.