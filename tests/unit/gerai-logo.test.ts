import { beforeEach, describe, expect, it, vi } from "vitest";
import { GERAI_LOGO_MAX_BYTES, LOGO_READ_ERROR, LOGO_SIZE_ERROR, LOGO_TYPE_ERROR, geraiLogoDataUrl, geraiLogoMime } from "../../src/lib/gerai-logo";
import { setGeraiLogoAction } from "../../src/modules/tenants/logo-actions";

const rpc = vi.fn();
const workspace = { tenant: { id: "current-tenant" }, role: "tenant_admin", isDemo: false };
const revalidate = vi.fn();
vi.mock("@/lib/gerai-logo", () => vi.importActual("../../src/lib/gerai-logo"));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => workspace }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidate(path) }));

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpeg = Uint8Array.from([255, 216, 255]);
const webp = new TextEncoder().encode("RIFF0000WEBPVP8 ");
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
function form(bytes: Uint8Array = png, mime = "image/png", filename = "logo.png") {
  const data = new FormData();
  data.set("revision", "3"); data.set("operation", "upload");
  data.set("tenant_id", "forged-other-tenant");
  data.set("logo", new File([new Uint8Array(bytes)], filename, { type: mime }));
  return data;
}
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: {}, error: null });
  revalidate.mockClear();
  Object.assign(workspace, { role: "tenant_admin", isDemo: false });
});

describe("geraiLogoMime and bounded inline image seam", () => {
  it("recognizes PNG, JPEG and all three WebP image chunks, never SVG or a MIME label alone", () => {
    expect(geraiLogoMime(png)).toBe("image/png");
    expect(geraiLogoMime(jpeg)).toBe("image/jpeg");
    for (const chunk of ["VP8 ", "VP8L", "VP8X"]) expect(geraiLogoMime(new TextEncoder().encode(`RIFF0000WEBP${chunk}`))).toBe("image/webp");
    for (const bytes of [new Uint8Array(), png.slice(0, 7), new TextEncoder().encode("<svg onload='bad()'/>"), new TextEncoder().encode("RIFF0000WEBPXXXX")]) expect(geraiLogoMime(bytes)).toBeNull();
  });
  it("allows exactly 200 KiB but not one byte more", () => {
    const bytes = new Uint8Array(GERAI_LOGO_MAX_BYTES); bytes.set(png);
    expect(geraiLogoMime(bytes)).toBe("image/png");
    const tooBig = new Uint8Array(GERAI_LOGO_MAX_BYTES + 1); tooBig.set(png);
    expect(geraiLogoMime(tooBig)).toBeNull();
  });
  it("only renders bounded raster data, not URLs, wrong MIME, corrupt base64 or SVG", () => {
    expect(geraiLogoDataUrl({ version: 1, mime: "image/png", base64: base64(png) })).toBe(`data:image/png;base64,${base64(png)}`);
    for (const logo of [null, { version: 0, mime: "image/png" as const, base64: base64(png) },
      { version: 1, mime: "image/jpeg" as const, base64: base64(png) }, { version: 1, mime: "image/png" as const, base64: "https://attacker/logo" },
      { version: 1, mime: "image/png" as const, base64: base64(new TextEncoder().encode("<svg/>")) },
      { version: 1, mime: "image/png" as const, base64: "A".repeat(273069) }]) expect(geraiLogoDataUrl(logo)).toBeNull();
  });
});

describe("setGeraiLogoAction", () => {
  it("derives the tenant from workspace and only sends verified bytes plus the seen revision", async () => {
    expect((await setGeraiLogoAction({}, form())).ok).toContain("Logo disimpan");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_tenant_logo", { p_tenant: "current-tenant", p_mime: "image/png", p_base64: base64(png), p_expected_revision: 3 });
    expect(revalidate).toHaveBeenCalledWith("/pengaturan");
  });
  it("allows JPEG and WebP too", async () => {
    for (const [bytes, mime, name] of [[jpeg, "image/jpeg", "logo.jpg"], [webp, "image/webp", "logo.webp"]] as const) expect((await setGeraiLogoAction({}, form(bytes, mime, name))).ok).toBeTruthy();
  });
  it("refuses operators and demos before any RPC", async () => {
    workspace.role = "operator";
    expect((await setGeraiLogoAction({}, form())).error).toContain("Hanya admin gerai");
    workspace.role = "tenant_admin"; workspace.isDemo = true;
    expect((await setGeraiLogoAction({}, form())).error).toContain("demo");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses oversize, wrong MIME, signature, extension, empty and SVG uploads", async () => {
    const tooBig = new Uint8Array(GERAI_LOGO_MAX_BYTES + 1); tooBig.set(png);
    expect((await setGeraiLogoAction({}, form(tooBig))).error).toBe(LOGO_SIZE_ERROR);
    for (const data of [form(png, "image/jpeg", "logo.jpg"), form(png, "image/png", "logo.svg"), form(new Uint8Array()), form(new TextEncoder().encode("<svg/>"), "image/svg+xml", "logo.svg")]) expect((await setGeraiLogoAction({}, data)).error).toBe(LOGO_TYPE_ERROR);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports failed file reads without saving", async () => {
    const data = form();
    vi.spyOn(data.get("logo") as File, "arrayBuffer").mockRejectedValue(new Error("read failed"));
    expect((await setGeraiLogoAction({}, data)).error).toBe(LOGO_READ_ERROR);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("removes with null payload, rejects stale state and does not revalidate on failure", async () => {
    const data = form(); data.set("operation", "remove");
    rpc.mockResolvedValueOnce({ error: { message: "stale_state" } });
    expect((await setGeraiLogoAction({}, data)).error).toContain("sudah diubah");
    expect(rpc).toHaveBeenCalledWith("set_tenant_logo", { p_tenant: "current-tenant", p_mime: null, p_base64: null, p_expected_revision: 3 });
    expect(revalidate).not.toHaveBeenCalled();
    expect((await setGeraiLogoAction({}, data)).ok).toContain("Logo dihapus");
  });
});
