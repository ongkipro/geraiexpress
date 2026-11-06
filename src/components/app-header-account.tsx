"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeftRight, LogOut, RotateCcw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ICONS = { switch: ArrowLeftRight, reset: RotateCcw, "sign-out": LogOut } satisfies Record<string, LucideIcon>;

export type AccountAction = {
  label: string;
  pendingLabel: string;
  icon: keyof typeof ICONS;
  // A Server Action without arguments (switch gerai, reset demo, sign out); each redirects.
  action: () => Promise<void>;
};

// A menu item that submits its own form. Selecting it keeps the menu open (the item, and so the
// form, must stay mounted until the browser has submitted), shows the pending label, ignores repeat
// selections, and closes the menu when the action has finished without leaving the page.
function ActionItem({ item, onDone }: { item: AccountAction; onDone: () => void }) {
  const { pending } = useFormStatus();
  const seen = useRef(false);
  useEffect(() => {
    if (pending) seen.current = true;
    else if (seen.current) {
      seen.current = false;
      onDone();
    }
  }, [pending, onDone]);
  const Icon = ICONS[item.icon];
  return (
    <DropdownMenuItem
      asChild
      onSelect={(event) => event.preventDefault()}
      className="min-h-11 w-full text-base"
    >
      {/* The shared SubmitButton (synchronous click lock, aria-busy/aria-disabled, pending label); Radix merges
          the menu item's props and ref onto its <button>. Reset to the menu item's own look. */}
      <SubmitButton
        variant="ghost"
        pendingLabel={item.pendingLabel}
        className="h-auto justify-start gap-2 rounded-sm px-2 py-1.5 font-normal"
      >
        <span className="inline-flex items-center gap-2">
          <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
          {item.label}
        </span>
      </SubmitButton>
    </DropdownMenuItem>
  );
}

// UX-16 account menu on the shared DropdownMenu: Radix gives the keyboard model (Enter, Space and the
// arrow keys open it; arrows and typeahead move; Escape closes) and returns focus to the trigger.
export function AccountMenu({
  initials,
  title,
  details,
  actions,
}: {
  initials: string;
  title: string;
  // Muted lines under the title: outlet, role, email.
  details: string[];
  actions: AccountAction[];
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const last = actions.length - 1;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Menu akun" className="shrink-0 rounded-full p-0 hover:bg-accent data-[state=open]:bg-accent">
          <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-info-soft text-sm font-semibold text-primary ring-1 ring-border">
            {initials}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-72 p-1.5">
        <DropdownMenuLabel className="flex items-center gap-3 px-2.5 py-2.5 text-foreground">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-soft text-base font-semibold text-primary ring-1 ring-border">
            {initials}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-semibold">{title}</span>
            {details.map((line, index) => (
              <span key={index} className="truncate text-sm text-muted-foreground">{line}</span>
            ))}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {actions.map((item, index) => (
            <Fragment key={item.label}>
              {index === last && index > 0 ? <DropdownMenuSeparator /> : null}
              <form action={item.action}>
                <ActionItem item={item} onDone={close} />
              </form>
            </Fragment>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
