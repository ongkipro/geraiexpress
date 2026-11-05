import "server-only";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { ShareControls } from "./share-controls";
import { senderWhatsApp } from "./share-message";

export async function TrackingShareCard({ shipmentId, senderPhone }: { shipmentId: string; senderPhone: string | null }) {
  const ws = await requireWorkspace();
  const db = await dbServer();
  const { data, error } = await db.from("tracking_links").select("link_id, shared_at, revoked_at")
    .eq("tenant_id", ws.tenant.id).eq("shipment_id", shipmentId).maybeSingle();
  if (error) return <p role="alert" className="text-sm">Status tautan belum bisa dimuat. Muat ulang halaman sebelum membagikan resi.</p>;
  return <ShareControls shipmentId={shipmentId} hasPhone={!!senderWhatsApp(senderPhone)}
    linkId={data?.link_id ?? null} isAdmin={ws.role === "tenant_admin"} shared={!!data?.shared_at} revoked={!!data?.revoked_at} />;
}
