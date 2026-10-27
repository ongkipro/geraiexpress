"use client";

import { useState } from "react";
import { estimateCommission, formatIdr } from "@/lib/marketing-data";

interface ProfitSimulatorProps {
  id: string;
}

const PACKAGE_PRESETS = [20, 40, 80, 150] as const;
const TARIFF_PRESETS = [15_000, 17_500, 25_000] as const;

export function ProfitSimulator({ id }: ProfitSimulatorProps) {
  const [packagesPerDay, setPackagesPerDay] = useState(40);
  const [avgTariffIdr, setAvgTariffIdr] = useState(17_500);

  const estimate = estimateCommission(packagesPerDay, avgTariffIdr);

  return (
    <div
      className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-5 sm:p-8"
      data-testid={`profit-simulator-${id}`}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={`${id}-packages`} className="text-base font-semibold text-foreground">
              Target kiriman per hari
            </label>
            <output
              htmlFor={`${id}-packages`}
              data-testid="sim-packages-output"
              className="whitespace-nowrap text-base font-semibold tabular-nums text-primary"
            >
              {packagesPerDay} paket / hari
            </output>
          </div>
          <input
            id={`${id}-packages`}
            type="range"
            min={10}
            max={250}
            step={5}
            value={packagesPerDay}
            onChange={(event) => setPackagesPerDay(Number(event.target.value))}
            className="mt-2 h-11 w-full cursor-pointer accent-primary"
          />
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Pilihan cepat jumlah paket harian">
            {PACKAGE_PRESETS.map((preset) => {
              const selected = packagesPerDay === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPackagesPerDay(preset)}
                  aria-pressed={selected}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm font-semibold tabular-nums transition-colors ${
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-secondary"
                  }`}
                >
                  {preset} paket
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={`${id}-tariff`} className="text-base font-semibold text-foreground">
              Rata-rata ongkir per paket
            </label>
            <output
              htmlFor={`${id}-tariff`}
              data-testid="sim-tariff-output"
              className="whitespace-nowrap text-base font-semibold tabular-nums text-primary"
            >
              {formatIdr(avgTariffIdr)}
            </output>
          </div>
          <input
            id={`${id}-tariff`}
            type="range"
            min={10_000}
            max={45_000}
            step={2_500}
            value={avgTariffIdr}
            onChange={(event) => setAvgTariffIdr(Number(event.target.value))}
            className="mt-2 h-11 w-full cursor-pointer accent-primary"
          />
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Pilihan cepat rata-rata ongkir">
            {TARIFF_PRESETS.map((preset) => {
              const selected = avgTariffIdr === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAvgTariffIdr(preset)}
                  aria-pressed={selected}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm font-semibold tabular-nums transition-colors ${
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-secondary"
                  }`}
                >
                  {formatIdr(preset)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-border bg-background px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          <strong className="font-semibold text-foreground">Tier volume bulanan:</strong>{" "}
          <span className="tabular-nums">{estimate.monthlyPackages.toLocaleString("id-ID")} paket/bulan</span> → diskon
          ongkir aktif <strong className="font-semibold text-primary">{estimate.activeTierLabel}</strong> (rentang
          komisi Mengantar 20%–25%, rata-rata {formatIdr(estimate.perPackageMinIdr)}–
          {formatIdr(estimate.perPackageMaxIdr)} per paket).
        </p>
      </div>

      <div className="mt-6 grid gap-4 border-t border-border pt-6 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="text-sm font-semibold text-muted-foreground">Estimasi komisi per hari</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground" data-testid="sim-daily">
            {formatIdr(estimate.dailyTierIdr)}
          </p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            Rentang 20%–25%: {formatIdr(estimate.dailyMinIdr)} – {formatIdr(estimate.dailyMaxIdr)}
          </p>
        </div>

        <div className="rounded-lg border-2 border-primary bg-card p-4 sm:col-span-2">
          <p className="text-sm font-semibold text-muted-foreground">
            Estimasi komisi toko Anda per bulan (tier {estimate.activeTierLabel})
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-2" aria-live="polite">
            <span className="text-3xl font-semibold tabular-nums text-foreground" data-testid="sim-monthly">
              {formatIdr(estimate.monthlyTierIdr)}
            </span>
            <span className="text-sm font-semibold text-muted-foreground">/ bulan</span>
          </p>
          <p className="mt-1 text-sm tabular-nums text-muted-foreground">
            Rentang 20%–25%: {formatIdr(estimate.monthlyMinIdr)} – {formatIdr(estimate.monthlyMaxIdr)} · Proyeksi
            setahun:{" "}
            <strong className="font-semibold text-foreground" data-testid="sim-yearly">
              {formatIdr(estimate.yearlyTierIdr)}
            </strong>
          </p>
          <p className="mt-2 text-xs font-semibold tabular-nums text-foreground" data-testid="sim-formula">
            {packagesPerDay} paket × 30 hari × {formatIdr(estimate.perPackageTierIdr)} ({estimate.activeTierLabel} dari{" "}
            {formatIdr(avgTariffIdr)})
          </p>
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        <strong className="font-semibold text-foreground">Catatan jujur:</strong> angka di atas adalah simulasi komisi
        kotor dari diskon ongkir 20%–25% (30 hari sebulan) dan belum dikurangi biaya operasional toko (kertas thermal,
        lakban, listrik). Hasil nyata mengikuti jumlah, berat, rute, dan layanan ekspedisi kiriman toko Anda.
      </p>
    </div>
  );
}
