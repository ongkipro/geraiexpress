"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { WorkspaceNav, type NavItem } from "@/components/workspace-nav";

export function MobileNav({ children, items }: { children: React.ReactNode; items: NavItem[] }) {
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
        <WorkspaceNav items={items} onNavigate={() => setOpen(false)} />
        <div className="mt-auto border-t border-border pt-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
