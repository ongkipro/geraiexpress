import { SubmitButton } from "@/components/submit-button";
import { createDraftAction } from "./actions";

// C4: one entry. Posts createDraftAction directly (the action redirects to the new draft); no
// intermediate page and no GET-side write.
export function CreateDraftButton({ children = "Buat pengiriman", className }: { children?: string; className?: string }) {
  return (
    <form action={createDraftAction} className="contents">
      <SubmitButton pendingLabel="Membuat draf…" className={className}>{children}</SubmitButton>
    </form>
  );
}
