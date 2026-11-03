# Research: Lane D — Mengantar current facts vs the GeraiExpress repository

- Scope: read-only. No repository file was edited, no Mengantar API call was made, and no credential was used. Only public pages were fetched (plain GET).
- Output location: this file is the authoritative output path for this run. The task also named `~/Documents/work/research/geraiexpress-2026-11/lane-d-mengantar-current.md`. The run instruction overrides that path, so nothing was written there. The parent can copy this file to it.
- Access date: every source was fetched in this session. The tool does not record a calendar date. The newest "updated" stamp on any fetched page is **2026-10-29** (help article 5109199), so the session ran on or after that day. Dates quoted below are the page's own `updated`/`modified` stamps, not access dates.
- Repository baseline that was read: `docs/research/geraiexpress-mengantar-public-api.md` (T-019..T-021, 2026-10-14), `…-partner-api.md` (2026-10-13), `…-operations-contract.md` (docs read 2026-10-28), `…-market-and-regulatory-research.md` §2 and §5 (2026-10-28), and `docs/spec/CONTEXT-RECORD.md` CTX-40..CTX-42.
- Labels: **Observed** = verbatim from the cited page. **Interpretation** = my reading of that text. **Inference** = my reasoning, not stated by any source. Status marks: **CONFIRMED** = matches the repo claim. **CHANGED** = differs from the repo claim. **NEW** = the repo has no claim, or recorded it as Unknown. **UNKNOWN** = still unverifiable.

## Summary

Most of the repository's Mengantar facts still hold. These are confirmed: the discount tiers, the step-up through live-chat proof, 3% COD fee plus 11% VAT, the webhook contract, the delete rules, free return fares, pickup cut-offs, the Ninja discontinuation and the Partner rate limits. Several repo "Unknown" items now have public answers:
- the volumetric formula and weight rounding;
- free insurance below Rp500k and a Rp1,000 premium above it (marketing text only; the API has no insurance field);
- a per-courier claim-deadline table and a 14-day claim SLA;
- a minimum withdrawal of Rp10,000 and OTP/KYC on withdrawal;
- refund fields on the Delete Batch response.

No partner, reseller, affiliate, referral, cashback or rebate program is published by Mengantar. The only new tier signal is an undefined "Elite Seller" label.

## CHANGED / NEW items (quick list)

| # | Item | Mark | One line |
|---|---|---|---|
| 1 | Delete Batch response | CHANGED | Now documents `unDeletedCount`, `totalCount`, `isBatchDraft`; for lion/anteraja/pos/spx also `ordersCount`, `totalBalanceRefund`, `errorMessages`. The repo recorded only `{success, deletedCount}` and called the refund Unknown |
| 2 | Volumetric / billable weight | NEW | (L×W×H)/6000; JNE /4000; IDX Kargo /4000; heavier of actual and volumetric; rounding tolerance 0.30 kg (Lion 0.31 kg); per-courier maximum weights |
| 3 | Insurance | NEW | Marketing: free under Rp500k, Rp1,000 above. No API field. A claim pays "nilai yang diasuransikan" |
| 4 | COD fee formula | NEW (confirms T-021 number) | FAQ: 3%, no minimum, plus 11% VAT on the fee. 150,000 × 3% × 1.11 = 4,995, which equals the observed `COD_FEE 4995` |
| 5 | Pickup lead time, web UI | NEW / contradiction | Web: earliest pickup is 2 hours after opening the create-order page. API: 90 minutes |
| 6 | Return address | CHANGED (refined) | Only when origin **and** destination are both on Java (JNE/SiCepat/SAP). Otherwise the pickup address is used as the return address |
| 7 | Claim SLA and deadlines | NEW | Claim takes at most 14 days; per-courier filing windows (e.g. SiCepat 14 days, J&T 30 days, lost-claim 3×24 h for iDexpress/J&T); three claim types |
| 8 | "Lost" final status (web) | NEW | Web UI adds a Lost final status (JNE, SiCepat, SAP, IDX, J&T, Ninja). The API webhook list does not name it; the list is open-ended |
| 9 | Withdrawal | NEW | Minimum Rp10,000, no fee; OTP 2FA required; bank change requires KYC (KTP + liveness + OTP via Sumsub); Terms: 1×24 working hours, up to 4×24 |
| 10 | Seller account KYC | NEW | Web dashboard may show an account-verification (KYC) banner. Partner doc: partner sellers "skip identity verification". Whether KYC is forced on partner sellers is UNKNOWN |
| 11 | Self-serve API key | NEW | Sellers generate/regenerate a Public API key themselves after email OTP. Regenerating also rotates the Webhook Secret (per API doc) |
| 12 | Discount step-up wording | NEW / contradiction | Dashboard card shows "berapa paket lagi yang harus dikirim agar diskon bertambah" (suggests automatic). Terms popup requires live-chat proof |
| 13 | "Elite Seller" | NEW | Named seller tier in an update article; no definition or criteria published |
| 14 | Courier list hygiene | CHANGED (minor) | Courier help page lists 9 couriers without Ninja. Other help pages still mention Ninja. iDexpress Lite is inactive and hidden. SiCepat/IDX get a "full darat" (land-only) mode through the dangerous-goods checkbox |
| 15 | Privacy Policy | NEW | The `/privacy-policy/` page is a generic website-visitor template with no seller/recipient processing terms and no version. Weak basis for the Partner obligation to obtain agreement to it |
| 16 | Withdrawal days | contradiction | FAQ: Monday–Saturday incl. national holidays. "Apa Kelebihan": every day incl. Sunday. Homepage: "setiap hari, bahkan di hari libur" |

