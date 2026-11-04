// T-096: one byte/signature contract for the server upload and safe inline rendering. PostgreSQL
// enforces the same limits independently. Signature recognition is not a full image decoder: a broken
// PNG/JPEG/WebP can still fail to render and must leave the gerai name visible.
export const GERAI_LOGO_MAX_BYTES = 200 * 1024;
export type GeraiLogoMime = "image/png" | "image/jpeg" | "image/webp";
export type GeraiLogo = { version: number; mime: GeraiLogoMime; base64: string };
export type GeraiLogoState = { revision: number; logo: GeraiLogo | null };

export function geraiLogoMime(bytes: Uint8Array): GeraiLogoMime | null {
  if (bytes.length > GERAI_LOGO_MAX_BYTES) return null;
  const starts = (prefix: number[], offset = 0) => prefix.every((byte, i) => bytes[offset + i] === byte);
  if (bytes.length >= 8 && starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 3 && starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 16 && starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)
    && (starts([0x56, 0x50, 0x38, 0x20], 12) || starts([0x56, 0x50, 0x38, 0x4c], 12) || starts([0x56, 0x50, 0x38, 0x58], 12))) return "image/webp";
  return null;
}

export const LOGO_TYPE_ERROR = "Pilih gambar PNG, JPEG, atau WebP yang valid. SVG tidak diizinkan.";
export const LOGO_SIZE_ERROR = "Ukuran logo maksimal 200 KB.";
export const LOGO_READ_ERROR = "Logo tidak dapat dibaca. Nama gerai tetap ditampilkan. Coba muat ulang atau pilih gambar lain.";

export function geraiLogoError(error: { message?: string } | null): string {
  switch (error?.message) {
    case "logo_type_invalid": return LOGO_TYPE_ERROR;
    case "logo_too_large": return LOGO_SIZE_ERROR;
    case "stale_state": return "Logo sudah diubah. Muat ulang halaman sebelum menyimpan lagi.";
    case "demo_restricted": return "Logo tidak dapat diubah di mode demo.";
    case "admin_required": return "Hanya admin gerai yang dapat mengubah logo.";
    default: return "Logo belum berhasil disimpan. Muat ulang untuk memeriksa logo saat ini sebelum mencoba lagi.";
  }
}

// No remote/user-selected URLs, SVG or unbounded data can enter an <img> via this seam.
export function geraiLogoDataUrl(logo: GeraiLogo | null | undefined): string | null {
  if (!logo || !Number.isInteger(logo.version) || logo.version < 1 || typeof logo.base64 !== "string"
    || logo.base64.length > 273068 || !/^[A-Za-z0-9+/]+={0,2}$/.test(logo.base64)) return null;
  try {
    const bytes = Uint8Array.from(atob(logo.base64), (char) => char.charCodeAt(0));
    return geraiLogoMime(bytes) === logo.mime ? `data:${logo.mime};base64,${logo.base64}` : null;
  } catch {
    return null;
  }
}
