import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "min-h-11 w-full min-w-0 rounded-sm border border-input bg-card px-3 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-2 aria-invalid:border-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input }
