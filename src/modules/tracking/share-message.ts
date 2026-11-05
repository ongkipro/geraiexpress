export function senderWhatsApp(phone: string | null): string | null {
  const clean = phone?.replace(/[\s().-]/g, "").replace(/^\+/, "");
  if (!clean) return null;
  const national = clean.startsWith("62") ? `0${clean.slice(2)}` : clean;
  return /^0[2-9][0-9]{7,11}$/.test(national) ? `62${national.slice(1)}` : null;
}

export function trackingMessage(gerai: string, courierService: string, awb: string, link: string): string {
  return `Halo, berikut resi pengiriman Anda dari ${gerai}.\nKurir: ${courierService}\nNomor resi: ${awb}\nLacak pengiriman: ${link}\nTerima kasih.`;
}
