# Research: Lane D Mengantar facts compared with the repo notes and the planned tasks (T-043, T-045, T-080, T-084, T-086)

## Summary

Lane D has 11 facts that are CHANGED or NEW compared with `geraiexpress-mengantar-operations-contract.md` (OPS) and `geraiexpress-mengantar-public-api.md` (PUB), and each one affects a planned task:

- **T-045:** Delete Batch fields and refunds, the web-only "Lost" status, and seller self-service key regeneration.
- **T-043:** per-courier pickup cut-offs and SLAs, and the 2-hour lead time on the web versus 90 minutes in the API.
- **T-080:** the volumetric and rounding rule is already in the Done-when. Still missing: maximum weights, and the weight correction that moves money in the seller balance.
- **T-084:** the return address only applies when both ends are on Java.
- **T-086:** claim deadlines are already referenced. Still missing: the rule anchor and region dimensions, the claim types, the 14-day SLA and Lost as a case trigger.

T-080 and T-086 already cite help 5387484 and 8140017, so those gaps are partial. T-043 and T-045 have no lane-D facts in their Done-when.

Method: read-only. Lane D sections read: CHANGED/NEW, §5 (it is quick-list item 2), §6, §7, §8, §9 and §13. OPS, PUB and TASKS.md were read in full or in the relevant ranges. **Line numbers were counted by hand from `read_ide` output.** OPS and PUB counts should be exact; TASKS.md counts may be off by ±1. All evidence excerpts come from lane D (fetched 2026-10-29 or later). I did not re-fetch them, so this is second-hand evidence.

## Table

