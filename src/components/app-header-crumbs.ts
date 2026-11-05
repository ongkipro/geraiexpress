// UX-16 app header breadcrumb: the crumbs for a pathname, with Bahasa labels for the routes that have a
// page. A path missing here falls back to its (decoded) segment.
const LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/pengiriman": "Pengiriman",
  "/pengiriman/baru": "Buat pengiriman",
  "/pengiriman/cetak": "Cetak label massal",
  "/kas": "Kas",
  "/kasus": "Kasus",
  "/kontak": "Kontak",
  "/anggota": "Anggota",
  "/pengaturan": "Pengaturan",
  "/admin": "Gerai",
  "/admin/pengajuan": "Pengajuan gerai",
  "/admin/integrasi": "Integrasi Mengantar",
  "/admin/diskon": "Diskon gerai",
  "/admin/akses": "Akses Super Admin",
  "/admin/audit": "Audit",
  "/admin/konfigurasi": "Konfigurasi",
  "/admin/pantau-pengajuan": "Pengajuan menunggu",
};
// A record segment (an id) is named by its parent list. "/admin/tenant" has no page of its own, so it
// gets no crumb and its record hangs under the "/admin" directory ("Gerai").
const RECORD: Record<string, string> = {
  "/pengiriman": "Detail",
  "/kontak": "Detail",
  "/kasus": "Detail kasus",
  "/admin/tenant": "Detail gerai",
  "/admin/diskon": "Atur diskon",
};
const CHILD: Record<string, string> = { label: "Label", invoice: "Resi + invoice" };
const NO_PAGE: Record<string, true> = { "/admin/tenant": true };

export type Crumb = { href: string; label: string };

export function crumbsFor(pathname: string): Crumb[] {
  if (pathname === "/") return [{ href: "/", label: LABELS["/"] }];
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  let path = "";
  for (const segment of segments) {
    const parent = path;
    path = `${path}/${segment}`;
    if (NO_PAGE[path]) continue;
    // The platform sections are siblings of the gerai directory at "/admin", not its children.
    if (path === "/admin" && segments.length > 1 && segments[1] !== "tenant") continue;
    const label = LABELS[path] ?? RECORD[parent] ?? CHILD[segment] ?? decodeURIComponent(segment);
    crumbs.push({ href: path, label });
  }
  return crumbs;
}
