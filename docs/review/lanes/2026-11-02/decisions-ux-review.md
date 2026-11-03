## Review

Scope: the working-tree diff of the 7 named files, the existing rows DEC-003/008/010/015/016/017/018, PR-34/35/36 and the open-decision table in `02-PRD.md`, and UX-1/9/12/13/14 for context. I did not read scripts or the traceability checker, made no edits, and ran no tests.

**Correct**
- **DEC-023 doesn't authorize live calls, deployment or public claims.** `DECISIONS.md` DEC-023 says: "No deployment, live provider call or public claim is authorized by this decision". It keeps PR-35 and PR-46 as claim gates. CTX-44 repeats this under "Statement (unchanged)" and says the agreement text is not in the repo. PRD line ~1203 says the same.
- **Customer outputs hide net cost.** The UX-17(4) receipt says "never net cost, gerai discount or platform remainder". UX-18(3) leaves out price, COD and goods value. Both match DEC-003, DEC-016 and UX-5.
- **The UX-9 gate row matches PR-46.** It uses the acknowledgement default rather than making masking unavailable. It also states that recorded "verified" status still waits for T-048 and the Mengantar sync.
- **Several new IAM-1 rows match DEC-008's split.** Void, reopen and closing a case are admin-only. Platform rules are platform-only.
- **Language rule is respected.** UI strings are quoted Bahasa and the docs prose is English. I found no violation.
- **The `ARCHITECTURE.md` hosting line now matches DEC-020 and DEC-022.**

**Findings**

1. **P1 — COD shipments could be charged twice at the counter.** `17-UX-FLOWS-SCREEN-CONTRACTS.md:567`, UX-17(1).
   - Problem: the payment dialog "prefills the customer charge from the confirmation snapshot" no matter the collection mode. Under COD Ongkir and Full COD, the courier collects shipping from the recipient (PRD ~276–278). Collecting the same amount at the counter breaks DEC-003's "COD/insurance counted once".
   - Fix: add "For COD modes the prefill is only the counter-payable part; amounts assigned to courier collection are shown as 'Ditagih kurir (COD)' and are never prefilled or counted as counter cash." Add the same Given/Then to PR-38 acceptance (`02-PRD.md:1008`).

2. **P1 — Masked shipments can leak the gerai's identity on the public tracking page.** UX-18(3) at `17-…:584` shows "gerai name". PR-40 (`02-PRD.md` ~1027–1028) says the page "shows only … status history, courier, AWB, destination city and … initials … never the real pickup identity". The gerai is the real pickup identity, which DEC-017/018 masking protects.
   - Fix: change UX-18(3) to "gerai name only when masking is off; a masked shipment shows no gerai name". Also add that case to PR-40 acceptance.

3. **P1 — The tracking page's host isn't defined in PR-36.**
   - Problem: UX-18's constraint at `17-…:585` says "apex or a dedicated path on it". PR-36 (`02-PRD.md:975`) lets the apex serve only "public marketing routes", answers other routes with 404, and sends noindex only for non-marketing *hosts*. `/lacak/*` fits none of these.
   - Fix: pick `https://geraiexpress.com/lacak/<token>` in UX-18(2). Amend PR-36 and ARCH-6 to list `/lacak/*` as a non-marketing apex route that sets and reads no cookies, sends per-route `X-Robots-Tag: noindex`, and is 404 on the app, owner and hooks hosts.

4. **P1 — The pilot "spread" lets tenant admins work out the provider's discount.** PR-45 (`02-PRD.md` ~1077) and UX-17(6) show tenant admins the spread between customer charge and "recorded provider cost". DEC-018(1) says the assigned discount is the gerai's cost basis, and UX-12's tenant view says "never the remainder, the variance or the provider percentage". Showing provider cost leaks that percentage.
   - Fix: define spread as "customer charge minus the gerai-facing cost estimate from the assigned discount (DEC-018), never the provider-observed net". Unknown stays "tidak diketahui".

5. **P1 — New IAM-1 cells read as already accepted.** `07-IAM-RBAC-ABAC.md:34–38`.
   - Problem: DEC-008 accepted the matrix by resolving its "Proposed" cells. The 5 new rows add grants, including operator money actions that conflict with the "Financial … No default grant" row. None of them is marked Proposed.
   - Fix: prefix each new operator and tenant-admin cell with "Proposed:". Add a note under the table: "Rows for PR-38 to PR-46 are not covered by DEC-008; owner acceptance pending."

6. **P1 — "Close own outlet day" can't be enforced.** `07-…:35`.
   - Problem: DEC-008 makes pilot memberships tenant-wide and defers per-outlet assignment, so an operator has no "own outlet".
   - Fix: change the cell to "Proposed: close a day for any outlet in the tenant (memberships are tenant-wide, DEC-008)".