| # | Fact (mark) | Task(s) | Stale or missing note sentence (file:line) | Lane-D evidence (URL, excerpt) |
|---|---|---|---|---|
| 1 | Delete Batch response documents `unDeletedCount`, `totalCount` and `isBatchDraft`. For lion, anteraja, pos and spx it also documents `ordersCount`, `totalBalanceRefund` and `errorMessages` (**CHANGED**) | T-045 | OPS:111 "Response (Observed): `{success: true, deletedCount: 1}`." OPS:113 "Unknown: … refund behavior, and error shapes." OPS:451 Q14 "…constraints, refund." | https://sandbox.mengantar.com/docs/ #content-delete-batch: "`deletedCount` … `unDeletedCount` … `totalCount` … `message`"; "A draft batch … returns … 0, plus `isBatchDraft: true`"; "Only for "lion", "anteraja", "pos" and "spx": `ordersCount` … `totalBalanceRefund` is the balance returned, and `errorMessages` lists orders the courier refused to cancel." |
| 2 | Refund on cancel is documented only for Delete Batch and only for 4 couriers. JNE, SiCepat, SAP, iDexpress and JT: **Unknown**. Refund on `DELETE /order`: **Unknown** (lane D gives no new evidence) | T-045 | OPS:107 "Not documented (Unknown): money effect (refund …)". This stays true for `DELETE /order` | Same anchor. Lane D §7: "still undocumented for JNE, SiCepat, SAP, iDexpress and JT" |
| 3 | "Lost (Paket Hilang)" is a final status in the **web UI** for JNE, SiCepat, SAP, ID Express, J&T and Ninja (**NEW**). Whether webhook `status_category` emits `LOST`: **Unknown** | T-045, T-086 | Missing. OPS:200–206 list the status values, and `LOST` is absent. OPS:208 says the list is open-ended | https://help.mengantar.com/id/articles/14715371 (updated 2026-08-02): "status **Lost (Paket Hilang)** sudah ditambahkan sebagai salah satu final status" |
| 4 | A seller can generate or regenerate their own Public API key after an email OTP. Doing so replaces the Webhook Secret (**NEW**: the seller-side key path) | T-045 | OPS:129 covers the webhook secret only. OPS:156ff "regenerating the API key also replaces the Webhook Secret" does not record that a seller can regenerate the key themselves | https://help.mengantar.com/id/articles/14715369 (updated 2026-10-17): self-generated API key with email OTP. API doc: regenerating "also replaces the Webhook Secret" |
| 5 | Per-courier pickup cut-offs: JNE 15:00, SiCepat 12:00, SAP 15:00, iDexpress 11:00, J&T 12:00, Lion 15:00, Anteraja 15:00 (pickup only), Pos 16:00, SPX 15:00. Pickup SLAs: 7 days for most couriers; SAP "3 kali gagal pick up"; iDexpress and SPX 14 days (**NEW** to OPS) | T-043 | OPS:67 "The page states no courier cut-off times, no per-courier slot lists, …". OPS:443 Q9 "…per-courier cut-offs and slot windows…" | https://help.mengantar.com/id/articles/5502313 (updated 2026-09-24) |
| 6 | Earliest pickup in the web UI is 2 h after the create page opens; the API says 90 min (**NEW / contradiction**) | T-043 | OPS:41 states only the API's 90-minute rule | https://help.mengantar.com/id/articles/14715371: "Waktu pickup paling dekat yang bisa dipilih adalah 2 jam dari waktu saat kamu membuka halaman buat pesanan" |
| 7 | Volumetric weight = (L×W×H)/6000; JNE regular /4000; cargo /6000 except IDX Kargo /4000. The heavier of actual and volumetric is billed. Tolerance 0.30 kg (Lion 0.31 kg). The API takes `weight` (kg) only; dimensions are not an API field (**NEW**) | T-080 | PUB:39–40 "the provider's billable-weight rule (rounding, volumetric) is not established." PUB:84 "Not established: provider billable-weight rounding". OPS:438 Q7 "Rounding: … billable weight and volumetric weight." | https://help.mengantar.com/id/articles/5387484 (updated 2026-10-19): "(P x L x T) / 6000"; "Ekspedisi JNE pembaginya 4000"; "Layanan IDX kargo pembaginya 4000"; "yang akan dipilih kurir adalah yang terberat"; "1.30 kg … menjadi 1 kg; 1.31 kg … 2 kg" |
| 8 | Regular-service maximum weight is 50 kg (Lion 100 kg, Anteraja 30 kg). Cargo minimums: JTR 10–30 kg, Gokil 10–50 kg, IDX Kargo 10–70 kg, SAP Kargo 5–100 kg by region. A weight difference is debited from or credited to "saldo tersedia". An iDexpress parcel under 0.5 kg pays up to half the fare (**NEW**) | T-080 | OPS:354 records only the SPX 50 kg maximum. The post-shipment balance correction is missing | Help 5387484 (same URL); https://help.mengantar.com/id/articles/5502313 for the iDexpress rule |
| 9 | The return address applies only when origin **and** destination are both on Java (JNE, SiCepat, SAP). Otherwise the pickup address is used. The API has no return-address field (**CHANGED/refined**; missing from OPS and PUB) | T-084 | Missing from OPS and PUB. The nearest is OPS:366 "The provider-side seller identity … remains whatever the tenant's pickup address master holds" | https://help.mengantar.com/id/articles/14715369 (updated 2026-10-17): "alamat retur hanya dapat digunakan jika alamat asal dan alamat tujuan sama-sama berada di Pulau Jawa … sistem akan menggunakan alamat pickup sebagai pengganti alamat retur" |
| 10 | Claim filing deadlines per courier. Each rule has a unit and an anchor event:<br>• JNE: 45 working days (Java, Sumatra, Bali, NTB) or 60 working days (other regions)<br>• SiCepat, IDX, Anteraja, Pos: 14 days from the **last status**<br>• SPX: 14 days from **RTS**<br>• SAP: 60 days<br>• J&T, Lion: 30 days<br>• lost-claim within 3×24 h for IDX and J&T<br>• dispute window after Delivered: 7–15 days<br>(**NEW**) | T-086 | Missing from OPS and PUB (neither has a claims section). T-086 cites help 8140017 but does not name the region dimension or the anchor event | https://help.mengantar.com/id/articles/8140017 (updated 2026-09-18) |
| 11 | Three claim types: return; full value (COD or insured value); other. A claim takes at most 14 days and pays into "Saldo Tersedia". A stuck-parcel claim pays "(Nilai COD/NON COD - estimated fee)". Exclusions: damage reported more than 3 days after receipt, no unboxing video, liquids over 100 ml, live plants. There is no claims API (**NEW**) | T-086 | Missing from OPS and PUB | https://help.mengantar.com/id/articles/5207011 ("Proses klaim paling lama adalah 14 hari … dana akan kita kembalikan ke Saldo Tersedia"); https://help.mengantar.com/id/articles/5596208 (updated 2026-04-30); help 6046101 (updated 2026-05-13) |

Confirmed and unchanged (no edit needed): the webhook body, the HMAC scheme, retry and pause behaviour, both CANCELED spellings and the open-ended status list (OPS §4–5); `DELETE /order` eligibility and the Anteraja 5-minute rule (OPS:103–105); Ninja discontinued; the 8-per-60 s label limit.

