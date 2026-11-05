// T-079 / UX-16: the app header breadcrumb is derived from the pathname with Bahasa labels.
import { describe, expect, it } from "vitest";
import { crumbsFor } from "../../src/components/app-header-crumbs";

describe("crumbsFor", () => {
  it("names the Dashboard at / and nothing else", () => {
    expect(crumbsFor("/")).toEqual([{ href: "/", label: "Dashboard" }]);
  });

  it("labels known gerai routes and names a record by its list", () => {
    expect(crumbsFor("/kas")).toEqual([{ href: "/kas", label: "Kas" }]);
    expect(crumbsFor("/kasus")).toEqual([{ href: "/kasus", label: "Kasus" }]);
    expect(crumbsFor("/kasus/abc").map((c) => c.label)).toEqual(["Kasus", "Detail kasus"]);
    expect(crumbsFor("/pengiriman")).toEqual([{ href: "/pengiriman", label: "Pengiriman" }]);
    expect(crumbsFor("/pengiriman/baru").map((c) => c.label)).toEqual(["Pengiriman", "Buat pengiriman"]);
    const id = "00000000-0000-4000-e000-00000000000a";
    expect(crumbsFor(`/pengiriman/${id}/label`)).toEqual([
      { href: "/pengiriman", label: "Pengiriman" },
      { href: `/pengiriman/${id}`, label: "Detail" },
      { href: `/pengiriman/${id}/label`, label: "Label" },
    ]);
    expect(crumbsFor(`/pengiriman/${id}/invoice`).at(-1)?.label).toBe("Resi + invoice");
    expect(crumbsFor(`/kontak/${id}`).map((c) => c.label)).toEqual(["Kontak", "Detail"]);
  });

  it("keeps platform sections beside the gerai directory and hangs a gerai record under it", () => {
    expect(crumbsFor("/admin")).toEqual([{ href: "/admin", label: "Gerai" }]);
    expect(crumbsFor("/admin/akses")).toEqual([{ href: "/admin/akses", label: "Akses Super Admin" }]);
    expect(crumbsFor("/admin/diskon/abc").map((c) => c.label)).toEqual(["Diskon gerai", "Atur diskon"]);
    expect(crumbsFor("/admin/tenant/abc")).toEqual([
      { href: "/admin", label: "Gerai" },
      { href: "/admin/tenant/abc", label: "Detail gerai" },
    ]);
  });

  it("falls back to the decoded segment for an unknown route", () => {
    expect(crumbsFor("/bantuan%20gerai")).toEqual([{ href: "/bantuan%20gerai", label: "bantuan gerai" }]);
  });
});
