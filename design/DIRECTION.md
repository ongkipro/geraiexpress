# GeraiExpress public site — design direction (C10, T-036)

Scope: the five public marketing routes `/`, `/fitur`, `/simulasi`, `/cara-kerja`, `/hubungi-kami` and
`src/components/marketing/**`. The signed-in product, its tokens (`src/app/globals.css`) and the UI v4
direction (`local://design-direction.md`, contract C1–C10) are accepted and not changed here.

## Public experience
- Audience/job: owners of small Indonesian shops (konter pulsa, kelontong, fotokopi, agen) deciding whether
  to run a multi-courier drop-off counter. Primary action: try the simulated demo (`Coba demo`, on `/masuk`);
  secondary: register (`Daftar`). Assumption (not researched): most visitors arrive on a phone.
- Entry → understand what a counter day looks like → see real tariff comparison and the couriers → try the
  demo or register → (real gerai) admin approval and Mengantar connection. Recovery: every page ends with
  the demo CTA; `/hubungi-kami` carries the one WhatsApp contact action.
- Content: only approved, implemented claims (PR-35, T-036, `tests/unit/marketing-rebrand.test.ts`):
  drop-off only, simulated demo prices and resi, couriers derived from `OFFERED_COURIERS` minus
  `DROP_OFF_UNSUPPORTED`. No percentages, fees, earnings, partnership, "gratis", pickup, tracking or printing
  claims. The local masked label (PR-34) is Partial (courier acceptance unproven, PR-35 says the pages do not
  describe it), so it is deliberately left out of public copy even though the brief suggested it.
- Assets: no photos, logos or courier marks are supplied, so none are drawn. The only visuals are
  live-rendered HTML panels that reproduce the static look of the real intake summary rail and the real
  ongkir radio list, filled with clearly labelled sample data ("Simulasi", "harga contoh").

### Page anatomy
- `/` home: (1) hero, parchment — statement + demo CTA beside the existing sample quote list (logic
  unchanged, restyled as the intake ongkir radio list), so "multi-kurir" is shown in the first screen,
  as KiriminAja does with its ongkir widget; (2) counter day, white — the same four real steps as
  `/cara-kerja` (one shared list, `src/components/marketing/counter-steps.ts`), drop-off scope; (3)
  summary before confirming, parchment — the "Kiriman baru" panel (intake spine + summary rail) beside
  confirm-before-send and real-vs-sample tariff notes; (4) couriers, white — the derived count set large
  and the names as type, no logos; (5) what stays with the gerai, parchment — contacts, history, roles
  beside a saved-contacts panel (look of `/kontak`); (6) closing CTA, dark band; footer, parchment.
- `/fitur`: hero (white) → couriers group: heading, then a second ongkir sample (2 kg to Surabaya)
  beside the features (parchment) → counter group beside the issued-resi state of the summary panel
  (white) → team group as a centred reading column (parchment) → CTA.
- `/simulasi`: hero with demo CTA → service model (parchment) → who does what (white) → FAQ (parchment) →
  closing CTA. The page keeps
  its test-locked title "Model layanan loket GeraiExpress" and stays neutral: T-036 made it the place
  that states commercial terms are not published; renaming it to a partnership page is barred
  ("kemitraan" is a banned claim) and real terms wait for DEC-012.
- `/cara-kerja`: hero → four steps as numeral / step / detail rows (parchment) → demo explanation (white)
  → equipment (parchment) → CTA.