Out of scope but CHANGED/NEW (not in the five tasks; listed so they are not lost):
- **COD fee formula.** It is 3% with no minimum, plus 11% VAT on the fee. 150,000 × 3% × 1.11 = 4,995, which matches PUB:76. PUB:41 ("observed only for one amount") is stale.
- **Per-courier COD maxima.** OPS:354 records only SPX and Pos.
- **Insurance.** The marketing pages say free below Rp500k and Rp1,000 above; there is no API field (DEC-013 deferred).
- **Withdrawal.** OTP is required, and changing the bank account requires KYC.
- **Account KYC banner.** Whether KYC can block a Partner-registered seller is Unknown.

## Proposed text blocks

### A. OPS §3.2 (replace OPS:111 and OPS:113)

> Response (Observed, docs re-read 2026-10-29 or later, lane D): `{success, deletedCount, unDeletedCount, totalCount, message}`. Deleting a draft batch returns 0 counts plus `isBatchDraft: true`. For couriers `lion`, `anteraja`, `pos` and `spx` only, the response also carries `ordersCount`, `totalBalanceRefund` ("the balance returned") and `errorMessages` (orders the courier refused to cancel).
>
> Unknown: whether `id` is the batch `_id` or the batch code; whether paid or picked-up members block a delete; refund behavior and refused-order reporting for `JNE`, `SiCepat`, `Sap`, `iDexpress` and `JT` (not documented); error shapes.

Add to OPS:107 (end of sentence): "Lane D (2026-10-29 or later) found no change for `DELETE /order`: its refund remains Unknown."
Replace Q14 at OPS:451 with: "14. `DELETE /batch`: which batch identifier; refund and refused-order reporting for JNE, SiCepat, SAP, iDexpress and JT (documented only for lion, anteraja, pos and spx); refund for `DELETE /order`."

### B. OPS §5.1 (add a row after OPS:204)

> | `LOST` (assumed spelling) | Help 14715371 (updated 2026-08-02) adds "Lost (Paket Hilang)" as a **web-UI** final status for JNE, SiCepat, SAP, ID Express, J&T and Ninja. Whether webhook `status_category` or `GET /order` emits it, and under which spelling, is **Unknown**; the default branch must handle it | Observed (web) / Unknown (API) |

Add to OPS §12.3, Q17 at OPS:454: "Is 'Lost' emitted as a `status_category` value, and with what spelling?"

### C. OPS §4.5 (add a bullet after the "regenerating the API key" bullet)

> - Observed (help 14715369, updated 2026-10-17): a seller can generate or regenerate their own Public API key in the Mengantar web app after an email OTP. Doing so also replaces the Webhook Secret (API doc). The Webhook Secret can therefore change without any Partner call, and signature failures after such a change are expected until the new secret is stored.

### D. OPS §2.3 (replace the "Others" row at OPS:67) and §2.1 (add after OPS:41)

> | Others | Request-level rules as above. Per-courier pickup **cut-off times** come from help 5502313 (updated 2026-09-24), not the API page: JNE 15:00, SiCepat 12:00, SAP 15:00, iDexpress 11:00, J&T 12:00, Lion 15:00, Anteraja 15:00 (pickup only), Pos 16:00, SPX 15:00. Pickup SLA: 7 days for most couriers; SAP up to 3 failed pickups; iDexpress and SPX 14 days. Whether a cut-off bounds the same-day slot or the order-creation time, and whether the API enforces it, is **Unknown**. The API page states no per-courier slot lists, no maximum days ahead and no per-slot capacity. Pickup minimum volume: **Unknown**. |

> Contradiction (Observed): the web UI's earliest selectable pickup is "2 jam dari waktu saat kamu membuka halaman buat pesanan" (help 14715371), while the API states 90 minutes. Until Mengantar clarifies, use the stricter value of 2 hours.

Replace Q9 at OPS:443 with: "9. … whether the help-page cut-offs (5502313) are enforced by `POST /time` or order create, and whether the API lead time is 90 minutes or the web's 2 hours."

### E. PUB "Not yet proven" (replace PUB:39–40) and PUB:84; OPS Q7 at OPS:438

