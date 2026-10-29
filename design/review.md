Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: design/renders/cara-kerja-1280.png, design/renders/cara-kerja-390.png, design/renders/cara-kerja-768.png, design/renders/fitur-1280.png, design/renders/fitur-390.png, design/renders/fitur-768.png, design/renders/home-1280.png, design/renders/home-390.png, design/renders/home-768.png, design/renders/hubungi-kami-1280.png, design/renders/hubungi-kami-390.png, design/renders/hubungi-kami-768.png, design/renders/menu-open-390.png, design/renders/menu-open-768.png, design/renders/simulasi-1280.png, design/renders/simulasi-390.png, design/renders/simulasi-768.png
References: design/refs/apple-macbook-air/1440.png, design/refs/apple-macbook-air/390.png, design/refs/apple-macbook-air/768.png, design/refs/kiriminaja/1440.png, design/refs/kiriminaja/390.png, design/refs/kiriminaja/768.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 2404246e93f0e6a4
Images-SHA: ad34b1927ea76062
Output-SHA: 06789ce5f4442927

**Inspection:** I opened all 152 files in `design/review-slices/`. Every render was readable. The reference captures (Apple and KiriminAja) have large blank bands where lazy media did not load. KiriminAja 1440 slices 03–04, 390 slices 07–10 and 768 slices 04–07 are blank, so only their hero, "Kenapa" grid, app band and footer carry evidence. Apple 390 slices 02, 05, 07, 14 and 16 and 1440 slice 05 have the same gaps. Nothing in the GeraiExpress renders is clipped or broken at 390, 768 or 1280.

**Per section, top to bottom**

- Nav (every page) | authored | Apple (white bar, hairline, active item in blue) | The open menu leaves the page peeking out below the panel. `menu-open-390-01` shows a sliver of the hero buttons under the hairline, and `menu-open-768-01` shows the same. Add a scrim or make the panel fill the viewport.
- `/` hero | authored | KiriminAja (the ongkir list is the hook) and Apple (left-aligned statement, product beside it) | At 390 the fourth courier row sits right at the fold (`home-390-01`, "Rp 16.500" clipped at 844). Trim top padding by about 24px so all four rows show.
- `/` four steps | generic-leaning | Apple (open type, no cards) | Each step ends in a tiny "Contoh: …" line (`home-1280-01`, `home-768-02`). It repeats what the panels show and adds noise. Drop the four lines.
- `/` "Ringkasan jelas" | authored | Apple (bold lead-in, muted continuation) | The panel and lead-ins read well (`home-1280-02`). The continuation text is #333 against a black lead-in, so the hierarchy rests on weight alone. Keep it for contrast, or lighten it one step.
- `/` couriers ("8") | authored | Apple (large real figure) | The eight bare names read like a table with no marks (`home-1280-02/03`). That is owner content, so add courier-mark slots once rights exist.
- `/` saved contacts | authored | none | The panel is a good honest preview (`home-1280-03`). The "Lihat semua fitur" link is far from the panel; place it under the panel's caption.
- `/fitur` hero | authored | Apple (split heading and lead) | It is fine. The empty bottom of the white band (`fitur-1280-01`, y≈340–437) is slack; reduce the padding.
- `/fitur` couriers group | authored | KiriminAja (the ongkir comparison is the explanation) | At 768 "Pos Indonesia" wraps and makes that row taller than the others (`fitur-768-02`). Widen the panel or shorten the label.
- `/fitur` counter group | authored | none | The issued-resi state is a distinct panel and works (`fitur-1280-02`). No change needed.
- `/fitur` team group | generic | Apple (centred column at x≈288) | The text floats in blank parchment with no media above it, unlike Apple's column, which sits under a full-width image (`fitur-1280-02/03`). Left-align it to the content edge or pair it with a panel.
- `/simulasi` all sections | authored (policy page) | Apple (lead-in text) | It is text-only by intent and consistent (`simulasi-1280-01/02`). The "komisi atau keuntungan per paket?" question appears only collapsed, so the answer was never rendered and I could not check it. Capture it open.
- `/cara-kerja` steps and demo | generic | none | The page explains a screen tool and shows no screen (`cara-kerja-1280-01/02`). On a phone that is about six screens of text. Reuse the contact or summary panel state beside steps 1 and 3.
- `/cara-kerja` equipment | authored | Apple (open columns, no tiles) | It works (`cara-kerja-1280-02`).
- `/hubungi-kami` hero and WhatsApp | authored | none | At 768 the WhatsApp block and its aside are squeezed into narrow columns with ragged text (`hubungi-kami-768-01`). Stack the aside below 1024. It also has no link of its own to the demo.
- `/hubungi-kami` sign-up steps | authored | none | It is clear (`hubungi-kami-1280-01/02`).
- Closing band (every page) | familiar, justified | none | The dark band is declared as intentional. The 13px stage label and the grey numerals on near-black are weak. Lift the label to 14px and brighten the numerals.
- Footer (every page) | authored | KiriminAja (footer scope only) | The direction says "copyright only", but the render adds a WhatsApp number on every page. It has no legal entity, address, or terms/privacy links, and KiriminAja's footer shows all of those. That is a trust gap on a site that collects sign-ups. Add the privacy and terms links.

