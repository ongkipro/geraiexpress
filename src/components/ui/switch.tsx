"use client"

import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

// UI v4: 48x28 track (the invisible ::after extends the hit area to 44px high). The control keeps a
// visible 3:1 boundary in both states: the unchecked track uses the input border color.
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer group/switch relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors outline-none after:absolute after:-inset-x-1 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary data-checked:bg-primary data-unchecked:border-input data-unchecked:bg-card",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-full transition-transform data-checked:translate-x-[22px] data-checked:bg-primary-foreground data-unchecked:translate-x-[2px] data-unchecked:bg-input"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
