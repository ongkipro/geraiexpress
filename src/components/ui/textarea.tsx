import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full resize-y rounded-sm border border-input bg-card px-3 py-2 text-base text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-2 aria-invalid:border-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
