import { redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/workspace";

export default async function Home() {
  const current = await loadWorkspace();
  const target = { ready: "/pengiriman", anonymous: "/masuk", choose: "/pilih-gerai", "no-access": "/akses" } as const;
  redirect(target[current.kind]);
}
