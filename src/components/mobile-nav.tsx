"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { WorkspaceNav } from "@/components/workspace-nav";

export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Buka menu">
          <Menu aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-[300px] flex-col gap-6 p-5">
        <SheetHeader className="p-0">
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <WorkspaceNav onNavigate={() => setOpen(false)} />
        <div className="mt-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
