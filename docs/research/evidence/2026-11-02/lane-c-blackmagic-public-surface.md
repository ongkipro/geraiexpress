# Lane C: Public surface of Indonesian multi-courier counter/agent apps (black-magic, public only)

- **Collected:** 2026-11-02, around 13:00–14:30 WIB (date on the host: Mon 2 Nov 2026)
- **Scope rules followed:** no logins, no accounts, no credentials, no auth/paywall bypass, and no write requests. I did not use any third-party AWB (tracking number) to pull real shipment data. I fetched only publicly served HTML/JS, Google Play listing, data-safety and review pages, `robots.txt`, and sitemaps. I checked robots before crawling every web host. All `/api/` paths below come from reading client bundles statically. **None of them was called.** Requests were spaced (~150 ms between JS chunks, 1–2 s between hosts and Play pages).
- **Secrets policy:** several public bundles ship client-side keys in runtime config: Google Maps keys, reCAPTCHA site keys, analytics IDs, and in one case a variable *named* `*_SECRET_KEY`. **No values are reproduced here.**
- **Labels:** **[O]** means Observed, with the URL and the 2026-11-02 date. **[I]** means Inference.
- **Raw evidence (local):** `~/Documents/work/research/geraiexpress-2026-11/lane-c-raw/`
  - `play.json`: listing metadata, descriptions, and the 40 newest reviews per app
  - `datasafety.json`: the Play data-safety page text
  - `review_categories.txt`
  - `web/`: home pages
  - `bundles/<vendor>/`: fetched JS, with the source URL on line 1 of each file

---

## 0. TL;DR for GeraiExpress

1. **Money is the top pain.** I sampled 396 recent reviews across 11 agent/aggregator apps. Of the 177 negative (1–3★) reviews, the most common complaints were:
   - withdrawal / saldo / COD payout: **37**
   - slow or robotic CS: **31**
   - app error / login / OTP: **31**
   - KYC/verification friction: **30**
   - COD/retur/claim/lost parcel: **24**
   - account suspended with balance locked: **14**
   - fraud against COD recipients: **12**

   Pickup failure (8) and weight/ongkir discrepancy (5) are real but smaller in this sample. "Komisi turun" appeared **0** times. **[O/I]**
2. **Counter (loket) features are rare among the seller aggregators.** Their dashboards (KiriminAja, Lincah, Mengantar, Biteship) are seller-OMS shaped: COD, bulk upload, WhatsApp follow-up, claims, staff.
   - Counter features (struk, Bluetooth ESC/POS printing, timbangan, QRIS at the counter) show up mainly in bosAgen (Bluetooth ESC/POS receipt printing in the web bundle), SIMASRIM (EDC Android + SQRIS soundbox + "Dashboard Pusat" for branches/resellers), Fastpay (cetak struk, EDC, QRIS merchant, Bluetooth printer complaints), and AutoKirim (gives loket kits with timbangan + printer on account upgrade).
   - UKURIR asks drop-point partners to *provide* a scale, a label printer and a measuring tool. **[O]**
3. **Staff/role features exist, but they are seller-team roles, not counter-shift roles.**
   - KiriminAja: `/staff`, `/staff/activity`, `/employees/assignment`, `staffAccesCode` codes `all_oms/co_oms/prd_oms/cmp_oms/rtr_oms`, staff OTP and shifts.
   - Lincah: `/sub-account` ("manageTeam"), plus warehouse roles Admin/Manager/Staff/Viewer Gudang.
   - Mengantar: sub-users with Default/Custom/CRM permissions.
   - Biteship: `user_access_management/roles` and invitations.
   - None shows a cash-drawer / shift-close / per-cashier struk model. **[O for the routes, I for the absence]**
4. **Label masking is most explicit in Biteship and Mengantar.**
   - Biteship's label settings have toggles for `origin_phone_shown`, `origin_address_shown`, `receiver_phone_shown`, `receiver_address_shown`, `censor_receiver_name`, `shipping_fee_shown`, `insurance_fee_shown`, `items_shown`, `item_sku_shown`, plus `paper_size`.
   - Mengantar has hide sender address, hide address+city+phone, hide recipient phone, and `mask_name`.
   - Lincah has `hideSpxCodAmount` and thermal 10×10/10×15 and A-series label layouts. **[O]**
5. **Privacy on public tracking varies widely.** Our page should beat the field: city-level only, masked names, no phone, and no POD photo unless the visitor is verified.
   - **Biteship's branded tracking page** (track.biteship.com) maps origin/destination **contact name + full address** and driver name/phone/plate/photo from a public endpoint.
   - **SIMASRIM's cek-resi** shows recipient name + destination city + POD photo link.
   - **bosAgen's public lacak** maps sender name, receiver name, receiver kecamatan/kota, and branch.
   - **KiriminAja's public tracking** shows origin/destination name + city + province.
   - All of these were read from client bundles, not tested with a live AWB. **[O for field mapping; I for exact rendering]**

---

## 1. Google Play listings (all **[O]**, fetched 2026-11-02, `hl=id&gl=id` unless noted)

The "Installs" column shows the band, with the Play-internal `realInstalls` figure in parentheses. "Updated" comes from the Play listing; dates marked † were read from the English listing page because the scraper returned null.