- `/hubungi-kami`: hero → WhatsApp contact (parchment, the page's single contact CTA) → self sign-up
  steps (white) → footer.
- Imagery decision: the page's image is the product. The hero visual slot holds the live product panel,
  the way Apple's hero holds the device. Counter photography is owner content not yet supplied; the
  place for it is the white "counter day" section beside the four steps, added when the owner supplies
  a real photo (shot brief: "meja kasir dengan laptop dan timbangan, 4:3, pelanggan menyerahkan paket").
  No visible placeholder is shipped, because the same build serves the production apex (decision by the
  owner's coordinating agent, 2026-10-29, after review round 2).
- Owner content still missing: that counter photo, courier marks with usage rights, any customer evidence.

## Reference evidence
| Source / inspected date | Role | Surface, viewport, state, capture dir | Observed | Inferred / unverified | Transfer / exclude |
| --- | --- | --- | --- | --- | --- |
| apple.com/macbook-air, 2026-10-29 | Directional (rhythm, type, section transitions) | Product marketing page, 390/768/1440, signed out, `design/refs/apple-macbook-air/` (`design/refs/apple-macbook-air/1440.png`, `design/refs/apple-macbook-air/390.png`) | Product visual first, then a left-aligned product name and a short statement; white and #f5f5f7 sections alternate with no rules between them; body blocks are narrow left-aligned text in a centred column where a bold lead-in sentence is followed by grey continuation text; one large centered statement near the end; a real count set large next to its explanation; generous vertical gaps (roughly a viewport between ideas at 1440). At 390 the hero stacks visual → name → statement → price/buy row, nav collapses to icons. | Exact spacing tokens not copied (computed values recorded in ref.json only). Several lazy-loaded media bands rendered blank in the capture; observations rely on the loaded sections only. | Transfer: background-shift rhythm, left-aligned statements, bold lead-in paragraphs instead of cards, a real figure set large, product visual as the hero anchor. Exclude: photography (no owner photos exist; see "Imagery decision"), gradients and glass, carousels, SF Pro assets, the oversize full-bleed product renders. |
| kiriminaja.com, 2026-10-29 | Local market / content reference (Indonesian shipping SaaS) | Home, 390/768/1440, signed out, `design/refs/kiriminaja/` (`design/refs/kiriminaja/1440.png`, `design/refs/kiriminaja/390.png`) | Hero makes the ongkir check the product hook; Bahasa copy, courier names front and centre; at 390 the ongkir widget stacks under the headline. Also: eyebrow pill over a centered headline, two CTAs, gradient wash, rating badge, 3×2 icon-tile card grid. | Ratings/member counts are their claims, not verified. Lazy-loaded content below the first screens rendered blank in the capture, so only the hero, the "Kenapa" grid, the app band and the footer were inspected; nothing below the fold is relied on. | Transfer: show the ongkir comparison itself as the explanation; name couriers in text. Exclude: the badge → centered headline → two CTAs template, gradients, ratings/member counts, icon-tile grids. |

## Direction
- Accepted direction: a calm Apple-style product page for a counter tool. Large left-aligned statements,
  one idea per full-width section, sections separated by a white/parchment background shift, and the
  product shown through live-rendered panels that match the real app (same tokens, radius, radio rows,
  tabular money) instead of screenshots or illustrations.
- Identity: the counter job itself (sender/recipient, 1 kg to Kota Bandung, couriers side by side,
  drop-off), Bahasa verb-first copy, the app's own brand tile (PackageCheck on #0066cc). Repeated
  intentionally: the app's radio-row and summary-rail look, so the site previews the product honestly.
- Responsive: 390 — single column, hero visual below the CTAs, steps as numbered rows, couriers in two
  columns, nav = brand + `Coba demo` + `Menu`; 768 — hero visual full width with its two-column internal
  layout (container query), steps as rows with a wide text column, couriers in four columns; ≥1024 — hero
  split text/visual, steps in three columns, tariff split visual-left/text-right, control split
  heading-left/list-right.
- Rejected: keeping the dark hero (the old page) — it hid the product and fought the light app; a 3×2
  business-type card grid — unrelated items in equal cards (template signal), folded into the hero lead.
- Portfolio comparison: not run; the brand system (system font stack, Apple blue, parchment) is already
  accepted for this product and is reused deliberately so the public site and the app read as one.

## Composition contract
- C10.1 Nav: sticky, solid white, hairline bottom, 52px tall; brand left, page links centered (≥1024),
  `Masuk` + `Coba demo` (pill) right; <1024 a `Menu` disclosure opening a full-width solid panel. No blur.
- C10.2 Hero (home): ≥768 two columns, text left (statement up to ~62px, one-sentence lead, demo CTA +
  `Daftar`), the four-row ongkir list right; <768 stacked text → list, sized so all four courier rows sit
  in the first 390×900 screen. Statement left-aligned at every width; "multi-kurir" never hyphen-breaks.
- C10.3 Display type: h1 `clamp(2.125rem, 1.2rem + 3.4vw, 4rem)` (home) / `clamp(2.375rem, 1.6rem + 3vw,
  3.5rem)` (sub-pages); h2 `clamp(2rem, 1.4rem + 2.2vw, 3rem)`; lead 19px → 21px; body 17px; meta 14px.
- C10.4 Rhythm: sections `py-20` (390) → `py-28` (≥768) → `py-32` (≥1024); no borders between sections,
  background shift only; content width 1120px; text columns ≤ 40rem.
- C10.5 Lists of features are open typography (bold lead-in sentence + muted continuation, hairline
  separators), never bordered cards; real sequences use plain numerals.
- C10.6 Visuals are single-level white panels (radius 18, hairline ring) on parchment, aria-hidden with a
  visible caption stating sample data. No shadow, gradient or fake device frame.
- C10.7 Closing CTA: dark band (`bg-foreground`), centered statement, `Coba demo` primary + `Daftar`
  secondary, activation steps beneath. Footer on parchment with the existing legal copy.
- Do not substitute: centered badge + headline + two CTAs + screenshot hero; equal icon-tile card grids;
  rounded bordered wrappers around sections; tracked-uppercase eyebrows; accent-colored headline words;
  stat strips of invented numbers; WhatsApp CTA in nav/hero.

## Tokens and behavior
- Colors: semantic tokens only — `bg-card` (white), `bg-background` (parchment), `bg-foreground` (dark band),
  `text-muted-foreground` (#333) for continuation text, `primary` for actions/links, `pending`/`info` soft
  tones for the "Simulasi" chip and selected quote row. No raw hex classes.
- Type: system stack from globals.css; `tabular` for money, counts and weights.
- Shape: radius 18 for panels, pill for actions; hairline `ring-border`.
- Motion: color transitions only (≤200ms); nothing on scroll; reduced motion loses nothing.
- States: static pages — no loading/empty states; every page ends with a next action. The mobile menu
  is a native `<details>` disclosure (keyboard and no-JS safe), re-mounted per route so it closes on
  navigation.

## Render critique
Author: omp worker `UiMarketing` (Claude Opus via 9router), builder of these pages.

Macro pass (before refinement): `/tmp/gx-mk1` home renders at 390/768/1280 viewed; findings fixed — the
hero panel's parcel line truncated at 390 and 768 (shortened), the closed mobile menu left 4px-wide links
in the layout (now `hidden` until open), the dev-tools badge overlapped renders (hidden in captures).
Round 1 independent review (REVISE) findings and what changed: active nav item now blue; the home
sequence now uses the same four steps as `/cara-kerja` (shared list); 768 tariff heading no longer
capped at 16ch; courier names reduced to 21–22px under the h2; the control column is left-aligned on the
page edge; the closing-band label aligns left with its step columns; the footer strip is just the
copyright; `/fitur` now shows the ongkir panel under the couriers lead and the "Kiriman baru" panel beside
the counter group; `/cara-kerja` h2 no longer repeats the h1; example lines are 15px; `/hubungi-kami`
numerals match `/cara-kerja`; `/simulasi` lead names what the page explains. Not adopted, with reasons
in "Page anatomy": a visible photo placeholder (production apex) and a `/simulasi` partnership rename
(banned claim). All five routes are now cited at all three widths.

Round 2 independent review (REVISE) findings and what changed: wider `Masuk`/`Coba demo` gap; hero panel
column widened to 32rem; the selected sample quote is now the cheapest (ID Express Rp 16.500); the courier
count is set large (~120px) above "kurir dapat dipesan dari satu layar." (Apple's large-figure treatment);
the home control column and the `/fitur` team column are centred narrow columns with left-aligned text
(Apple's x≈312 block; round 1 asked for either edge-aligned or centred, round 2 chose centred); the
closing band's stage list spans the full content edge with 24px numerals and now lists the same four
sign-up stages as `/hubungi-kami`; sub-page heroes put the title and the lead + actions side by side from
1024px, so no half-empty first screen; `/fitur` couriers group is heading on top, then ongkir panel |
list, and its counter group shows a different panel state (simulated resi issued); `/simulasi` gains a
"Siapa mengerjakan apa" ruled list (gerai / GeraiExpress / Mengantar), its first open FAQ is the demo
question, and its h2 no longer breaks into one-word lines.
Not adopted, with reasons: (1) a visible labelled photo slot — the owner's coordinator decided on
2026-10-29 not to ship a placeholder on the production apex; the shot brief is recorded under "Imagery
decision" and the slot location is named there. (2) A filled WhatsApp button on `/hubungi-kami` — the
owner's standing rule requires a secondary-style contact button with a monochrome icon. (3) Panels beside
the `/cara-kerja` rows — the rows already use the full width and the same panels appear on `/` and
`/fitur`; repeating them a third time adds no information.

Round 3 independent review (REVISE) findings and what changed: the hero now shows the four-courier ongkir
list (multi-kurir visible in the first screen) and the "Kiriman baru" summary moved to section 3 ("Ringkasan
jelas, lalu konfirmasi."); the courier list top aligns with the "8"; the home control section is now
edge-aligned text beside a saved-contacts panel (look of `/kontak`), not a text-only column; `/fitur`
uses a second ongkir sample (2 kg to Surabaya) so it does not repeat the home rows; the issued panel's
header no longer truncates ("Detail kiriman") and its summary rail no longer stretches; sub-page hero
columns are top-aligned with the lead's first line near the title's first baseline; the `/hubungi-kami`
demo aside is vertically centred against the WhatsApp block; the open mobile menu is captured. Still not
adopted: the photo slot (see "Imagery decision"; the coordinator's 2026-10-29 decision stands).

Round 4 independent review (REVISE), most important change and what changed: the home hero now puts all
four courier rows in the first screen at 390 (smaller narrow-width display size, one-sentence lead,
tighter top padding; checked on a 390×900 viewport capture) and runs text | ongkir list side by side from
768; "multi-kurir" no longer hyphen-breaks; the summary panel's step values wrap instead of truncating at
768 and "Total ongkir" stays on one line. The photo slot remains not adopted (coordinator decision).

Final renders (full page, opened and inspected slice by slice):

- `design/renders/home-1280.png`: nav → authored: slim solid bar, current page in blue, `Masuk` text +
  `Coba demo` pill; no eyebrow, no blur. Hero → left statement, lead, demo-first CTAs and a scope note
  beside the four-row ongkir list (selected row = cheapest). Counter day → four real steps in open
  columns. Summary → "Kiriman baru" panel left, confirm-before-send and real-vs-sample notes right.
  Couriers → large "8" over the statement, names as a ruled list aligned to its top. Control → lead-ins
  beside the saved-contacts panel. Closing band → dark, centred statement and actions, four stages on
  the content edge; footer parchment with the copyright only.
- `design/renders/home-768.png`: hero puts text and the ongkir list side by side; steps become numeral rows; the
  summary section splits 1:1; couriers run four across; contacts panel below the lead-ins.
- `design/renders/home-390.png`: statement → lead → CTAs → ongkir list; steps as rows; large count then
  two courier columns; nav keeps brand + `Coba demo` + menu. No clipping.
- `design/renders/menu-open-390.png`, `design/renders/menu-open-768.png`: open mobile menu — full-width
  solid panel, large page links with the current page in blue, `Masuk` + `Daftar` below a hairline,
  close icon in place of the menu icon.
- `design/renders/fitur-1280.png`, `design/renders/fitur-768.png`, `design/renders/fitur-390.png`: split
  hero; Surabaya ongkir sample beside the courier features; the issued-resi panel beside the counter
  features; a centred column for the team group.
- `design/renders/simulasi-1280.png`, `design/renders/simulasi-768.png`, `design/renders/simulasi-390.png`:
  split hero; model lead-ins beside the heading; ruled roles list; centred FAQ with native disclosures
  (chevron rotation disabled under reduced motion). A policy page, text-only by intent.
- `design/renders/cara-kerja-1280.png`, `design/renders/cara-kerja-768.png`, `design/renders/cara-kerja-390.png`:
  split hero; numeral / step / detail rows at 1280 collapse to numeral + text rows; demo section beside
  layout; three comparable equipment items in open columns.
- `design/renders/hubungi-kami-1280.png`, `design/renders/hubungi-kami-768.png`, `design/renders/hubungi-kami-390.png`:
  split hero without actions; one WhatsApp action (secondary pill, monochrome icon) after the explanation,
  a centred hairline-separated demo aside, then numbered sign-up rows ending in `Daftar` + `Coba demo`.
- §4.3.1 check: no tracked-uppercase eyebrows, no accent word in headlines, no icon-tile card grids, no
  rounded wrappers around sections, no invented stats (the only figure is the derived courier count).
  Familiar pattern kept on purpose: the dark closing band, because it ends every page after either tone.

## Acceptance evidence
- Independent review (`design/review.md`, `scripts/visual-review.py`, reviewer `claude`): ended **REVISE
  after 5 rounds** (the script's cap). The blocking finding in round 5 was the photo slot only, which the
  owner's coordinator declined (no visible placeholder on the production apex). Round 5's other findings
  were fixed afterward **without re-review**: the 390 hero top padding and gap were trimmed so all four
  courier rows fit in an 844px-tall first screen; the "Contoh: …" lines under the home counter steps were
  dropped; the `/fitur` team group is left-aligned to the content edge; `/cara-kerja` shows the
  saved-contacts panel beside step 1 and the "Kiriman baru" summary panel beside step 3 from 768 (hidden
  on phones to keep the sequence short). Visual acceptance therefore stays REVISE/UNVERIFIED; the renders
  in `design/renders/` postdate the review, so `design-gate.py` also reports the review as stale.
- Browser: `/`, `/fitur`, `/simulasi`, `/cara-kerja`, `/hubungi-kami` at 390/768/1280 — status 200,
  `scrollWidth - innerWidth = 0`, zero console errors at every width (throwaway Playwright script). The
  mobile menu opens, lists all pages + `Masuk`/`Daftar`, and is closed after navigating from it (390, 768).
- Tests: `tests/unit/marketing-rebrand.test.ts` 10/10; `tests/e2e/marketing.spec.ts` 5/5 on desktop-1280
  and 5/5 on mobile-390 (44px targets, overflow, banned copy, courier list, CTA hrefs).
- Contract: C10.1–C10.7 match in the renders above; deviation — the brief's "label dengan masking" and
  "cetak resi" are omitted because PR-34 is Partial and PR-35/T-036 forbid printing and label claims.