## Findings by topic

### 1. Discount tiers and step-up — CONFIRMED (plus a NEW contradiction)
1. **Claim:** tiers 20 / 22.5 / 25 / 27.5 / 30% for 0–2,500 / 2,501–5,000 / 5,001–7,500 / 7,501–10,000 / >10,000; a step above 20% requires proof of the last 30 days sent to live chat. **Sources:** [Terms page popup](https://www.mengantar.com/terms/) (`og:updated_time 2023-12-29`; popup `brxe-oodqmm`): "Jika pengirimanmu lebih dari 2.500 setiap bulannya, setelah mendaftar, kirimkan bukti jumlah transaksi 30 hari terakhirmu ke live chat … Diskon awalmu akan dinaikkan". [Help 5207011](https://help.mengantar.com/id/articles/5207011-apa-kelebihan-mengantar) (updated 2026-07-31): same steps. **Repo:** market §2.2, CTX-42. **Support:** direct. **Confidence:** high. **Mark:** CONFIRMED.
2. **Claim:** the API estimate still says "Discount calculation is based on user's shipping volume … Unlike `/allEstimatePublic` which has a fixed 20% discount". **Source:** [Public API #content-estimate](https://sandbox.mengantar.com/docs/). **Mark:** CONFIRMED.
3. **Claim:** the dashboard card "Ringkasan Status Akun" shows "diskon yang kamu dapatkan sekarang dan berapa paket lagi yang harus dikirim agar diskon bertambah". The homepage FAQ says "Diskon akan semakin besar seiring dengan jumlah transaksi". **Sources:** [Help 5111202](https://help.mengantar.com/id/articles/5111202-dashboard) (updated 2026-10-18); [homepage](https://www.mengantar.com/) (modified 2026-09-28). **Interpretation:** this suggests the step-up may be counted automatically for activity inside Mengantar, while the live-chat proof path covers volume from elsewhere. This is not stated. **Mark:** NEW (contradiction; see the Contradictions section).
4. The help page still says Mengantar works "dengan JNE dan SiCepat", although it was updated 2026-07-31. Its discount text may be stale. **Mark:** CONFIRMED stale-risk (market §2.3).

### 2. Partner / reseller / affiliate / referral / cashback program — CONFIRMED absent
- **Observed:** a text search of the current Partner doc for `cashback`, `commission`, `discount` returned no matches. A search of the Public API doc for `cashback`, `referral`, `affiliate`, `insurance` also returned no matches. Partner doc: "every order created with it is that seller's order, at that seller's rates". Web searches ("mengantar referral affiliate komisi", `site:help.mengantar.com referral OR afiliasi OR cashback`) found no Mengantar program. **Sources:** [Partner doc](https://sandbox.mengantar.com/docs/partner/), [Public doc](https://sandbox.mengantar.com/docs/). **Repo:** CTX-40. **Mark:** CONFIRMED (no program found).
- **NEW:** "Untuk **Elite Seller**, tabel custom product kini dapat tampil saat mencetak resi …" ([Help 14715376](https://help.mengantar.com/id/articles/14715376-mengantar-update-notifikasi-keamanan-akun-informasi-produk-di-label-jandt-dan-update-lainnya), updated 2026-09-02). It is a seller tier with undefined criteria and undefined commercial effect. **Confidence:** low on its meaning.

### 3. COD fee and VAT — CONFIRMED; formula NEW
- **Observed:** "Setiap pesanan COD akan dikenakan tambahan biaya fee sebesar 3% serta pajak pertambahan nilai (VAT) sebesar 11%" ([Help 5109199](https://help.mengantar.com/id/articles/5109199-hal-dasar-sebelum-membuat-pesanan), updated 2026-10-29). FAQ: "Hanya 3% dan tidak ada minimal. Misalkan nilai COD 30.000, maka fee COD-nya adalah 1.000 saja. Setelah itu ditambahkan dengan PPN COD senilai 11% dari fee COD, sehingga totalnya menjadi 1.110" ([Help 5109167](https://help.mengantar.com/id/articles/5109167-pertanyaan-yang-sering-ditanyakan), updated 2026-10-18).
- **Evidence (arithmetic):** 150,000 × 0.03 × 1.11 = 4,995, which matches T-021 `COD_FEE 4995`. The T-019 estimate value 4,994 suggests a different rounding in the estimate path (Inference). The FAQ example is internally wrong: 3% of 30,000 is 900, not 1,000.
- **Repo:** public-api note "COD fee formula: observed only for one amount". **Mark:** CONFIRMED (3% + VAT); NEW (VAT is applied to the fee, there is no minimum, and the formula matches the observation). The fee base follows the API: estimate `COD_AMOUNT` = goods + shipping.

### 4. Insurance — NEW
- **Observed (homepage popup, also on the 2023 landing page):** "Semua pengiriman di bawah 500rb akan kami asuransikan secara GRATIS. Dan jika nilai paketmu lebih dari 500rb, asuransinya cuma seharga secangkir kopi, yaitu 1rb rupiah!" ([homepage](https://www.mengantar.com/), raw HTML popup `brxe-yvaryb`).
- **Observed (claims):** a full claim pays "sebesar nominal COD atau sesuai nilai yang diasuransikan" ([Help 5596208](https://help.mengantar.com/id/articles/5596208-panduan-klaim-pengiriman-yang-terkendala), updated 2026-04-30).
- **Observed:** the Public API has no insurance parameter or response field. Searches for `insurance` and `asuransi` found nothing. Only the dangerous-goods and cargo flags exist.
- **Repo:** DEC-013 defers insurance; AGENTS says "apply COD/insurance exactly once". **Mark:** NEW. **Interpretation:** a premium cannot be quoted or applied through the API, so any GeraiExpress insurance line would be a local charge outside Mengantar. **Confidence:** medium. The marketing text may be old: its wording is identical to a 2023-10-12 landing page.

### 5. Volumetric / billable weight — NEW
- **Observed** ([Help 5387484](https://help.mengantar.com/id/articles/5387484-cara-menghitung-berat-produk-dan-selisih-ongkos-kirim), updated 2026-10-19):
  - regular service: "(P x L x T) / 6000"; "Ekspedisi JNE pembaginya 4000";
  - cargo: /6000, with "Layanan IDX kargo pembaginya 4000";
  - "yang akan dipilih kurir adalah yang terberat";
  - rounding tolerance 0.30 kg for JNE, SiCepat, SAP, ID, J&T, Anteraja, Pos and SPX ("1.30 kg … menjadi 1 kg; 1.31 kg … 2 kg"), and 0.31 kg for Lion;
  - regular-service maximum weight 50 kg (Lion 100 kg, Anteraja 30 kg);
  - a weight difference is debited from, or credited to, "saldo tersedia".
- iDexpress: a parcel under 0.5 kg pays up to half the fare ([Help 5502313](https://help.mengantar.com/id/articles/5502313-jne-sicepat-sap-idexpress-jandt-lion-parcel-anteraja-pos-ind-dan-spx)).
- Cargo minimums: JTR 10–30 kg; Gokil 10–50 kg; IDX Kargo 10–70 kg; SAP Kargo minimum 5–100 kg by region.
- The API takes only `weight` (kg). Dimensions are not an API field (Observed: no such field in Create Order).
- **Repo:** "provider billable-weight rule … not established". **Mark:** NEW. **Inference:** GeraiExpress must compute the billable weight locally before quoting. Otherwise the provider's weight correction moves money in the seller balance after the shipment.

### 6. Tracking webhook, status list, signature — CONFIRMED
- **Observed** ([Public #content-webhook](https://sandbox.mengantar.com/docs/)):
  - body is `cnote_no, order_id, courier, status_category`;
  - HMAC-SHA256 of `{x-timestamp}.{raw body}`;
  - 5-second timeout, 3 retries at about 1 s, 5 s and 15 s;
  - delivery pauses after 20 consecutive failures within 24 h, resumed with "Aktifkan kembali";
  - production webhooks are enabled per account during a staged rollout;
  - no fixed source IPs;
  - `CANCELED`/`CANCELLED`;
  - `ACTIVE/WAITING NEXT PROCESS`, `ERROR`;
  - "Treat the list as open-ended".
- **Repo:** operations contract §4–5. **Mark:** CONFIRMED (no change found).
- **NEW (web only):** "status **Lost (Paket Hilang)** sudah ditambahkan sebagai salah satu final status" for JNE, SiCepat, SAP, ID Express, J&T and Ninja ([Help 14715371](https://help.mengantar.com/id/articles/14715371-update-mengantar-web-status-lost-double-coverage-area-dan-re-delivery-lebih-rapi), updated 2026-08-02). Whether `status_category` emits a `LOST` value is **UNKNOWN**. The default branch must handle it.

### 7. Cancellation — CONFIRMED; Delete Batch CHANGED
- **Observed:** deletion is allowed only in `active`, `error`, `PENDING PICKUP`, `PICKUP FAILED` or `PICKUP_FAILED_API`; Anteraja "after 5 minutes"; other couriers are forwarded to the courier, "If the courier rejects … an error message from the courier is returned". **Mark:** CONFIRMED (operations contract §3.1).
- **CHANGED:** Delete Batch now documents these fields: "`deletedCount` … `unDeletedCount` … `totalCount` … `message`"; "A draft batch … returns … 0, plus `isBatchDraft: true`"; and "Only for "lion", "anteraja", "pos" and "spx": `ordersCount` … `totalBalanceRefund` is the balance returned, and `errorMessages` lists orders the courier refused to cancel." ([Public #content-delete-batch](https://sandbox.mengantar.com/docs/)). The repo (§3.2) recorded `{success: true, deletedCount: 1}` and refund Unknown. **Interpretation:** a balance refund on cancel is documented for those four couriers. It is still undocumented for JNE, SiCepat, SAP, iDexpress and JT.
- Web UI: "pesanan yang sudah diinput tidak dapat diedit … dapat menghapusnya dan membuat pesanan baru" (Help 5109199). **Mark:** CONFIRMED (no edit).

### 8. Return (RTS) fares — CONFIRMED
- **Observed:** the 8 couriers other than SPX charge only the discounted outbound fare; "SPX: Paket yang RTS ongkos kirim PP tidak bayar sama sekali" ([Help 5502313](https://help.mengantar.com/id/articles/5502313-jne-sicepat-sap-idexpress-jandt-lion-parcel-anteraja-pos-ind-dan-spx), updated 2026-09-24). A return without confirmation refunds both directions ("Klaim return"; automatic when no ticket is open, Help 5596208). FAQ example: fare 10,000 at 20% discount → 8,000 on return. **Repo:** market §2.2. **Mark:** CONFIRMED.
- **CHANGED (refined):** return-address routing: "alamat retur hanya dapat digunakan jika alamat asal dan alamat tujuan sama-sama berada di Pulau Jawa … sistem akan menggunakan alamat pickup sebagai pengganti alamat retur" ([Help 14715369](https://help.mengantar.com/id/articles/14715369-mengantar-update-verifikasi-akun-pengiriman-full-darat-generate-api-key-dan-update-lainnya), updated 2026-10-17). Market §3.5 said "JNE, SiCepat, SAP, Java only". The API has no return-address field (Observed: none in Create Order). **Inference:** for masked labels (DEC-017), RTS parcels return to the provider pickup address.

### 9. Pickup cut-offs and minimums — CONFIRMED; NEW web lead time
- **Observed:** cut-offs JNE 15:00, SiCepat 12:00, SAP 15:00, iDexpress 11:00, J&T 12:00, Lion 15:00, Anteraja 15:00 (pickup only), Pos 16:00, SPX 15:00. SLAs: 7 days for most; SAP "3 kali gagal pick up"; iDexpress and SPX 14 days (Help 5502313, updated 2026-09-24). "Pickup Assistance" ticket "biasanya tidak sampai 30 menit" (Help 5109199). API: hourly slots 9:00–18:00, "at least **90 minutes**". **Mark:** CONFIRMED (market §5.1, operations contract §2).
- **NEW:** web UI: "Waktu pickup paling dekat yang bisa dipilih adalah 2 jam dari waktu saat kamu membuka halaman buat pesanan" (Help 14715371). It contradicts the API's 90 minutes. Use the stricter value until Mengantar clarifies.
- Pickup minimum volume: none found in any Mengantar page. **Mark:** UNKNOWN (unchanged).
- COD maximum values per courier (Help 5502313): JNE, IDX, J&T, Lion and SPX Rp5,000,000 COD; SiCepat Rp2,500,000; SAP Rp2,000,000; Anteraja Rp3,000,000; Pos COD Rp2,000,000 / non-COD Rp5,000,000; SPX non-COD Rp10,000,000. **Mark:** NEW for the repo (only the SPX and Pos limits were recorded, in operations §8.5).

### 10. Label / receipt privacy — CONFIRMED
- **Observed:** "Nama dan nomor telepon penerima paket akan otomatis tersensor di semua ukuran label resi" ([Help 12877793](https://help.mengantar.com/id/articles/12877793-cara-mengaktifkan-fitur-jaga-privasi-pelanggan), updated 2026-04-30). The update article adds the recipient address "(kecuali informasi Kota dan Provinsi)" under a single toggle ([Help 13346863](https://help.mengantar.com/id/articles/13346863-yang-baru-di-mengantar-verifikasi-kyc-rekening-sensor-nama-and-nomor-buyer-di-label-resi-and-lainnya)). **Mark:** CONFIRMED (market §3.1). There is no API parameter for it (Observed). Products now print on J&T 10×10 and WooCommerce labels (NEW, minor).
- Provider label API: unchanged; `labelGeneration` permission; 8 Print actions per 60 s. **Mark:** CONFIRMED.

### 11. Courier list — CONFIRMED with minor changes
- **Observed:** "Ninja is discontinued — effective 1 September 2026"; with `courier=all`, "`Ninja`, `NinjaCargo` are omitted"; a direct request returns HTTP 400 `COURIER_DISABLED`; "Enforcement is still being rolled out, so a `Ninja` request may still succeed for a short period — **do not rely on it**". The courier help page lists 9 couriers (JNE, SiCepat, SAP, iDexpress, J&T, Lion, Anteraja, Pos, SPX). **Mark:** CONFIRMED.
- **CHANGED (minor):** "Layanan **IDExpress Lite** yang sedang tidak aktif tidak lagi ditampilkan" (Help 14715376). SiCepat and IDExpress offer "Pengiriman Full Jalur Darat" through the "Tandai Sebagai Barang Berbahaya" checkbox (Help 14715369). Several help pages still list Ninja, as does Komship (see Contradictions).

### 12. Withdrawal / saldo — CONFIRMED + NEW
- **Observed:** Terms D.1–D.2: "Penarikan dana diproses dalam waktu 1×24 jam hari kerja … hingga 4×24 jam hari kerja jika terjadi kendala". Saldo can be used only for "pembayaran ongkos kirim NON-COD, pembayaran biaya kembali paket, dan atau ditarik ke akun bank" (A.5/B.9). Balance can be frozen (B.10, D.3–D.4). Reconciliation at about 20:00 WIB; COD delivered before 19:45 is paid out the same day. Minimum withdrawal "10.000", no fee (FAQ). "Withdraw only diproses jika OTP valid". A bank change requires "Upload KTP … Verifikasi wajah (liveness) … OTP" via Sumsub ([Help 13922498](https://help.mengantar.com/id/articles/13922498-withdraw-sekarang-sudah-pakai-2fa-and-bisa-tambah-return-address)). Fraud: 90-day review, funds held ([Help 14715377](https://help.mengantar.com/id/articles/14715377-kenali-aktivitas-fraud-dan-penyalahgunaan-layanan-mengantar), updated 2026-09-10).
- **Repo:** partner note §9 (provider-managed verification) and market §3.3. **Mark:** CONFIRMED (terms unchanged since 2023-12-29); NEW (Rp10k minimum, OTP, Sumsub KYC).

### 13. Claims and complaints — NEW detail
- **Observed:** three claim types (return; full value of COD or insured value; other). "Proses klaim paling lama adalah 14 hari … dana akan kita kembalikan ke Saldo Tersedia" (Help 5207011). A stuck parcel's claim pays only "harga barang … (Nilai COD/NON COD - estimated fee)" (Help 5596208). Per-courier filing deadlines ([Help 8140017](https://help.mengantar.com/id/articles/8140017-ketentuan-batas-waktu-pengajuan-klaim), updated 2026-09-18):
  - JNE: 45 working days (Java, Sumatra, Bali, NTB) or 60 working days (other regions);
  - SiCepat, IDX, Anteraja, Pos: 14 days from the last status; SPX: 14 days from RTS;
  - SAP: 60 days;
  - J&T and Lion: 30 days;
  - lost-claim within 3×24 h for IDX and J&T;
  - dispute windows after Delivered of 7–15 days.
- Exclusions: damage reported more than 3 days after receipt, missing unboxing video, liquids over 100 ml, live plants (Help 6046101, updated 2026-05-13). Appeals go through Live Chat; the support window is 08:00–20:00 WIB.
- **Repo:** market S13 (exclusions only). **Mark:** CONFIRMED (exclusions); NEW (SLA and deadlines). No claims API exists (Observed).

### 14. Rate limits — CONFIRMED
- Partner: "**60 requests per minute** and **1.000 seller registrations per day** … 429 with `Retry-After`". Label: 8 Print actions per 60 s. Receiver score: a daily allowance and 429. Public API: no general limit stated. JT Premium/SiCepat batches are serialized, with 409. **Mark:** CONFIRMED; general Public API limit UNKNOWN.

### 15. Terms and Privacy — CONFIRMED / NEW
- Terms `modified 2023-12-29`, unchanged. B.5 still forbids "menjual kembali … tanpa adanya izin dari Mengantar". **Mark:** CONFIRMED.
- **NEW:** [Privacy Policy](https://www.mengantar.com/privacy-policy/) is a generic visitor/cookie template: "This Privacy Policy applies only to our online activities and is valid for visitors to our website". It has no version number and no clause on seller or recipient data. **Interpretation:** the Partner doc requires partners to get each user's "agreement to the Mengantar Terms and Conditions and Privacy Policy". That consent would point at a document that does not cover shipment personal data. This is a counsel item (market L1/L7).
- **NEW:** sellers self-generate the API key with email OTP (Help 14715369); the API doc says regenerating the key "also replaces the Webhook Secret". This affects BYOK and the partner key lifecycle (partner note §6–7: CONFIRMED, behavior unchanged).
- **NEW:** an account KYC banner ("Jika akunmu perlu melakukan verifikasi, sistem akan menampilkan banner"), while the Partner doc says "No OTP, no captcha, and no identity verification". Whether partner-registered sellers can be stopped by KYC is **UNKNOWN**.

## Aggregator value-proposition comparison (published terms only; vendor marketing, T2)

| Dimension | Mengantar | Komship (Komerce) | KiriminAja | Biteship |
|---|---|---|---|---|
| Model | Free seller platform; margin inside the tariff ("markup", API doc) | Free; "tanpa minimum pengiriman"; account deactivated after 30 days inactive | Free aggregator with member tiers | SaaS subscription: Starter Rp0 (100 shipments/month), Grow Rp149,000 (2,000/month), Scale, Plus (custom) |
| Shipping discount | 20% from the start, up to 30% with proof of >2,500/month | Per courier "hingga" 25% (SAPX 30%, Ninja 40%); hero "hingga 50%"; "Harga & diskon dapat berubah sewaktu-waktu" | VIP above 200 resi/month gets cashback (rate not stated; 2024 blog, market S24) | "Diskon ongkir dari kurir partner" only in Biteship Plus |
| COD fee | 3% + 11% VAT on the fee, no minimum | 3% of goods+fare (homepage FAQ) vs 2.8% (help, updated 2024-11-04) | 3% min Rp2,500 (J&T 4%) on goods + fare + insurance (updated 2025-12-29) | COD included; rate not on the pricing page |
| Insurance | Free under Rp500k, Rp1k above (marketing); no API field | Recommended from Rp300k goods value; formula per courier (Komerce API doc) | Courier premium 0.2–0.3% (JNE 0.2% + Rp5,000) | `courier_insurance` API parameter; help says "umumnya 0,5%" (search snippet, not fetched) |
| Returns | Return fare free; SPX RTS fully free; unconfirmed return refunded both ways | "Biaya retur … gratis se-Indonesia (khusus metode COD)" | Not checked | Return pages by tier |
| Payout | Daily at 20:00 WIB; minimum Rp10k; OTP | "Dana COD dapat langsung dicairkan setelah pesanan selesai" | Not checked | n/a |
| Referral/affiliate | **None found** | Not found (testimonials say "cashback 25%", which is the discount) | "Ajak Kirim": up to 10% acquisition and up to 2% long-term commission at Mitra level (100 active members, 1,000 shipments) | Not found |
| Pickup | Courier pickup; per-courier cut-offs | "Gratis Jemput Paket Tanpa Minimal" | Pickup and cashless drop-off | Via couriers |

Sources: [komship.id](https://komship.id/), [Komerce help](https://bantuan.komerce.id/id/article/pertanyaan-umum-11ixj6d/), [KiriminAja COD fee](https://help.kiriminaja.com/article/berapa-biaya-cod-fee-cod), [KiriminAja insurance](https://help.kiriminaja.com/article/berapa-besar-biaya-asuransi-jika-saya-ingin-menggunakan-asuransi), [KiriminAja Ajak Kirim](https://kiriminaja.com/referral), [Biteship harga](https://biteship.com/id/harga).

**Interpretation:** Mengantar competes on a lower COD fee for small parcels (no minimum, unlike KiriminAja's Rp2,500), free returns, daily payout and return-reduction tooling. On the headline discount it is below Komship's 25% start. Unlike KiriminAja, it publishes no affiliate income for an intermediary such as GeraiExpress. Biteship is a different model: paid SaaS with discounts only at enterprise level. **Inference:** the comparison supports CTX-42/CTX-43. Under published terms, a GeraiExpress gerai on Mengantar starts at a 20% spread, and the platform earns nothing from Mengantar unless a private Partner agreement says otherwise.

## Contradictions
1. Step-up mechanism: the Terms popup requires live-chat proof; the dashboard card and homepage FAQ imply automatic growth with volume. Both are Mengantar pages.
2. Pickup lead time: API 90 minutes ([Public #content-add-time](https://sandbox.mengantar.com/docs/)); web 2 hours (Help 14715371).
3. Withdrawal days: Monday–Saturday (FAQ 5109167); every day incl. Sunday (Help 5207011; homepage).
4. COD fee example: FAQ states 3% of 30,000 = 1,000 (arithmetically 900).
5. Ninja: discontinued in the API since 2026-09-01. Help pages updated 2026-08-02 and 2026-09-02 still describe Ninja features. Komship still advertises Ninja at 40%.
6. Komship COD fee: 3% (homepage) vs 2.8% (help 2024-11-04).
7. Create Order docs example: still `estimatedPrice 8000, discount 1600, estimatedSpecialPrice 5600` (unchanged from operations §8.3 F; cause still unknown).
8. "Apa Kelebihan" says the partnership is "dengan JNE dan SiCepat" while 9 couriers are live (stale page, updated 2026-07-31).

## Missing evidence
- Whether a Partner-registered seller starts above 20%, whether a partner can set it, and whether sellers are pooled for the steps (CTX-42 questions 1–4): unchanged UNKNOWN. No public source exists; a written answer from Mengantar is required.
- Meaning and criteria of "Elite Seller"; whether it affects discount.
- Whether insurance is applied automatically to API orders, how the Rp1,000 premium shows in `estimatedPrice`, and whether that marketing text is current.
- Whether webhook `status_category` emits `LOST`.
- Refund behavior on delete for JNE, SiCepat, SAP, iDexpress and JT.
- Whether account KYC can block partner-registered sellers.
- General Public API rate limit; pickup minimum volume.
- The Partner agreement text and a seller-data privacy notice. The public Privacy Policy does not cover shipment data.
- The Order Status Reference Sheet (Google Sheet) was not opened.
- `source_check` was not used. Every decision-relevant claim above was verified by fetching the original page and reading the quoted passage directly.

## Sources
- Kept: [Mengantar Public API docs](https://sandbox.mengantar.com/docs/) — canonical API contract (estimate, delete, webhook, Ninja, label).
- Kept: [Mengantar Partner API docs](https://sandbox.mengantar.com/docs/partner/) — partner scope, limits, no commission.
- Kept: [Terms](https://www.mengantar.com/terms/) (modified 2023-12-29) — discount steps, saldo and withdrawal rules.
- Kept: [Privacy Policy](https://www.mengantar.com/privacy-policy/) — shows the generic scope.
- Kept: [Homepage](https://www.mengantar.com/) (modified 2026-09-28) — insurance and discount marketing.
- Kept: Help articles 5109199, 5109167, 5502313, 5387484, 5596208, 8140017, 6046101, 5111267, 5111202, 12877793, 13346863, 13922498, 14715368, 14715369, 14715371, 14715376, 14715377, 5207011 — dated operational rules.
- Kept: Komship homepage and Komerce help; KiriminAja COD, insurance and referral pages; Biteship pricing — comparator terms.
- Deprioritized: search-snippet-only claims (Biteship 0.5% insurance; KiriminAja VIP cashback rate) — not re-read at source; landing-page copies from 2023 — stale duplicates.

## Next steps
1. Send one written question set to the Mengantar contact covering CTX-42 questions 1–4 plus: Elite Seller, the step-up mechanism, insurance on API orders, the `LOST` webhook value, delete refunds per courier, KYC on partner sellers, and a seller-data privacy notice.
2. In the sandbox, read back a Delete Batch response and a COD order at several amounts to confirm the fee rounding (4,994 vs 4,995).
3. Add a local billable-weight calculation (volumetric divisor per courier, 0.30 kg tolerance) to the quote design before any pricing claim.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Report covers all 15 requested topics with Observed URL/locator/verbatim excerpt/page date, CONFIRMED/CHANGED/NEW/UNKNOWN marks, an aggregator comparison, contradictions and residual risks; written to the authoritative output path"
    }
  ],
  "changedFiles": [
    "/home/ongki/.pi/agent/sessions/--home-ongki-Projects-geraiexpress--/subagent-artifacts/outputs/b5e97a45-e452-4b08-9de4-f29ba166b6a4/task-4.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "fetch_content / web_search on mengantar.com, help.mengantar.com, sandbox.mengantar.com/docs and /docs/partner, komship.id, kiriminaja, biteship",
      "result": "passed",
      "summary": "All primary Mengantar pages fetched and searched; quotes taken from fetched text"
    }
  ],
  "validationOutput": [
    "COD fee check: 150000 x 0.03 x 1.11 = 4995 matches T-021 COD_FEE 4995",
    "source_check not used; claims verified by direct fetch of the original pages"
  ],
  "residualRisks": [
    "Access calendar date not recorded by tools; newest page stamp is 2026-10-29",
    "Partner-seller discount, pooling, rebate and Elite Seller remain unpublished; need written Mengantar answer",
    "Insurance text is marketing copy, possibly stale (identical to a 2023 landing page); no API field",
    "Webhook LOST value, delete refunds for JNE/SiCepat/SAP/IDX/JT, KYC impact on partner sellers unverified",
    "Comparator figures are vendor marketing; Biteship insurance rate is from a search snippet only",
    "Report was not written to ~/Documents/work/research/geraiexpress-2026-11/lane-d-mengantar-current.md because the run fixed a different output path"
  ],
  "noStagedFiles": true,
  "diffSummary": "New research artifact only; no repository files edited",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "The parent should copy this file to ~/Documents/work/research/geraiexpress-2026-11/lane-d-mengantar-current.md if that location is still wanted. Highest-impact CHANGED/NEW items: Delete Batch refund fields, the volumetric/rounding rule, insurance marketing without an API field, the 2-hour web vs 90-minute API pickup lead time, Java-only return address, and the generic Privacy Policy."
}
```
