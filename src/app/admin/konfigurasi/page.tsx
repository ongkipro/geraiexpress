import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dbServer } from "@/lib/db/server";
import { formatWib } from "@/lib/format";
import { requirePlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { courierName } from "@/lib/format";
import { EmptyState, LoadError, PageHeader, RT, SectionHeader } from "../ui";
import { DeclarationForm, WeightRuleForm, type RulePrefill } from "./forms";

export const metadata: Metadata = { title: "Konfigurasi · Super Admin" };

type Declaration = { version: number; body: string; prohibited_categories: string[]; source_url: string; provisional: boolean; effective_at: string };
type Rule = RulePrefill & { id: string; effective_at: string; is_current: boolean; scheduled: boolean; cargo_minimum_range_grams: number[] | null };

const grams = (g: number | null) => (g === null ? "—" : `${(g / 1000).toLocaleString("id-ID")} kg`);
const day = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(iso));

// T-091 / DEC-024 (G1): platform configuration that every gerai uses. Read the current version and its
// history; append a new version (never edit). Each section follows the capability its RPC requires.
export default async function PlatformConfigurationPage() {
  const session = await requirePlatform();
  const declarations = session.capabilities.includes("tenant_governance");
  const rules = session.capabilities.includes("integration_operations");
  if (!declarations && !rules) notFound();
  const db = await dbServer();
  const [decl, rule] = await Promise.all([
    declarations ? db.from("declaration_texts").select("version, body, prohibited_categories, source_url, provisional, effective_at").order("version", { ascending: false })
      : Promise.resolve({ data: null, error: null }),
    rules ? db.rpc("platform_billable_weight_rules") : Promise.resolve({ data: null, error: null }),
  ]);
  const texts = (decl.data ?? []) as Declaration[];
  const current = texts.find((t) => Date.parse(t.effective_at) <= Date.now()) ?? null;
  const ruleRows = (rule.data ?? []) as Rule[];
  const groups = [...new Set(ruleRows.map((r) => `${r.courier}|${r.service_class}`))].map((key) => {
    const rows = ruleRows.filter((r) => `${r.courier}|${r.service_class}` === key);
    return { key, rows, current: rows.find((r) => r.is_current) ?? rows[0] };
  });

  return (
    <div className="flex max-w-[1160px] flex-col gap-10">
      <PageHeader title="Konfigurasi"
        description="Pengaturan yang dipakai semua gerai. Setiap perubahan adalah versi baru dengan alasan yang tercatat di audit; versi lama tidak pernah diubah." />

      {declarations ? (
        <section aria-labelledby="decl-heading" className="flex flex-col gap-4">
          <SectionHeader id="decl-heading" title="Teks pernyataan isi paket"
            description="Dicentang operator saat konfirmasi. Versi yang dicentang tersimpan di setiap kiriman." />
          {decl.error ? (
            <LoadError href="/admin/konfigurasi">Teks pernyataan belum bisa dimuat.</LoadError>
          ) : !current ? (
            <EmptyState icon={FileText} title="Belum ada teks pernyataan yang berlaku" description="Konfirmasi kiriman ditolak sampai ada versi yang berlaku." />
          ) : (
            <div className="flex flex-col gap-3 rounded-lg bg-card p-5 ring-1 ring-border" data-testid="declaration-current">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">Versi {current.version} berlaku</Badge>
                {current.provisional ? <Badge variant="warning">Sementara</Badge> : null}
                <span className="text-sm text-muted-foreground">sejak {formatWib(current.effective_at)}</span>
              </div>
              <p>{current.body}</p>
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {current.prohibited_categories.map((c) => <li key={c}>{c}</li>)}
              </ul>
              <a href={current.source_url} className="text-sm break-all text-primary underline" target="_blank" rel="noreferrer">Sumber</a>
            </div>
          )}
          {!decl.error ? <DeclarationForm current={current} /> : null}
          {texts.length > 1 ? (
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">Riwayat ({texts.length} versi)</summary>
              <ul className="flex flex-col gap-1 text-muted-foreground">
                {texts.map((t) => <li key={t.version}>Versi {t.version} · {formatWib(t.effective_at)}{t.provisional ? " · sementara" : ""}</li>)}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {rules ? (
        <section aria-labelledby="rules-heading" className="flex flex-col gap-4">
          <SectionHeader id="rules-heading" title="Aturan berat Mengantar"
            description="Pembagi volume, toleransi, batas minimum/maksimum per kurir dan layanan. Kargo tanpa minimum terverifikasi tidak ditawarkan." />
          {rule.error ? (
            <LoadError href="/admin/konfigurasi">Aturan berat belum bisa dimuat.</LoadError>
          ) : groups.length === 0 ? (
            <EmptyState icon={Scale} title="Belum ada aturan berat" description="Ongkir memakai berat aktual sampai aturan ditambahkan." />
          ) : (
            <div className={RT.frame}>
              <Table className={RT.table}>
                <TableHeader className={RT.head}>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Layanan</TableHead>
                    <TableHead>Rumus</TableHead>
                    <TableHead>Batas</TableHead>
                    <TableHead>Sumber</TableHead>
                    <TableHead className="text-right"><span className="sr-only">Tindakan</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className={RT.body}>
                  {groups.map(({ key, rows, current: r }) => (
                    <TableRow key={key} className={RT.row} data-testid="weight-rule">
                      <TableCell className={cn(RT.cell, "min-w-0")}>
                        <span className="block font-semibold">{courierName(r.courier)} {r.service_class === "cargo" ? "Kargo" : "Reguler"}</span>
                        <span className="block text-sm text-muted-foreground">
                          {r.is_current ? "Berlaku" : r.scheduled ? "Terjadwal" : "Riwayat"} sejak {day(r.effective_at)}
                        </span>
                        <details className="mt-1 text-sm" data-testid="weight-rule-history">
                          <summary className="min-h-11 cursor-pointer py-2 font-medium text-primary">Semua versi ({rows.length})</summary>
                          <ol className="flex flex-col gap-2">
                            {rows.map((v) => (
                              <li key={v.id} className="rounded-md bg-muted p-2" data-testid="weight-rule-version">
                                <span className="font-medium">{v.is_current ? "Berlaku" : v.scheduled ? "Terjadwal" : "Riwayat"}</span>
                                {" · mulai "}{formatWib(v.effective_at)}
                                <span className="block text-muted-foreground">
                                  {v.divisor === null ? "Rumus belum terverifikasi" : `÷${v.divisor} · toleransi ${v.tolerance_grams} g`}
                                  {" · "}Min {grams(v.min_weight_grams)} · Maks {grams(v.max_weight_grams)}
                                  {v.cargo_minimum_range_grams ? ` · rentang bukti ${grams(v.cargo_minimum_range_grams[0])}–${grams(v.cargo_minimum_range_grams[1])}` : ""}
                                </span>
                                <a href={v.source_url} className="break-all text-primary underline" target="_blank" rel="noreferrer">Sumber {day(v.source_updated_at)}</a>
                              </li>
                            ))}
                          </ol>
                        </details>
                      </TableCell>
                      <TableCell className={RT.cell}>
                        {r.divisor === null ? "Belum terverifikasi" : `÷${r.divisor} · toleransi ${r.tolerance_grams} g`}
                      </TableCell>
                      <TableCell className={RT.cell}>
                        Min {grams(r.min_weight_grams)} · Maks {grams(r.max_weight_grams)}
                      </TableCell>
                      <TableCell className={RT.cell}>
                        <a href={r.source_url} className="text-sm break-all text-primary underline" target="_blank" rel="noreferrer">{day(r.source_updated_at)}</a>
                      </TableCell>
                      <TableCell className={cn(RT.cell, "md:text-right")}>
                        <WeightRuleForm prefill={{ courier: r.courier, service_class: r.service_class, divisor: r.divisor, tolerance_grams: r.tolerance_grams,
                          max_weight_grams: r.max_weight_grams, min_weight_grams: r.min_weight_grams, source_url: r.source_url,
                          source_updated_at: String(r.source_updated_at).slice(0, 10) }} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