| Product | Package | Developer | Installs | Rating | # ratings | Updated | Version | Released |
|---|---|---|---|---|---|---|---|---|
| bosAgen | `com.boscod.agen` | PT Hadid Parama Indonesia | 1.000+ (1,112) | 3.56 | 18 | Jan 7, 2026† | varies | 11 Nov 2024 |
| BosCOD (same dev, seller app) | `com.boscod.mobile` | PT Hadid Parama Indonesia | 100.000+ (156,480) | 3.80 | 1,343 | Oct 27, 2026† | varies | 4 Feb 2022 |
| SIMASRIM | `com.simasrim.edc` | Solusi Mitra | 500+ (583) | n/a | 0 | Aug 18, 2026† | varies | 3 Jul 2025 |
| KiriminAja | `id.tries.kiriminaja` | KiriminAja | 500.000+ (505,015) | 4.25 | 11,249 | 13 Okt 2026 | 3.4.377 | 21 Des 2020 |
| Komship | `com.komerce.komshipmobile` | PT Kampung Marketerindo Berdaya (Komerce) | 50.000+ (61,886) | 3.59 | 490 | 21 Agu 2026 | 1.4.9 | 3 Mei 2023 |
| AutoKirim | `com.autokirim` | AutoKirim (PT Auto Serba Digital on iOS) | 50.000+ (90,858) | 4.77 | 802 | 29 Okt 2026 | 2.6.3 | 27 Des 2022 |
| Fastpay | `com.bm.main.fpl` | Toko Modern Fastpay | 1.000.000+ (2,879,847) | 4.75 | 51,128 | 30 Okt 2026 | 7.1.2 | 6 Jan 2016 |
| Everpro | `id.co.popaket` | Everpro | 100.000+ (382,023) | 3.83 | 2,184 | 16 Okt 2026 | 1.53.0 | 1 Feb 2021 |
| Lincah | `com.lincah.id.prd` | Lincah ID | 5.000+ (6,997) | 4.12 | 116 | 22 Okt 2026 | 1.0.19 | 10 Mar 2025 |
| Mengantar | `com.mengantar` | Mengantar | 100.000+ (190,943) | 3.62 | 320 | 28 Okt 2026 | 8.0.1 | 2 Okt 2023 |
| Agenpos | `com.bedigital.fintech.dev` | Pos Indonesia | 5.000+ (5,402) | 4.35 | 48 | 28 Apr 2026 | 1.21.11 | 6 Okt 2025 |
| Pospay Agen (related) | `com.bedigital.fintech` | PT POS Finansial Indonesia | 100.000+ (308,886) | 4.51 | 2,457 | Sep 3, 2026† | varies | 20 Des 2018 |
| JNE Mobile Agent (courier-owned) | `com.jnemobileapp` | PT TIKI Jalur Nugraha Ekakurir | 100.000+ (297,324) | 1.56 | 1,536 | 24 Jan 2024 | 1.1.5 | 26 Mei 2020 |
| INDOPAKET (Indomaret counter network) | `app.indopaket` | PT Inti Paket Prima | 500.000+ (557,060) | 3.13 | 5,507 | 1 Okt 2026 | 2.25.0 | 2 Apr 2018 |

Other packages:
- **KirimAja** (Garuda Indonesia Group). kirimaja.id links to `com.garudaindonesia.kirimaja`, but the **Play listing returned HTTP 404 on 2026-11-02**, so it is likely unpublished or region-hidden. An iOS app id `id1508888414` is linked from kirimaja.id. **[O]**
- **Biteship.** No merchant Android app found on Play; Play search for "Biteship" returns unrelated apps. Biteship is web/API-first. **[O search / I conclusion]**
- **UKURIR.** No Play app found. The only "UKUR Agen" hit (`com.ukur.agent`) is an unrelated property app removed in 2025, per chrome-stats. UKURIR is web-only (ukurir.com, Laravel/Vite) with Indonesia, Malaysia and Singapore locales. **[O]**
- **Other relevant apps found:** `com.mengantar.form` (Mengantar "Formulir" order form), `id.android.kmpartner` (Komerce partner), `rpx.superapps.mobile`, `app.trawlbens.customer` (Troben), and `com.posindonesia.cob` (PosAja!). These were not deep-dived.

### 1.1 Declared data safety (Play `datasafety` page, English, **[O]**)

| App | Shared with third parties | Collected (purpose) | Encrypted in transit | Deletion request |
|---|---|---|---|---|
| bosAgen | **Contacts** (app functionality) | Photos; Device IDs; User payment info; Phone number + Other info; In-app messages; Crash logs, Diagnostics; Contacts | Yes | Yes |
| BosCOD | **Address, Phone number, Contacts** | Device IDs; In-app messages; Email, Address, Phone, Other; Crash/diag; Payment info; Photos; Contacts | Yes | Yes |
| SIMASRIM | None | "No data collected" | Yes | Yes |
| KiriminAja | Crash logs (analytics) | Photos & Videos (optional); App activity (analytics, **advertising**); Files & docs (optional); Name; Contacts (optional); Crash logs | Yes | Yes |
| Komship | None | "No data collected" | Yes | Yes |
| AutoKirim | None | Device IDs; **Approximate + precise location**; Name, Email, User IDs, Address, Phone; Photos | Yes | Yes |
| Fastpay | None | Photos (optional); Approx + precise location (optional, fraud prevention); Device IDs; Crash logs | **"Data isn't encrypted"** | Yes |
| Everpro | None | Precise location (optional); Name, Email, User IDs, Phone (incl. advertising/marketing purposes) | Yes | Yes |
| Lincah | None | "No data collected"; **no security-practices section shown** | not declared | not declared |
| Mengantar | None | "No data collected" | Yes | Yes |
| Agenpos | None | "No data collected" | Yes | Yes |
| Pospay Agen | None | "No data collected" | Yes | Yes |
| INDOPAKET | None | "No data collected" | Yes | Yes |