> - Billable weight (Observed, help 5387484, updated 2026-10-19; not an API page):
>   - **Volumetric weight.** (L×W×H)/6000 for regular service; JNE regular uses /4000. Cargo uses /6000, except IDX Kargo /4000.
>   - **Billed weight.** The courier bills the heavier of actual and volumetric weight.
>   - **Rounding.** A decimal part up to 0.30 kg rounds down (1.30 kg → 1 kg; 1.31 kg → 2 kg) for JNE, SiCepat, SAP, ID, J&T, Anteraja, Pos and SPX. Lion uses 0.31 kg.
>   - **Maximum weight, regular service.** 50 kg; Lion 100 kg; Anteraja 30 kg.
>   - **Cargo minimums.** JTR 10–30 kg, Gokil 10–50 kg, IDX Kargo 10–70 kg, SAP Kargo 5–100 kg by region.
>   - **iDexpress under 0.5 kg.** The parcel pays up to half the fare (help 5502313).
>   - **After shipment.** A weight difference found by the courier is debited from or credited to the seller's "saldo tersedia".
>
>   The API accepts only `weight` in kg (dimensions are not an API field). The billable weight must therefore be computed locally before quoting. **Unknown:** whether the API estimate applies the rounding to a decimal `weight` itself.

PUB:84 → "Billable weight: see the rule above (help 5387484). Unproven against the live API: whether `weight=1.31` is quoted as 2 kg."
OPS Q7 at OPS:438 → "7. Rounding: COD fee (order response shows a decimal `COD_FEE`); whether the estimate endpoint applies the help-page weight rounding to a decimal `weight`."

### F. OPS §9 (append to OPS:366) — return destination

> Observed (help 14715369, updated 2026-10-17): a seller return address is used only when origin **and** destination are both on Java, and only for JNE, SiCepat and SAP. Otherwise "sistem akan menggunakan alamat pickup sebagai pengganti alamat retur". Create Order has no return-address field. Inference: for API orders, an RTS parcel returns to the provider pickup address, not to a masked sender. Whether a return address saved in the seller's web settings applies to API orders is **Unknown**.

### G. New OPS section "§14 Claims" (not in OPS or PUB today)

> Observed (help 5207011, 5596208, 8140017 updated 2026-09-18, 6046101): there is no claims API; claims go through Live Chat (08:00–20:00 WIB).
>
> - **Claim types:** return; full value (the COD amount or the insured value); other. A stuck-parcel claim pays "(Nilai COD/NON COD - estimated fee)".
> - **Processing:** at most 14 days, paid to "Saldo Tersedia".
> - **Filing windows:** each rule has a unit and an anchor event:
>   - JNE: 45 working days (Java, Sumatra, Bali, NTB) or 60 working days (other regions);
>   - SiCepat, IDX, Anteraja, Pos: 14 days from the last status;
>   - SPX: 14 days from RTS;
>   - SAP: 60 days;
>   - J&T, Lion: 30 days;
>   - lost-claim within 3×24 h for IDX and J&T;
>   - disputes after Delivered: 7–15 days.
> - **Exclusions:** damage reported more than 3 days after receipt, a missing unboxing video, liquids over 100 ml, live plants.
>
> Lost status: see §5.1.

### H. Done-when additions

**T-045** (TASKS.md:349, ±1). Append:
> …; the batch-delete parser reads `deletedCount`, `unDeletedCount`, `totalCount` and `isBatchDraft`, and for lion, anteraja, pos and spx also `ordersCount`, `totalBalanceRefund` and `errorMessages`. Any field it does not recognize is ignored, and a field it expects but cannot read is treated as unknown. A refund amount is stored as provider-private money and never shown to operators. For other couriers, and for `DELETE /order`, the refund stays Unknown (absent ≠ 0). A courier-refused order listed in `errorMessages` stays not-cancelled after the read-back. An unrecognized `status_category`, including a possible `LOST`, is stored verbatim, mapped to a non-final "unknown status" state and covered by a fixture test. A webhook signature failure after a seller-side key regeneration is logged as `webhook_secret_mismatch` without the body and leaves polling as the fallback (test).

(The refund-as-private-money clause is my inference from the "net cost private" rule in AGENTS.md; lane D does not state it.)

**T-043** (TASKS.md:330, ±1). Append:
> …; per-courier pickup cut-offs (help 5502313, updated 2026-09-24: JNE 15:00, SiCepat 12:00, SAP 15:00, iDexpress 11:00, J&T 12:00, Lion 15:00, Anteraja 15:00, Pos 16:00, SPX 15:00) are stored as configuration with their source URL and date, not as constants. The lead time is a setting that defaults to 120 minutes (the web UI's 2 hours, stricter than the API's 90) until the supervised capture shows otherwise. The capture records whether the API refuses a slot after the cut-off or with less than 2 hours' lead.

(Whether the cut-off bounds the slot or the creation time is Unknown, so the enforcement semantics are a Proposal.)

