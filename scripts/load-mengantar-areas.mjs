#!/usr/bin/env node
// T-100, owner request 2026-11-05. No provider calls; owner-run, upsert-only reference loader.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function validateAreaRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || row.id.length !== 24 || !/^[0-9a-f]{24}$/.test(row.id)) {
    throw new Error("Invalid area id");
  }
  for (const key of ["province", "city", "district", "subdistrict"]) {
    const value = row[key];
    if (typeof value !== "string" || [...value].length < 1 || [...value].length > 160
      || value !== value.replace(/^ +| +$/g, "") || value.includes("\0")) throw new Error("Invalid area name");
  }
  if (typeof row.postal_code !== "string" || ![0, 5].includes(row.postal_code.length) || !/^(?:[0-9]{5})?$/.test(row.postal_code)) {
    throw new Error("Invalid area postal code");
  }
  return row;
}

export function validateDataset(data) {
  if (!data || typeof data.source !== "string" || !data.source.trim()
    || typeof data.harvested_at !== "string" || data.harvested_at.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(data.harvested_at)
    || !Number.isSafeInteger(data.count) || data.count < 1
    || !Array.isArray(data.areas) || data.areas.length !== data.count) throw new Error("Invalid area dataset");
  const ids = new Set();
  for (const row of data.areas) {
    validateAreaRow(row);
    if (ids.has(row.id)) throw new Error("Duplicate area id");
    ids.add(row.id);
  }
  return `mengantar-${data.harvested_at}-${data.count}`;
}

// Escape backslashes as well as quotes without depending on the target's string settings.
const literal = (value) => `E'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
export function upsertSql(rows, version) {
  return `with changed as (
    insert into public.mengantar_areas as a (id, province, city, district, subdistrict, postal_code, dataset_version)
    values ${rows.map((row) => `(${[row.id, row.province, row.city, row.district, row.subdistrict, row.postal_code, version].map(literal).join(",")})`).join(",\n")}
    on conflict (id) do update set province = excluded.province, city = excluded.city,
      district = excluded.district, subdistrict = excluded.subdistrict,
      postal_code = excluded.postal_code, dataset_version = excluded.dataset_version
    where (a.province, a.city, a.district, a.subdistrict, a.postal_code, a.dataset_version)
      is distinct from (excluded.province, excluded.city, excluded.district, excluded.subdistrict, excluded.postal_code, excluded.dataset_version)
    returning 1
  ) select count(*) from changed;`;
}

function main() {
  if (process.argv.length > 3) throw new Error("Expected at most one dataset path");
  const path = process.argv[2] ?? fileURLToPath(new URL("../data/mengantar/areas-2026-10-30.json.gz", import.meta.url));
  const data = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
  // Validate the entire input before the first write. A failed batch may be safely rerun.
  const version = validateDataset(data);
  const common = fileURLToPath(new URL("./db-common.sh", import.meta.url));
  let changed = 0;
  for (let i = 0; i < data.areas.length; i += 1000) {
    const result = spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; gx_psql -q -tA -1 -f -', "load-mengantar-areas", common], {
      input: upsertSql(data.areas.slice(i, i + 1000), version), encoding: "utf8", maxBuffer: 1024 * 1024,
    });
    if (result.error || result.status !== 0 || !/^\d+\s*$/.test(result.stdout)) {
      throw new Error(`Area load failed at batch ${Math.floor(i / 1000) + 1}; rerun after checking the database configuration`);
    }
    changed += Number(result.stdout.trim());
  }
  console.log(`validated=${data.count} changed=${changed} unchanged=${data.count - changed}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch { console.error("Area load failed; check dataset and database configuration before rerunning."); process.exitCode = 1; }
}