**Template-signal check:** I found no eyebrow pills, no accent-colored headline words, no icon-tile card grids, no monospace labels, no `A // B` labels, no `→` on buttons, and no checkmark lists. The one figure, "8", comes from the courier list. The courier panels are specific to this product, so the site would not pass for an unrelated business. The sub-pages `/simulasi`, `/cara-kerja` and `/hubungi-kami` are the nearest to generic. There are no unsupported claims such as "resmi" or "berlisensi".

**Reference comparison**

- **Apple (`9eabe8770fd57107-1440-*`, `59484ff8655d95af-390-*`, `0c79fc23c19f59fa-768-*`):**
  - **Matched:** the white and parchment alternation with no rules between sections, bold lead-in followed by a continuation (`1440-03`, `1440-04`), and a large figure next to its explanation ("9.5x" and "18 hrs" versus the "8"). Left-aligned statements and the x≈312 narrow column are also matched.
  - **Mismatch:** Apple puts a large product image after almost every statement, and the renders use a panel on only four sections. `/cara-kerja`, `/simulasi` and `/hubungi-kami` carry none, and no photo anywhere. The direction records that photography was excluded and explains why, which is a stated transfer decision. Even so, the result is a text-heavy rhythm, and Apple's rhythm depends on its imagery.
- **KiriminAja (`c7ab4b7a94e46694-1440-*`, `4009cb13590aec61-390-*`, `94016d98ef1a41c6-768-*`):** the hero ongkir hook and the stacking at 390 are transferred. The excluded elements (gradient, eyebrow pill, icon-tile grid, rating badge, member count) are absent from the renders. KiriminAja's widget is an input form, while the GeraiExpress list is static sample data, so the first screen offers nothing to try. The direction does not address that difference. The "Coba demo" button covers it.
- **Research gap:** the direction states the transfer rationale for both references. It does not record that the KiriminAja ongkir widget is interactive.

**Photo slot:** this is the blocking finding. The direction records a deliberate decision to ship no photo slot, and names the white "counter day" section as the place for a photo later. In the renders that section is four text columns with no reserved area (`home-1280-01`, `home-768-02`). The rule for this review says a layout with no place for photos is a finding. The owner-side choice stands, but visual acceptance cannot pass while the layout is not built around a photo. The fix is a labeled slot with a one-line shot brief ("meja kasir dengan laptop dan timbangan, 4:3, pelanggan menyerahkan paket"), sized as the real photo will be.

Most important change: reserve a labeled, correctly sized owner-photo slot with its shot brief beside the four counter-day steps on `/`, and show the existing product panels on `/cara-kerja` so the photo-less pages stop being text-only.

Verdict: REVISE