**T-080** (Done-when; it already holds the divisor and tolerance rule). Append:
> …; per-courier maximum weights (regular 50 kg, Lion 100 kg, Anteraja 30 kg) and cargo minimums are seeded from help 5387484 with their source URL and date. A courier whose maximum is below the billable weight is dropped from the quote with a named reason. The intake states that the courier may re-weigh and that any difference is settled against the seller balance (UX-19 copy, no amount promised). A sandbox estimate with `weight=1.31` records whether the API rounds by itself.

**T-084** (Done-when, "states the return destination rule for the courier and route"). Replace that clause with:
> …states the return destination: for JNE, SiCepat and SAP, the seller return address applies only when origin and destination are both on Java; in every other case, and for every API order where no return address can be sent, the parcel returns to the provider pickup address shown on the shipment detail (help 14715369, updated 2026-10-17). Whether a seller web-setting return address applies to API orders is shown as "belum terverifikasi". A unit test covers the Java/non-Java × courier matrix.

**T-086** (Done-when, "claim-window rules are seeded from help 8140017 with URL and date"). Append:
> …; each rule carries its unit (working days, days, hours), its anchor event (last status, RTS, delivered) and an optional region set (JNE: 45 working days for Java/Sumatra/Bali/NTB, 60 elsewhere). The case records one of the three provider claim types (return, full value, other) and the provider processing ceiling of 14 days (help 5207011) as information, not a promise. A web or webhook "Lost" status, once observed, opens or suggests a case, and the lost-claim 3×24 h window is tested. The exclusions (damage reported more than 3 days after receipt, no unboxing video, liquids over 100 ml, live plants) appear as guidance copy without promise wording.

## Contradictions
- Pickup lead time: the API says 90 minutes and the web UI says 2 hours (help 14715371). Unresolved.
- Several help pages still describe Ninja, which the API discontinued on 2026-09-01. The Lost-status article also lists Ninja.

## Missing evidence
- Whether webhook `status_category` emits LOST: Unknown.
- Delete refunds for JNE, SiCepat, SAP, iDexpress and JT, and for `DELETE /order`: Unknown.
- Whether the cut-offs are enforced by the API, and which time they bound: Unknown.
- Pickup minimum volume: Unknown.
- Whether the estimate API applies weight rounding itself: Unknown.
- Whether a web-setting return address applies to API orders: Unknown.
- The Order Status Reference Sheet has not been opened.

## Sources
- Kept: docs/research/evidence/2026-11-02/lane-d-mengantar-current.md (all evidence above is quoted from it); OPS; PUB; TASKS.md (T-043, T-045, T-080, T-084, T-086, Deferred).
- Underlying pages, as cited by lane D: sandbox.mengantar.com/docs/ #content-delete-batch; help.mengantar.com articles 14715371, 14715369, 5502313, 5387484, 8140017, 5207011, 5596208, 6046101.

## Next steps
1. Apply blocks A–G to OPS and PUB, with a changelog line citing lane D.
2. Add the H texts to TASKS.md once the owner approves. T-043's addition also changes the local 90-minute rule in code.
3. Add LOST, the cut-off enforcement, the batch-delete refunds and API weight rounding to the T-048 question list.

```acceptance-report
{
  "criteriaSatisfied": [
    {"id": "criterion-1", "status": "satisfied", "evidence": "Table of 11 CHANGED/NEW facts mapped to T-043/T-045/T-080/T-084/T-086, each with the stale or missing note line, the lane-D URL and excerpt, plus replacement note text (blocks A-G) and Done-when text (block H); Unknowns marked"}
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {"command": "read_ide lane-d, OPS, PUB, TASKS.md", "result": "passed", "summary": "Read-only comparison; no web fetch; no repo edits"}
  ],
  "validationOutput": ["Line numbers counted by hand from read_ide output; TASKS.md lines may be off by ±1"],
  "residualRisks": [
    "Evidence is second-hand from lane D; source pages were not re-fetched or source_checked in this run",
    "TASKS.md line numbers may be off by ±1; OPS/PUB lines counted manually",
    "The refund-as-private-money and cut-off enforcement semantics in the Done-when text are researcher inference or Proposal",
    "Return-address and cut-off enforcement for API orders remain Unknown"
  ],
  "noStagedFiles": true,
  "diffSummary": "Research artifact only; no repository edits",
  "reviewFindings": ["no blockers"],
  "manualNotes": "T-080 and T-086 already partly reflect lane D (help 5387484 and 8140017 are cited); T-043 and T-045 do not. Out-of-scope NEW items (COD formula, COD maxima, insurance, withdrawal OTP/KYC) are listed but not drafted."
}
```
