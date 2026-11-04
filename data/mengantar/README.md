# Mengantar area catalogue — T-100

Owner request: 2026-11-05 (PR-3). This is shared provider reference data, not tenant/customer data.

`areas-2026-10-30.json.gz` is copied **unchanged** from the owner's own project,
`99ribu/data/shipping/mengantar-areas.json.gz`. SHA-256:
`f1712dc09dbe112e26197ae1d310024834e330d10ea0b95692ddc02efddd2e02`.
The JSON envelope records `source`, `harvested_at: "2026-10-30"`, `count: 79391`
and `areas`. Each of the **79,391** unique rows has the original Mengantar 24-hex
area `_id` (as `id`), province, city, district, subdistrict and five-digit postal code.
The Melawai and Sukatani/Tapos ids used by GeraiExpress fixtures are present with
identical names. No raw ~25 MB NDJSON request log is included.

## Provenance and limitations

99ribu harvested the data read-only from Mengantar `GET /address/search`, using
Kepmendagri district + city keywords. This is not a replacement Kepmendagri/postal
id namespace. Its harvest report lists approximately **435 Kepmendagri districts
without a match**, plus capped queries; completeness is not established. Names,
postal codes and provider ids may age or be removed by Mengantar. A newer 99ribu
`harvest-zip` pass is running and may replace this snapshot later after review.
No new provider harvest was performed for T-100.

## Loading and refresh

After applying migrations, run `pnpm db:areas` (or
`node scripts/load-mengantar-areas.mjs /path/to/reviewed.json.gz`). The loader uses
`scripts/db-common.sh` / `gx_psql`: the configured local gxdb container by default,
or an explicitly configured `DATABASE_URL` with `psql` on PATH. Run only as the
owner/migration role against the intended database. It validates the entire file
before writing, upserts in 1,000-row transactional batches, updates only changed
rows, never deletes, and prints counts only. Version is
`mengantar-<harvested_at>-<count>`; rerunning the same file reports `changed=0`.
A failed batch can leave earlier batches loaded; rerun the same input to finish.
Loading is deliberately separate from migrations and `db/seed.sql` / test harnesses.

**Refresh requires owner approval**, including any new Mengantar calls. Review the
new harvest metadata, gaps, duplicate ids, fixture identity and diff; commit the
new gzip and its provenance together, then explicitly load it on each intended
database. Do not prune historical ids when a refreshed harvest omits them. The
picker's local-first search falls back to the tenant's live Mengantar search only
on an empty result for connected, non-demo gerai. A picked id goes unchanged to
Mengantar at quote/order time; the provider remains authoritative.
