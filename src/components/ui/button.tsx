import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// UI-3 component grammar: pill primary/secondary, dark utility, pearl capsule.
// Weight 400 (no 500 default), no shadow, press scale lives in globals.css.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-normal transition-colors select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:outline-2 aria-invalid:outline-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "rounded-full bg-primary text-primary-foreground",
        outline: "rounded-full border border-primary bg-transparent text-primary",
        secondary: "rounded-md bg-secondary text-secondary-foreground ring-3 ring-divider",
        utility: "rounded-sm bg-foreground text-background",
        ghost: "rounded-sm text-foreground hover:bg-accent",
        destructive: "rounded-sm bg-destructive text-destructive-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 px-[22px] py-[11px] text-base",
        sm: "min-h-11 px-[15px] py-2 text-sm",
        lg: "min-h-12 px-7 text-base",
        icon: "size-11 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