7. **P1 — Operators would see differences that IAM denies them.** IAM row `07-…:35` denies operators "view payment differences". UX-17(5) (`17-…:567`) lets the operator run "Tutup kas", which "shows expected, counted and difference".
   - Fix: separate the two terms. Either IAM says "per-record charge differences: denied; cash-count variance for the period being closed: permitted", or UX-17(5) hides the variance from operators after submission.

8. **P1 — The PRD contradicts itself on whether PR-38–46 have tasks.**
   - `02-PRD.md:1000` says "none has an owner decision or a task, and none authorizes implementation".
   - The status table (`:598–606`) lists T-080 to T-087. CTX-44 and DEC-023 give the development direction.
   - Row `:1214` still gates "before scheduling PR-38 to PR-46".
   - Fix: reword line 1000 to "Proposed; development is permitted by DEC-023 (tasks T-080 to T-087); none is accepted product behavior". Change the row 1214 gate to "Before marketing copy beyond PR-35".

9. **P1 — The receipt contents are specified while still an open owner decision.** UX-17(4) fixes the receipt's contents. But the PR-38 status says "receipt content is an existing open owner decision", and open row `02-PRD.md:1230` gates "Customer receipt … cashier … refunds" "Before monetary workflows". DEC-023 covers only Mengantar and counsel items, not this owner decision.
   - Fix: mark UX-17(4)'s field list "Proposal pending the receipt-content decision (PRD open row)", or get the owner to decide. Also add "refund after a voided or failed provider order" to that open row.

10. **P1 — "Belum dibayar"/"Lunas" collide with the provider "awaiting payment" state.**
   - Problem: UX-17(1) and the table at `17-…:573` offer "Catat pembayaran" on awaiting-payment shipments and use "Belum dibayar · Lunas". UX-1 step 6 and UX-14 (`:539`) use unpaid or awaiting payment for the *Mengantar order* payment. A shipment could show "Lunas" while the provider order is still unpaid.
   - Fix: rename the counter states "Pelanggan: belum bayar / sudah bayar (Lunas)" and keep them visually separate from the provider payment state. Add the acceptance check "a counter 'Lunas' never hides or replaces the provider unpaid state".

11. **P2 — UX-13 doesn't list the new money actions.**
   - Problem: UX-17(8) says money actions "follow UX-13", but the UX-13 table (`17-…:516–524`) has no rows for Catat pembayaran, Batalkan catatan, Tutup kas, Buka ulang kas or Tutup kasus. Their confirmation content is therefore undefined, and so is what "unknown" means for a local write.
   - Fix: add those rows. Name the amount and method, period totals, or outcome. Define unknown as "reload the command receipt; never a second record".

12. **P2 — Unclear whether the return note is printed on the label.** UX-9 gate row `17-…:441` says "the print view always states where a return goes".
   - Problem: DEC-018's retention note is "print view help text (not on the printout)". As written, a reader could put the real pickup or return address onto the masked label.
   - Fix: append "in the print view help text, not on the printout".

13. **P2 — Several acceptance items can't be tested as written.**
   - UX-20(6) "wording follows Art 75 context" has no checkable criterion. Fix: give the exact Bahasa copy and forbidden phrases (for example "dijamin" or a promised amount).
   - UX-20(3) "working days" has no holiday calendar and mixes in 3x24-hour windows. Fix: state the calendar source and the hour/working-day rule.
   - PR-41 acceptance (`02-PRD.md` ~1038) needs text "approved by counsel", so it can't pass during development. Fix: split it into a mechanism acceptance and a wording gate.

14. **P2 — The volumetric-weight deferral is stale.** Open row `02-PRD.md:1232` still says "volumetric weight is deferred". PR-43 and UX-19 now develop it.
   - Fix: change it to "billable-weight rule per PR-43 (provider-configured, dated); confirm before the supervised production order".

15. **P2 — Smaller inconsistencies.**
   - PR-45 (`02-PRD.md` ~1078) says "When the owner exports". UX-17(6) and IAM give the export to the tenant admin, and the platform has "No automatic access". Fix: say "tenant administrator", or add a platform pilot-report row.
   - `docs/spec/README.md` header still says "Updated: 2026-10-29" although its status now says "as of 2026-11-02". Fix: bump it.

**Merge verdict: APPROVE WITH FIXES.** DEC-023 and CTX-44 correctly authorize development only. Findings 1–10 are contract contradictions that should be fixed in these docs before T-080 to T-087 are built. Findings 1 (COD charged twice) and 2 (masked gerai identity leak) are the most important. Since this is a docs-only change, no tests are affected. The supervisor should still rerun the repository's traceability or spec gate after the fixes.