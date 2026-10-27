# GeraiExpress — shadcn/ui and Apple-Inspired Operator Presentation

- Status: User-selected visual direction; component/screen contracts Proposed, no implemented UI.
- Owner: Engineering owner
- Updated: 2026-10-13
- Sources: CTX-19 user-provided reference; [shadcn/ui theming](https://ui.shadcn.com/docs/theming) for semantic integration. Apple website facts have not been independently audited.

## UI-1 — Operator presentation and tenant identity
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-2, CTX-14, CTX-19; reference composition inventory in TD-1.
- Statement: The operator application shall combine shadcn/ui controls with the supplied Apple-inspired blue/neutral presentation, explicit tenant/outlet identity, practical operational density, and accessible state/recovery feedback.
- Acceptance: Primary journeys at NFR-4 viewports expose current scope, labelled inputs/errors, keyboard actions, local table scrolling and pending/recovery states; token/composition review finds no decorative gradients, UI shadows, reference-brand leakage, or hidden primary action.
- Constraints: UX-1, UX-2, PR-13, NFR-4, TEN-1. Official label branding remains a provider capability, not a theme feature.
- Evidence: User reference and local component patterns reviewed; no rendered GeraiExpress screen exists.

Use the clean advanced LegacyReference checkout for compatible composition candidates:
page headers, field/error grouping, review dialogs, state badges with text,
local table scrolling, safe empty/error states, and focus announcements. The
proposed runtime is Next.js under CTX-20; shadcn/ui is the selected component
source. Inspect the eventual `components.json`, lockfile, semantic CSS and copied
components before choosing exact APIs. Install only components needed by accepted
screens; no component library or app scaffold was installed for this document.

The visual emphasis is the shipment and next operator action. Use white and
parchment surfaces, near-black text, one blue interactive accent, restrained
hairlines and consistent spacing. Marketing-style full-viewport tiles and
product photography belong to an accepted public page, if one is later needed.
Shipping intake, queues and settings use workspaces sized for their actual job.

## UI-2 — Semantic tokens and accessible states
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-19; SRC-SHADCN-THEMING in `sources.json`.
- Statement: Component styles shall use shared semantic tokens mapped to the supplied palette/type/spacing/radii, with accessible text, control boundaries, keyboard focus and non-color state cues.
- Acceptance: Contrast checks pass for essential text and controls on their actual surfaces; implementation uses semantic references rather than per-screen hex values; disabled/pending/error/selected/focus states remain distinguishable, and reduced motion disables press scaling.
- Constraints: UI-1, NFR-4, SEC-1. The supplied reference's gaps are filled by GeraiExpress operational contracts, not attributed to Apple.
- Evidence: Token specification only; browser/computed-style evidence pending.

### Color source tokens

Literal values belong in this central token definition. Component and screen
specifications reference these names; eventual CSS defines semantic variables.

| Token | Value | Allowed purpose |
|---|---|---|
| `colors.primary` | `#0066cc` | Interactive accent on light surfaces; primary button fill |
| `colors.primary-focus` | `#0071e3` | Keyboard focus and selected-control ring |
| `colors.primary-on-dark` | `#2997ff` | Text links on dark surfaces |
| `colors.canvas` | `#ffffff` | Content/card/input surface; primary button text |
| `colors.canvas-parchment` | `#f5f5f7` | Page canvas, quiet section and frosted base |
| `colors.surface-pearl` | `#fafafc` | Secondary pearl control |
| `colors.surface-tile-1` | `#272729` | Optional dark feature surface |
| `colors.surface-tile-2` | `#2a2a2c` | Adjacent dark surface variant |
| `colors.surface-tile-3` | `#252527` | Dark embedded surface variant |
| `colors.surface-black` | `#000000` | Optional slim global nav or media background |
| `colors.surface-chip-translucent` | `rgba(210, 210, 215, 0.64)` | Circular controls over imagery only |
| `colors.ink` / `colors.body` | `#1d1d1f` | Essential light-surface text and dark utility buttons |
| `colors.body-on-dark` | `#ffffff` | Essential dark-surface text |
| `colors.body-muted` | `#cccccc` | Secondary text on dark surfaces |
| `colors.ink-muted-80` | `#333333` | Essential secondary text on light surfaces |
| `colors.ink-muted-48` | `#7a7a7a` | Disabled text only where exempt; not essential small copy on light canvases |
| `colors.divider-soft` | `#f0f0f0` | Nonessential separator and pearl ring |
| `colors.hairline` | `#e0e0e0` | Nonessential card/table separator |
| `colors.control-border` | Alias `colors.ink-muted-48` | Functional input/control edge when the edge identifies the control; verify ≥3:1 against adjacent surface |
| `colors.error-ink` / `colors.status-ink` | Alias `colors.ink` | Error/status text with explicit label and icon; no second brand accent |

Essential secondary/legal/instruction text uses `colors.ink-muted-80`, including
fine print needed for a decision. The lighter muted token does not meet the
normal-text 4.5:1 target on the supplied light canvases. A hairline may separate
rows/cards but cannot be the only visible boundary of an otherwise invisible
input. Validate actual combinations rather than assuming every reference token
is accessible in every use. Status badges use neutral surfaces, text and distinct
icons; blue remains an action/focus signal. Error, success and restriction never
rely on color alone.

### shadcn semantic mapping

| Semantic variable / family | Light operator mapping | Scope |
|---|---|---|
| `background` / `foreground` | `colors.canvas-parchment` / `colors.ink` | App canvas |
| `card`, `popover` and paired foregrounds | `colors.canvas` / `colors.ink` | Content and overlays; no decorative shadow |
| `primary` / `primary-foreground` | `colors.primary` / `colors.canvas` | Main action |
| `secondary` / `secondary-foreground` | `colors.surface-pearl` / `colors.ink-muted-80` | Quiet utility action |
| `muted` / `muted-foreground` | `colors.canvas-parchment` / `colors.ink-muted-80` | Essential secondary content |
| `accent` / `accent-foreground` | Neutral surface / `colors.ink` | Neutral selected menu surface; does not introduce another brand color |
| `border` | `colors.hairline` | Nonessential separators |
| `input` | `colors.control-border` | Visible control edge |
| `ring` | `colors.primary-focus` | Visible keyboard focus, with offset/separation |
| `destructive` and paired foreground | `colors.ink` / `colors.canvas` | Explicitly named destructive action, icon and effect confirmation; no implicit red requirement |
| `sidebar` family | Matching neutral surface/text/border; blue for interactive current-scope cue where appropriate | One reused shell |

Treat this as a mapping contract, not an assumption about a particular shadcn
style's generated variable syntax or base primitive. Do not copy default
shadows, gradients, font weight 500, or radius arithmetic that contradicts the
selected design. Dark tiles are scoped surfaces, not a promised global dark-mode
toggle. A complete operator dark theme needs its own contrast/state proof before
enablement.

### Typography

Use native system fonts: `system-ui, -apple-system, BlinkMacSystemFont, sans-serif`.
Let Apple devices resolve their system face; do not bundle proprietary SF Pro.
Inter is an optional self-hosted licensed substitute only if consistency is
needed later, not a dependency required by this spec. Headings use weight 600;
body/UI default 400; deliberate 300 and exceptional 700 only where specified.
Do not introduce 500 as an unreviewed component default.

| Token | Size / weight | Line height | Tracking | Use |
|---|---|---|---|---|
| `type.hero` | 56px / 600 | 1.07 | -0.28px | Optional public hero |
| `type.display-lg` | 40px / 600 | 1.10 | 0 | Public tile / major section |
| `type.display-md` | 34px / 600 | 1.47 | -0.374px | Workspace/section heading where space permits |
| `type.lead` | 28px / 400 | 1.14 | 0.196px | Short public feature line |
| `type.lead-airy` | 24px / 300 | 1.50 | 0 | Rare editorial lead |
| `type.tagline` | 21px / 600 | 1.19 | 0.231px | Context title / subnav |
| `type.body` / `type.body-strong` | 17px / 400 or 600 | 1.47 | -0.374px | Form/paragraph/essential explanatory text |
| `type.dense-link` | 17px / 400 | 2.41 | 0 | Optional footer link stacks |
| `type.caption` | 14px / 400 | 1.43 | -0.224px | Table utility content and supporting labels |
| `type.caption-strong` | 14px / 600 | 1.29 | -0.224px | Compact emphasis |
| `type.button-utility` | 14px / 400 | 1.29 | -0.224px | Compact utility labels |
| `type.button-large` | 18px / 300 | 1.00 | 0 | Optional public store-style primary action |
| `type.fine-print` | 12px / 400 | 1.30 | -0.12px | Noncritical metadata; never important form guidance |
| `type.micro-legal` | 10px / 400 | 1.30 | -0.08px | Nonessential supplied-reference detail only; no operational requirement uses this size |
| `type.nav` | 12px / 400 | 1.30 | -0.12px | Optional public global nav, not essential mobile operator controls |

The operator adaptation raises fine-print/nav leading from the supplied 1.0 to
1.3 for wrapping. Essential body stays at least 1.47, including an optional Inter
substitute. Tables use tabular numerals and right-aligned IDR amounts; no
`font-variant-numeric: numerator` for operational money. Keep IDR whole-rupiah
formatting and units explicit, independent of display style. Long Indonesian
labels, names, addresses, zoom and text-spacing overrides must remain usable.

### Spacing, geometry and depth

| Token family | Values | Contract |
|---|---|---|
| `space` | xxs 4, xs 8, sm 12, md 17, lg 24, xl 32, xxl 48, section 80px | Structural rhythm mainly 8px; supplied 17px retained for text spacing |
| `radius` | none 0, xs 5, sm 8, md 11, lg 18px; pill/full 9999px | Utility 8, pearl 11, content cards 18, primary/search pills; full-bleed sections 0 |
| `layout` | Text max 980px; content max 1440px; gutters 20–24px | Wide screens absorb margin; wide tables scroll locally |
| `size.touch` | At least 44 × 44px | Mobile/coarse-pointer controls and icon buttons |
| `effect.product-shadow` | `rgba(0, 0, 0, 0.22) 3px 5px 30px 0` | Product imagery only; no cards/buttons/text/table shadow |
| `effect.frosted` | Parchment 80%; saturate(180%) blur(20px) | Sticky context/action bars only; opaque fallback and contrast proof |
| `motion.pressed` | Scale 0.95 | Buttons during press; no layout shift; disable with reduced-motion preference |
| `focus` | 2px `colors.primary-focus` with visible offset | Keyboard focus cannot be clipped/covered; scoped dark-link/focus contrast must pass |

No decorative gradients. Hairlines and surface changes create hierarchy.
Compact row/content density cannot reduce mobile hit targets; prefer 48px rows
for touch and 40px rows for default desktop single-line utility data, with more
height for wrapping. Cards have 24px padding, forms group related fields with
24–32px section spacing, and public tiles alone use 80px section padding.

## UI-3 — Components, shell, and responsive handoff
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-19; UX-1 and UX-2 own workflow semantics.
- Statement: Shared components shall implement the selected action/surface grammar and adapt the operator shell, intake, tables and overlays to content and input mode without losing scope, focus or entered data.
- Acceptance: Rendered primary journeys at 390/768/1280px and relevant breakpoint boundaries preserve action access, 44px touch targets, 200% zoom usability, readable errors, sticky-bar focus clearance and localized table scrolling; default/pressed/focus/disabled/pending/error states match their contracts.
- Constraints: UI-1, UI-2, UX-1, UX-2, NFR-4. No screen is complete through compilation alone.
- Evidence: Design handoff only; UI/browser checks not executed.

### Component grammar

| Component | Default and pressed contract | Operational use |
|---|---|---|
| Primary button | `colors.primary` + `colors.canvas`, `radius.pill`, body 17px/400, 11px vertical/22px horizontal padding; `motion.pressed` | One dominant current action: obtain quote, confirm shipment, create account, print ready label |
| Secondary pill | Transparent, `colors.primary` text and 1px action-blue boundary, same pill grammar | Alternative action when genuinely parallel; dark surfaces require scoped accessible text |
| Dark utility button | `colors.ink` + `colors.canvas`, `radius.sm`, utility type, padding 8px/15px; `motion.pressed` | Compact utility/sensitive action with explicit label; touch target still ≥44px |
| Pearl capsule | `colors.surface-pearl`, `colors.ink-muted-80`, soft 3px ring, `radius.md` | Quiet optional action; ring alone is not a functional input border |
| Circular icon action | 44px square, full radius, accessible name; translucent chip only over imagery | Close/imagery control; use neutral solid surface in operational UI |
| Text link | `colors.primary`; dark surface uses `colors.primary-on-dark` | Recognizable action label and visible focus |
| Search | White surface, body type, `radius.pill`, 44px minimum height, leading icon, labelled input and visible control edge | Shipment/contact search with server pagination; retain query in meaningful navigation state |
| Form control | Body 17px/400, white surface, `radius.sm`, visible control edge, persistent label/helper/error | Native form behavior, autocomplete/input mode as appropriate; no placeholder-only label |
| Option chip | White pill, caption label and optional price; 2px focus-blue selected outline plus check/selected text | A real radio/selection control for courier/service; unavailable option gives a visible reason |
| Content card/table | White, nonessential hairline, `radius.lg`, no shadow; tables have clear header/body hierarchy | Shipment review, settings and lists; no nested decorative card stack |
| Sticky context/action bar | Frosted or opaque parchment, concise scope/review summary; reserve its occupied space | Keep current tenant/outlet visible and review total/action reachable; never obscure errors/focus |
| Dialog/sheet/alert | Neutral surface, explicit title/effect/action, focus containment/restoration, no decorative shadow | Confirmation, contact selection, mobile navigation, durable errors; transient toast is not the only error record |

Document default and active/pressed treatments only, plus the required focus,
selection, disabled, pending, validation and recovery semantics. Do not add a
hover-state specification. A pending action retains its label/width and explains
progress; UI disabling supplements backend idempotency. Readiness denials and
form failures remain visible near the relevant action, not only in a tooltip.

### Screen composition

- **Shell:** one neutral sidebar and context header on desktop; compact navigation sheet on mobile. Tenant/outlet identity stays visible beyond the switcher. A public 44px black global nav and 52px frosted subnav are optional accepted-page patterns, not mandatory extra chrome above the operator workspace.
- **Shipment intake:** labelled Sender / Recipient / Pickup / Parcel sections, clear courier choices, then review summary and explicit submission. Keep common contact reuse nearby. A sticky action summary may be 64px high where it fits; allow wrapping instead of clipping long totals/labels.
- **Shipment queue:** filters/search, status/action priority, then a paginated table; compact mobile rows/cards show reference, party summary, status and next action. Full detail and permitted contact values remain accessible. Empty-first-use, filtered-empty, denied and failed-load states have different guidance.
- **Onboarding/settings:** short explanatory header, choice/form or durable progress, then independent capabilities and account-access help. Saved credentials never appear as a value to reveal.
- **Overview:** exception/work-needed section first. Add only accepted authoritative metrics; finance charts and ornamental KPI cards do not follow from the visual reference.

### Responsive and accessibility checks

| Width / input boundary | Expected adjustment |
|---|---|
| ≤419px | Single-column forms and review; optional public hero 28px; scope and main action remain reachable |
| 420–640px | Single-column workspace; optional hero 34px; primary/secondary actions wrap safely |
| 641–833px | Simplified navigation; content stacks when labels need room; optional public tile padding 48px |
| 834–1068px | Expanded navigation only when available width fits; two-column intake/review where usable; optional hero 40px |
| 1069–1440px | Sidebar/workspace layout; practical field grid; wide table remains in its container |
| ≥1441px | Content max 1440px; margins absorb extra width |
| Coarse pointer at any width | All actionable targets ≥44 × 44px; useful row spacing, no precision-only actions |

Boundary tests include 419/420, 640/641, 833/834, 1068/1069 and the 1440px
content lock when the corresponding composition is implemented. Reconcile
734/735 and 480px reference sub-breakpoints only if content needs them; do not
create redundant CSS queries. Optional public grids may step 5→4→3→2→1; operational
forms/tables follow content rather than a product-grid column count.

At 390/768/1280px, test keyboard order, focus return, errors and stale scope,
long data, denied roles, pending/unknown/unpaid states, reduced motion, 200% zoom,
text spacing and local overflow. Sticky bars reserve space and scroll padding.
Imagery, if accepted, uses responsive sizes/crops, eager above-fold hero loading,
and lazy loading below; no product photography is required to ship the console.

## Tenant branding and provider-authoritative output

Tenant names and validated logo assets can identify the workspace under PR-13.
They cannot override the shared blue action/focus tokens, permissions, required
text, or accessible state meaning. Do not show Apple logos/assets or reference
LegacyReference brand strings as GeraiExpress branding.

Application branding, a possible customer receipt, and an official courier PDF
are separate surfaces. Supported customer sender name/phone uses the provider
Dropshipper authority while pickup remains the seller's selected location.
Arbitrary logo/layout replacement on official labels, custom domains and receipt
content are not established by this design. Advanced local thermal/batch print
and invoice composition remain TD-1 candidates, subject to accepted requirements
and courier proof; UI customization cannot fabricate an AWB or routing authority.

## UI-4 — Super Admin presentation and information priority
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-29, CTX-30; UX-6 owns screens/actions and UI-1 through UI-3 own shared tokens.
- Statement: The Super Admin workspace shall reuse the shadcn/ui + Apple-inspired token system with persistent platform scope, an exception-first overview, responsive business/operation tables and clear sensitive-action feedback.
- Acceptance: At NFR-4 viewports, platform context, selected tenant/period, freshness and next permitted action remain visible; keyboard/touch/focus work, tables scroll locally, and partial/stale/denied/empty states cannot be confused with healthy results.
- Constraints: UX-6, PR-25, IAM-7, UI-2, NFR-4. No new decorative palette, dashboard library, template or runtime is selected by this handoff.
- Evidence: Reference composition and accepted direction inspected; no rendered GeraiExpress platform UI exists.

Reuse one shell with explicit Platform / Super Admin context, grouped navigation
for Overview, Gerai, configured Registration Review, Diskon, Integrasi, Operasi,
Audit and permitted Platform Access. Global scope and selected tenant detail
have visible labels; neither looks like tenant impersonation. Keep normal
gerai navigation/context separate.

Overview order: urgent worklist → concise defined current/period signals →
affected-tenant or operation table. A trend/chart is optional when it answers a
real question with authoritative data; ornamental revenue cards are excluded.
Tenant/operation workspaces prioritize search, filters, readable status/reason,
update time and one valid next action rather than a card per field.

Sensitive decisions show target, effect, reason and pending/result state, using
the existing neutral/blue grammar and explicit text/icons. Preserve input on
conflict/failure and focus after dialogs/results. Required information cannot
be tooltip-only. Default/pressed, focus, disabled and pending treatments follow
UI-2/UI-3; no additional hover specification. On mobile, expose the essential
business/status/action summary with a detail path and locally scrolling tables.
Use no new visual elevation or dense gradients for a privileged role.

## UI-5 — Registration and account-entry presentation
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-19, CTX-31, CTX-34; UX-7, UX-8.
- Statement: Registration, verification, review status and invitation screens shall use the shared shadcn/Apple-inspired system with a visible current stage, one clear primary action and accessible validation/recovery.
- Acceptance: At NFR-4 sizes, email/code/password/business fields, active stage, errors, resend availability and next action remain usable by keyboard/mobile without overflow, color-only status or implying account/provider readiness prematurely.
- Constraints: UI-1, UI-2, UI-3, UX-7, UX-8, SEC-5; no new visual theme or rendered proof.
- Evidence: Screen/component specification only; browser verification pending.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.

Use a compact form container, quiet neutral surfaces and blue primary action.
Progress shows identity → gerai → review → Mengantar → readiness, with conditional
review status clearly explained. Do not force five separate routes or large
marketing tiles. Keep demo, sign-in and invited-staff entries visible without
making them additional signup requirements.

Use labelled email, one accessible code field supporting paste/autofill, and
password controls with an explicit visibility toggle. A shadcn OTP presentation
is optional only if paste, keyboard and screen-reader behavior are verified.
Pending/expired/wrong-code states preserve the email and focus the useful result.
Display actual configured expiry/resend availability, not copied reference timers.
Never persist a password/code in form recovery or echo it in server errors.

Business/application forms preserve non-secret values and focus the first invalid
field. Status panels state what is pending, who acts next and what can be edited.
Use a clearly labelled manual-review branch if selected; do not tell users an
email was delivered, a seller created or shipping enabled without that evidence.
All account screens share UI-2 tokens, focus/reduced-motion rules and touch targets.