**[I]** "No data collected" is implausible for apps that run KYC with KTP and selfie. Reviews for Komship, Lincah and Mengantar describe KTP/selfie uploads. These declarations are under-reported, which is a credibility opening: an honest, complete data-safety form plus an in-app privacy summary. The Fastpay "not encrypted" declaration is unusual for a fintech app.

### 1.2 Recent reviews (40 newest per app; Agenpos had 24, bosAgen 12)

Method: I took the newest reviews (`Sort.NEWEST`, `lang=id`, `country=id`) and keyword-coded the 1–3★ reviews into categories. A review can count in several categories. The coding is regex-based, so treat counts as ±20%. Full texts are in `play.json`.

| App | Window | Avg (sample) | 1–3★ / 4–5★ | Dev replied | Main negatives (count) | Main praise |
|---|---|---|---|---|---|---|
| bosAgen | 2024-11-13 → 2026-07-03 | 3.33 | 7/5 | 12/12 | won't run / "terjadi kesalahan" (3), registration with an existing BosCOD account fails (1), activation fails (1) | cheap ongkir + pulsa, easy |
| BosCOD | 2025-12-13 → 2026-10-29 | 2.95 | 20/20 | 38/40 | COD/retur/lost (8), **recipients receive WhatsApp scam asking to transfer** (5), CS (5), saldo (4), suspend (2) | easy, helpful |
| KiriminAja | 2026-09-12 → 2026-10-30 | 3.02 | 21/19 | 0/40 | CS / "mohon maaf kami FU" (5), **pickup no-show** (4), **weight/ongkir changed** (3: "165 g dibuat 1 kg"), cancellation fee (2), resi download fails (1), KTP upload fails (1) | sits-at-home pickup, minim retur |
| Komship | 2025-08-25 → 2026-11-01 | 2.60 | 25/15 | 21/40 | **KYC/verification** (9), **app/login/session** (7), saldo/withdraw (6, incl. Rp2,000 withdrawal fee), recipient fraud (4), account blocked with balance (3) | COD from one app |
| AutoKirim | 2026-09-19 → 2026-10-26 | 4.25 | 8/32 | 3/40 | CS slow (5), **COD saldo locked until all retur settle** (3) | cashback, free pickup, real-time withdraw |
| Fastpay | 2026-10-26 → 2026-11-01 | 3.95 | 11/29 | 40/40 | admin fees high (2), bank transfer slow (~10 min), login after device change, **"bluetooth tidak bisa ke printer bluetooth"** (1) | income/commission, "cetak struk" |
| Everpro | 2026-04-09 → 2026-10-31 | 3.17 | 19/21 | 40/40 | **saldo can't be withdrawn for 2+ days** (8), **suspend after changing bank account** (6), CS template replies (5) | "lebih baik dari BosCOD" |
| Lincah | 2025-11-23 → 2026-10-16 | 3.27 | 19/21 | 37/40 | **KYC incl. video-call interview** (8), app bugs/OTP (5), WD not on holidays/delays (5), ongkir 7,200 → 11,000 after delivery (1), courier swapped contents (1) | cheap ongkir, open API, courier performance comparison |
| Mengantar | 2025-10-21 → 2026-09-20 | 2.67 | 24/16 | 40/40 | app crash/OTP/Cloudflare (7), KYC (6), saldo held 90 days or locked ~1 year (4), resi download fails (1), no notification on problem shipments | best ticket/live-chat CS (4) |
| Agenpos | 2025-10-17 → 2026-10-25 | 3.96 | 8/16 | 0/24 | **"Resi tidak langsung tercetak… harus dicetak manual ke Riwayat"**, saldo vanishing, can't activate courier service, no Android 9 APK for an "Android POS" device | helps UMKM, agen paket + pulsa |
| Pospay Agen | 2025-07-09 → 2026-10-31 | 3.50 | 15/25 | 4/40 | device incompatibility, BRI top-up failing for months, "belum bisa cetak struk" | many billers |
| JNE Mobile Agent | 2025-09-26 → 2026-10-16 | 1.23 | 38/2 | 0/40 | courier delivery delays (consumers rating JNE as courier), no register button | n/a |
| INDOPAKET | 2026-09-04 → 2026-10-30 | 2.02 | 30/10 | 0/40 | parcel stuck at store for days, CS unresponsive (8), **counter charged more than app quote** (12k → 32k; 6,750 → 67,500), weight 1 pc = 2 kg | cheap, store pickup |

**Pooled across the 11 agent/aggregator apps** (396 reviews, 177 negative; JNE consumer app and INDOPAKET excluded), **[O counts / I coding]**:

| Category (user's taxonomy) | Neg mentions |
|---|---|
| saldo / withdraw / pencairan | **37** |
| CS lambat / template / bot | **31** |
| aplikasi error / login / OTP / crash | **31** |
| verifikasi / KYC (KTP, selfie, video call) | **30** |
| COD / retur / klaim / hilang | **24** |
| akun suspend/blokir with balance | **14** |
| penipuan via recipient data (COD scam WA) | **12** |
| pickup gagal / telat | **8** |
| biaya admin / potongan | **7** |
| selisih berat / ongkir berubah | **5** |
| cetak resi / printer / struk | **5** |
| komisi turun | **0** |

Notes:
- **[I]** Several apps show bursts of short, near-identical 5★ reviews: Komship on 2026-02-03 and 2025-08-25, Lincah on 2025-11-23/27, AutoKirim in late September 2026, and Fastpay's voucher-code reviews ("Isiin kode Voucher 👉PROFIT👈"). Their positive ratings are likely inflated by campaigns or referrals. AutoKirim's 4.77 should be read in that light.
- **[I]** The "recipients get a scam WhatsApp" complaint (BosCOD, Komship, Lincah) points to leakage of recipient phone + COD data. That argues for minimal public tracking fields and masked phones on labels.
- **[I]** INDOPAKET's "app quote ≠ counter charge" complaints are a direct counter-POS lesson: the struk must be generated from the same quote the customer saw, with the weight/dimension recalculation shown line by line.

---

## 2. Public web app / marketing JS bundles

All entries are **[O]** with the date 2026-11-02. File URLs are as fetched; filenames are content-hashed and will rotate.

### 2.1 KiriminAja (dashboard SPA, Nuxt 3)
Entry `https://app.kiriminaja.com/` → `https://kaj-prd-dshbd-v2-assets.kiriminaja.com/public/deployment/v3.17.12/html/_nuxt/*.js`. I fetched 400 chunks (capped). The runtime config is inlined in the HTML: base API host `prd-kaj-srvc-dshbd-api-ext.kiriminaja.com/api/dm`, a CRM host, and an OMS embed CDN. Keys are not reproduced.

- **Menu labels** (`{title,key,path}` objects): Kirim Paket (regular/instant/cargo/international), Proses Paket, Riwayat Paket, Upload Paket, Parse Paket, Klaim Paket, Undelivery, Pencairan COD, Mutasi Saldo, Laporan Saldo, Statistik Pengiriman, **Performa Ekspedisi**, **Cek Penerima** (`/check/receiver`, "Cek Potensi RTS"), Cari Kode Pos, Cek Ongkir, **WhatsApp Follow Up** (`/settings/whatsapp-fu`), **Manajemen Staff** → Daftar Staff `/staff`, **Aktivitas Staff** `/staff/activity`, Deposit Kredit, Voucher, Referral/Ajak Kirim, ROMS (CRM: chat, campaign, segmentasi, reminder, template), Checkout Link / Abandoned Cart / Kupon, Katalog Produk, Rotator Management, Integrasi Aplikasi.
- **Roles:** `staffAccesCode:[\`all_oms\`,\`co_oms\`]`, plus `prd_oms`, `cmp_oms`, `rtr_oms` and `anyone`. `/resource/code-roles` returns `employee_roles`. Staff management includes `OTPLoginStatus`, `unclockAccount` and `shifts` (snippet: `…Management:{OTPLoginStatus:!!p,unclockAccount:!!f,unclockAccountConfigOTP:!!d},phone:m,shifts:h})…`). `/employees/assignment` posts `{employee_id, order_id, checkout_id}`.
- **Feature flag endpoint:** `/feature-flags?keys=checkout_form_feature`, read into `featureFlagStore`.
- **RTS risk scoring:** `/indicator/rts/rate-by-phones`, `/rate-by-district` and `/rate-by-multiple-phones`.
- **QRIS** as a payment option ("Bayar menggunakan QRIS", `QrisCard`). **Passkeys** (`/auth/passkey/*`). **Linked devices** (`/linked-device`, `/remove-device`). COD Advance (`/cod-advance`, "pencairan di awal hingga maks. 50%" per the Play description). Fundings (`/fundings/*`). Insurance ("Wajib Asuransi", `is-insurance-supported`).
- **Public tracking:** `/tracking` posts `{awb}` or `{package_id}`. The response is stored as `simpleTrackingStore`, with tracks and **`driver`** fields.
- **Not found:** struk/kasir, Bluetooth/thermal printing, scale integration, label masking toggles. Only a generic `maskWithAsterisk` helper used for integration documents.

### 2.2 Lincah (Next.js app)
`https://app.lincah.id/_next/static/chunks/18322f889f2bfb3e.js` (nav) and `.../958c54300989f89b.js` (pages).

- **Menu / ACL:** the nav items carry `accesses:[...]` permission names. There are 60+ of them, including `canViewSubAccount`, `canManageWarehouse`, `canConnectWa`, `canCreateClaim`, `canMonitorChangeWeight`, `canMonitorOverSla`, `canMonitorSuspiciousUser`, `canViewWithdrawalReview`, `canViewMemberWhitelabel` and `canViewMemberApikurir`. Snippet: `{title:"manageTeam",url:"/sub-account",icon:i.IconUsers,accesses:["canViewSubAccount"]}`.
- **Warehouse roles:** `warehouseUserRoles…{WAREHOUSE_ADMIN:"Admin Gudang",WAREHOUSE_MANAGER:"Manager Gudang",WAREHOUSE_STAFF:"Staff Gudang",WAREHOUSE_VIEWER:"Viewer Gudang"}`.
- **Label print formats:** `{"label-1":1,"label-2":2,"label-4":4,"label-6":6,"thermal-10x10":1,"thermal-10x15":1}` (labels per page), default `thermal-10x15`, "Suitable for thermal printing".
- **WhatsApp:** `/api/order/${id}/wa-message?type=…` opens a WhatsApp URL (click-to-chat, not automated). `/settings/whatsapp`, `/settings/whatsapp-purpose`, `whatsappNotification`.
- **Tools:** `/tools/cod-score`, `/tools/city-rts-rate`, `/tools/check-ongkir`, `/tools/my-postcode`. Monitoring: `/monitoring/shipping-change`, `/over-sla`, `/monitoring/no-update`, `/monitoring/problem`.
- **Other:** `hideSpxCodAmount`. White-label (`/whitelabel`), `apikurir`, webhooks, reconciliation, packing/inbound/wave (fulfilment), cross-border, `CB_DROPOFF_ENABLED`, QRIS top-up (`qrisAlert`).
- **Bluetooth:** only Lucide icon names (`BluetoothConnected`). **No Bluetooth printing found.**

### 2.3 Mengantar (Nuxt 2 app + embedded shipping form)
`https://app.mengantar.com/_nuxt/62129d2.js` (i18n), `.../6351a9c.js`, and `https://app.mengantar.com/shipping-parcel-form/dist/app.js`.

- **Label settings (i18n):** `standardShippingLabel:"Standard shipping label",thermalShippingLabel:"Thermal shipping label"`, "Update Shipping Label Logo", "Thermal Paper Baru", `thermalPaperLabelNewJnt`.
- **Masking:** `tooltipHideCityAndPhoneMessage:"You hide your full address and phone number."`, `hideSenderAddressInformationTitle:"Hide Shipping Address"`, "You are hiding the recipient's phone number…", plus `hideGlobalRecipientPhoneNumber`, `mask_name`, `show_receiver_address`, `showSeparatelyOptionSender`.
- **Sub-users / permissions:** `/api/user/my-sub-users`, `addUser`, `updateUserChild`. Permissions are "Default Permission / Custom Permission / CRM Permission", e.g. "Allow sub-users to manage customer data…".
- **WhatsApp:** "WhatsApp Official" vs **"WhatsApp Unofficial"**. The unofficial mode uses QR scan: "To start sending notifications to recipients automatically, you can scan the QR with your WhatsApp… This feature uses the unofficial WhatsApp API". Also `/api/integration/wa-adapter/*` (templates, daily-limit, usage) and "Receiver Monitoring".
- **Back-office surface shipped to the client:** about 1,200 `/admin/<courier>/…` route strings across J&T, JNE, SiCepat, SAP, IDexpress, JDL, Ninja, Lion, AnterAja, Paxel, Pos and SPX. They cover reconciliation, weight-change, huge-weight, cod-change, ban-phone, receiver-score, withdraw, `seller-risks`, `branch-ticket`. **[I]** This leaks their ops model: per-courier reconciliation and weight-correction queues.
- **Public tracking:** `GET {api}order/getPublic?tracking_number=&courier=` (see §3).
- **Not found:** struk/kasir or Bluetooth printing.

### 2.4 Biteship (CRA dashboard + Next.js marketing + separate tracking SPA)
`https://dashboard.biteship.com/static/js/main.c7671949.chunk.js`, `.../2.8424875e.chunk.js`, `https://track.biteship.com/static/js/main.845a720f.js`, `https://biteship.com/_next/static/chunks/1985-7b4f3328ce199bcc.js`.

- **Label settings model** (serializer `Gf`): `template, paper_size, insurance_shown, insurance_fee_shown, shipping_fee_shown, items_shown, item_description_shown, item_sku_shown, origin_phone_shown, origin_address_shown, receiver_phone_shown, receiver_address_shown, censor_receiver_name`. Endpoint `/v1/shipping_label_settings` (GET/POST), plus `/v1/shipping_label_example`. This is the most complete dropship/masking control in the set.
- **Branded tracking page:** routes `/tracker/tracking-page` and `/edit-tracking-page`, config `/v1/tracking_pages/config`, header image upload, tracking banners. Env shows `TRACKING_PAGE_URL: https://track.biteship.com` and `RETURN_PAGE_URL: https://return.biteship.com`.
- **WhatsApp notification:** `/tracker/whatsapp/notification` and `/v1/whatsapp/status`. The marketing site has a public form, `/v1/public/tools/tracking_notifications`.
- **QRIS:** `/v1/keys/{id}/qris_payment` and `/v1/orders/{id}/qris_payment`.
- **Roles:** `/v1/user_access_management/{roles,invite,invitation_list,organizations,reinvite}`.
- **Other:** custom couriers and custom rates (`/custom-couriers/...`), fulfilment WMS, returns page, Shopify/Woo/Jubelio/Desty/Forstok, COD disbursement net-off, fraud reports (`/v1/sonar/shipment_claim_fraudulence_reports`), subscriptions and add-ons.
- **Security note [O]:** a variable *named* `REACT_APP_SHOPIFY_SECRET_KEY` with a value appears in the public dashboard vendor chunk. The value is not reproduced. **[I]** Most likely a Shopify app secret mis-scoped to the client. This is a vendor problem, outside our scope.

### 2.5 bosAgen (Vue 2 web app, `https://app.bosagen.com/`)
I fetched 150 chunks (capped). `https://app.bosagen.com/js/chunk-40847880.6e32a6fd.js` and `.../chunk-3b093d30.ebd3cf10.js`.

- **Bluetooth receipt printing:** this is the only aggregator web app here with real Web-Bluetooth ESC/POS support.
  - Device table: `filters:[{namePrefix:"STAR L"}]…language:"esc-pos",codepageMapping:"epson"`, `{name:"Printer001",services:["000018f0-…"]}…codepageMapping:"zjiang"`.
  - Printer profiles include `pos-5890`, `pos-8360` and `bixolon-srp350`.
  - Abstract `buildReceipt`, with a "Potong Disini" cut-line string.
  - **[I]** Thermal resi/struk printing straight from the browser to cheap 58 mm Bluetooth printers.
- **Routes:** `/order/create/single`, `/order/import`, `/order/kurir`, `/order/courier/courier_setting`, **`/kustom-kurir`**, `/order/whatsapp` (posts `{nomor}`, a WhatsApp number check), `/report/cetakresi`, `/payment/saldo/withdraw`, `/saldo/withdraw/retained`, `/payment/saldo/retained_fund`, `/shipper/affiliasi/*` (agent → shipper affiliate commission), `/shipper/membership`, `/ticket/claim/banding_claim` (claim appeal), `/dashboard/cashback`, `/users/groups`, `/users/login/whatsapp_login`, **`/backdoor/tracking`** (route name only, not visited).
- **Insurance:** `insurance_type`, `enableInsuranceChange`.
- **Public tracking:** `/publik/lacak/{code}` and `/publik/track/{code}` (see §3).
- **QRIS:** only a `qrispay` bank image (top-up channel).

### 2.6 SIMASRIM (`https://www.simasrim.com/`, `https://app.simasrim.com/login`, `https://cek.simasrim.com/`)
- **Marketing [O]:** "Sistem Kasir (EDC)", "EDC Android — Mesin kasir & tarik tunai", "Input paket, cetak resi, bayar PPOB, hingga jual tiket langsung dari mesin ini", "SQRIS Soundbox — Notifikasi suara untuk setiap pembayaran QRIS… Anti tipu-tipu struk palsu", **"Dashboard Pusat untuk mengelola banyak cabang/reseller"**, "Integrasi API & white label".
  - COD funds go to "Brankas" after Delivered and are paid out **weekly on Wednesday**.
  - "Margin admin bisa diatur sendiri" for PPOB.
  - Agent page: "Cashback Ongkir… komisi s.d 25%", no minimum deposit, no monthly fee.
  - Play description: JNE partnership, "Kepastian Pickup oleh JNE".
- **App (public login page bundle):** routes `/cetak-resi/cek-tarif`, `/cetak-resi/hitung-asuransi`, `/cetak-resi/hitung-poin` (loyalty points), `/cetak-resi/jadwal-pickup`, `/cetak-resi/tipe-barang/lion`. HTMX-based.
- **robots:** disallows `/api/`, `/EDC/`, `/b2b/api.php`. I respected it.

### 2.7 AutoKirim
`https://app.autokirim.com/` serves a server-rendered login page with only jQuery/bootstrap and no SPA bundle, so there are no routes to extract.
- **Play [O]:** "Dapat perlengkapan loket seperti banner, **timbangan, printer**, neon box… hanya dengan upgrade akun"; "BISA KIRIM PAKET MARKETPLACE… dapat komisi"; "Tarik saldo/Withdraw kapanpun".
- **Website [O]:** cashback up to 40% (hero) vs "hingga 30%" (FAQ) vs "hingga 25%" (Play). These are inconsistent claims.

### 2.8 Everpro, Komship, Fastpay, KirimAja, UKURIR, Agenpos
- **Everpro [O]** (everpro.id): "Smart Courier" recommendations, "Verifikasi WhatsApp Pelanggan… mencegah order fiktif", WhatsApp Official (blue tick) and broadcast, CRM WhatsApp, Request Pick Up & Drop Off.
  - The dashboard is behind `account.everpro.id`. The public login bundle exposes only auth/wallet/notification paths (`/api/everpro/wallet/v1/cash/detail`, `/subscription`).
  - `everpro.id/tools/cek-resi/` returned **HTTP 410** (removed).
- **Komship [O]** (komship.id): "Notifikasi Whatsapp: update pengiriman secara real-time melalui WhatsApp secara otomatis", COD fee 3% of item+ongkir, free retur, "cocok untuk dropshipper". The app is at `app.komship.id`, which did not resolve from here, so I could not analyse its bundle.
- **Fastpay [O]:**
  - Play: "cetak struk", "laporan transaksi", "data pelanggan", "EDC & EDC Saku", "Agen Multi Ekspedisi".
  - Site: "Merchant QRIS… pendaftaran tercepat", "Galeri Loket", "SBF (Sentra Bisnis Fastpay)".
  - Courier landing page: JNE, J&T Express, J&T Cargo, SiCepat, Lion Parcel and Pos; "Pasti dijemput oleh kurir ke loket anda"; "COD Tanpa Marketplace (coming soon)".
- **KirimAja [O]:** "Powered by Garuda Indonesia Group". The `/lacak-kiriman` page is a plain POST form (field `kode`, "Nomor Resi") with Firebase config. Server-rendered, so the result fields can't be seen without submitting.
- **UKURIR [O]:**
  - `/id-id/mitra` lists three models: Mitra Drop Point, Corporate/TOP + API, and Mitra Premium (White Label).
  - Drop Point benefits include "WhatsApp notification kepada pelanggan" and "Akses Dashboard UKURIR".
  - Drop Point requirements include "**Menyediakan timbangan, printer label, dan alat ukur paket**", a PC/tablet, and SKCK.
  - The home page describes a counter flow: "Barang Ditimbang & Diukur → Cetak Resi → Pembayaran tunai atau non-tunai di kasir outlet".
- **Agenpos [O]:** the Play description is one line. The developer package is `com.bedigital.fintech.dev`, which looks like a dev-suffixed id in production. `agenpos.co.id` did not resolve, so there was no web surface to analyse.

### 2.9 Feature matrix (from the evidence above)

✓ = Observed in a bundle or on the vendor's own public page. ~ = partial or indirect. – = not found in the analysed public surface, which is **not** proof of absence.

| Feature | bosAgen | SIMASRIM | KiriminAja | Lincah | Mengantar | Biteship | Komship | Everpro | AutoKirim | Fastpay | UKURIR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Struk/kasir | ~ receipt builder | ✓ EDC "mesin kasir" | – | – | – | – | – | – | – | ✓ cetak struk | ✓ (offline counter flow) |
| QRIS | ~ (top-up img) | ✓ SQRIS soundbox | ✓ pay | ✓ top-up | – | ✓ | – | – | – | ✓ merchant | – |
| Public tracking page | ✓ `/publik/lacak` | ✓ cek.simasrim | ✓ `/tracking` | ~ | ✓ getPublic | ✓ branded page | – | ✗ (410) | – | – | ✓ check-resi |
| WhatsApp notif | ~ (number check, WA login) | – | ✓ WA Follow-Up + templates | ~ click-to-chat | ✓ official + unofficial QR | ✓ | ✓ (marketing) | ✓ verify + broadcast | – | – | ✓ (mitra benefit) |
| Label masking / dropship | – | – | – | ~ hide SPX COD | ✓ hide addr/phone/name | ✓ granular toggles | ~ "dropshipper" | – | – | – | – |
| Thermal label sizes | ~ | – | – | ✓ 10×10/10×15/A-series | ✓ thermal | ✓ paper_size | – | – | – | – | – |
| Bluetooth printer | ✓ Web-Bluetooth ESC/POS | ~ EDC built-in | – | – | – | – | – | – | ~ printer kit | ~ (user complaint) | (BYO) |
| Timbangan | – | – | – | – | – | – | – | – | ✓ kit on upgrade | – | ✓ required for partner |
| Multi-cabang / staff roles | ~ users/groups | ✓ "Dashboard Pusat cabang/reseller" | ✓ staff + codes + activity + shifts | ✓ sub-account + 60 permissions + warehouse roles | ✓ sub-users + custom perms | ✓ UAM roles/invites | – | – | – | – | ✓ white-label partner |
| RTS / receiver risk score | – | – | ✓ rate-by-phones | ✓ cod-score, city-rts | ✓ receiver-score (admin) | ✓ fraud reports | – | ✓ WA verify | – | – | – |

**[I] Gap for GeraiExpress:** no single competitor combines (a) counter struk with exact quote→charge parity, (b) Bluetooth thermal printing for both resi and struk, (c) cashier/shift roles with cash reconciliation, and (d) a privacy-minimal public tracking page. bosAgen and SIMASRIM come closest on the counter side, but bosAgen has about 1k installs and SIMASRIM about 500.

---

## 3. Public tracking / cek-resi: what is exposed to anonymous visitors

Method: static reading of the vendor's own public tracking page code, to see which response fields get mapped or rendered. **I did not submit any real third-party AWB**, so the exact runtime values are not verified. Rendering claims are [O] where a template or JSX references the field, and [I] where the field is only mapped.

| Vendor / URL | Endpoint the page calls | Anti-abuse | Fields mapped / rendered for anonymous viewers |
|---|---|---|---|
| **Biteship branded tracking page**, `https://track.biteship.com/{trackingId}` | `GET https://api.biteship.com/v1/trackings/tracking_pages/{trackingId}` (no auth header in code) | Opaque tracking id (not the AWB) | **Mapped [O]:** waybill, organizationName, courier company/name/phone, **driver name, driver phone, driver plate, driver photo URL**, **origin contact name + origin address**, **destination contact name + destination address**, history (note/status/time), courier link, orderId, referenceId, status, duration, branding config. **Rendered [O]:** waybill, organizationName, status, courier, duration, history; [I] contact/address fields are mapped but I didn't confirm them in JSX. |
| **Biteship cek-resi (marketing)**, `https://biteship.com/id/cek-resi` | `GET /v1/public/trackings/{waybill}/couriers/{code}` with `Authorization: Public` + HMAC headers `x-biteship-public-request-signature/timestamp` | Signed request + timestamp | Mapped: orderId, **originName (contact_name)**, **destinationName**, **destinationAddress**, courier, waybill, status, history. Also upsells sign-up / WhatsApp tracking notifications. |
| **SIMASRIM**, `https://cek.simasrim.com/` | `POST test_resi.php {resi, recaptcha_token, ekspedisi}` | reCAPTCHA | **Rendered [O]** in a table: No. Resi, Layanan, **Kota Tujuan**, **Penerima (recipient name, full)**, Status, timeline, **"bukti" POD photo link** (`bukti.php?photo=…` from courier `photo_pod` / `delivDriver.photo` / `image_urls`). Supports multiple AWBs in parallel. |
| **bosAgen**, `https://app.bosagen.com/lacak/{code}` | `GET {api}/publik/lacak/{code}` + `/publik/track/{code}` | none visible | Mapped [O]: **sender_name, receiver_name, receiver_kecamatan, receiver_kota**, branch, history (date/time/note), status, pickup_status, order_type; also `feecod_shipper`, `ppncod_shipper` keys in the formatter ([I] may be internal only). |
| **KiriminAja**, `https://kiriminaja.com/tracking` | `POST /intl-api/tracking {order_id:[...], captcha}` | captcha (`getToken('tracking')`) | **Rendered [O]:** origin **name**, city, province; destination **name**, city, province; Kurir (service); Status; histories. No phone or address line. Multi-AWB. |
| **Mengantar**, `https://www.mengantar.com/lacak-paket/` (embeds `app.mengantar.com/shipping-parcel-form`) | `GET {api}order/getPublic?tracking_number=&courier=` | none visible | Rendered [O]: sender → receiver status stepper (labels only), estimate_delivery, history (day, time, counter_name, destination/desc, status), **proof-of-delivery screenshot modal** (`handleOpenProofModal`). The sample fixture in the bundle shows full order objects with `RECEIVER_PHONE` and `PICKUP_PIC_PHONE`. [I] The public response *may* carry more than is rendered, which needs a live check. |
| **UKURIR**, `https://ukurir.com/id-id/check-resi` | form POST to the same URL (server-rendered) | none visible | Rendered fields [O]: Nomor Resi, **Pengirim**, **Penerima**, Status Terakhir, Status Perjalanan. |
| **KirimAja**, `https://kirimaja.id/lacak-kiriman` | form POST (server-rendered) | none visible | Input only ("Nomor Resi"). Output not observable without submitting. |
| **Everpro**, `https://everpro.id/tools/cek-resi/` | n/a | n/a | **HTTP 410 Gone** [O]. |
| Komship / Lincah / AutoKirim | no public cek-resi link on their home pages (only cek-ongkir / cek-kodepos) | n/a | n/a |

**Privacy benchmark: proposed GeraiExpress public tracking defaults [I, design recommendation]**
- **Show:** AWB (partly masked when searching by phone), courier + service, status, timeline (event/time/hub city), origin **city** and destination **city/kecamatan**, ETA, and the outlet name of the GeraiExpress counter.
- **Mask:** recipient and sender names as initials (e.g. "B*** S****"). This is stricter than SIMASRIM, bosAgen, UKURIR and KiriminAja, which show full names.
- **Never show publicly:** phone numbers, street address, COD amount, item description, driver phone/plate/photo (Biteship maps all of these), and the POD photo (SIMASRIM and Mengantar link it).
- **Gate behind verification:** POD photo and full recipient name, available after entering the last 4 digits of the recipient phone or an OTP. This also addresses the COD-scam pattern seen in reviews.
- **Anti-enumeration:** captcha or signed requests (as KiriminAja and Biteship do), rate limits, and an opaque share-link id rather than the raw AWB (Biteship model).

---

## 4. Skipped / limited targets and why

| Target | Status | Reason |
|---|---|---|
| UKURIR Play app | skipped | No UKURIR app on Play; web only. Web surface analysed (§2.8, §3). |
| Biteship Play app | skipped | No merchant Android app found; web/API analysed. |
| KirimAja Play listing | limited | `com.garudaindonesia.kirimaja` returned 404 on Play (2026-11-02); no rating or reviews available. |
| Komship web app bundle | limited | `app.komship.id` did not resolve or connect; only the marketing site analysed. |
| Everpro dashboard bundle | limited | Dashboard requires login (`account.everpro.id`); only the public login bundle analysed. Public cek-resi returns 410. |
| AutoKirim app bundle | limited | Login page is server-rendered with no SPA routes; Play listing and marketing only. |
| Agenpos web | limited | `agenpos.co.id` did not resolve; Play listing only. |
| SIMASRIM reviews | n/a | Play app has 0 ratings and 0 reviews. |
| bosAgen reviews | thin | Only 12 reviews exist in total. |
| Live tracking value checks | not done (by design) | Would require querying real third-party AWBs (personal data). All tracking findings are field mappings from public code. |
| Browser automation | not used | The agent_browser daemon timed out (IPC error). Static HTTP fetch was used instead; this is equivalent for public bundles. |
| KiriminAja bundle crawl | partial | Capped at 400 of about 3,400 chunk references; core navigation and API modules were captured. bosAgen was capped at 150. |
| iOS App Store | not covered | Out of time budget. Only AutoKirim's iOS listing was seen in search: 4.8★, 50 ratings, PT Auto Serba Digital, `id6759365590`. |

## 5. Residual risks / caveats
- Review categorisation uses regex keywords on 40 reviews per app (24 for Agenpos, 12 for bosAgen). Counts are directional, not statistically robust, and some apps show inflated 5★ bursts.
- Bundle evidence shows **capability code paths**, not that a feature is enabled for every user. Some routes may be dead code, admin-only, or feature-flagged.
- Hashed chunk URLs rotate on every deploy, so snippets may not reproduce later. Local copies are kept in `lane-c-raw/bundles/`.
- Play "Updated" dates for four apps came from the English listing page because the scraper returned null for them.
- Data-safety declarations are self-reported by developers and appear inconsistent with the KYC flows users describe.
