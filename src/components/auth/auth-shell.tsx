import { CheckCircle2, CircleAlert, Info, PackageCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// C9 / UI-5: every sign-in and onboarding screen is one centered card on the parchment canvas,
// the GeraiExpress mark above it, and secondary links below it (never a second frame inside it).

export function AuthShell({ width = "sm", context, children }: {
  // sm: 440px for sign-in, code and status screens; lg: 640px for the gerai application.
  width?: "sm" | "lg";
  // Short scope next to the product name, e.g. "Super Admin".
  context?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col px-4 py-8 sm:px-6 sm:py-14">
      <div className={cn("mx-auto flex w-full flex-col gap-6 sm:my-auto", width === "lg" ? "max-w-[640px]" : "max-w-[440px]")}>
        <div className="flex items-center justify-center gap-2.5">
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <PackageCheck className="size-5" />
          </span>
          <p className="text-lg font-semibold tracking-tight">
            GeraiExpress{context ? <span className="font-normal text-muted-foreground"> · {context}</span> : null}
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}

export function AuthCard({ className, ...props }: React.ComponentProps<typeof Card>) {
  return <Card className={cn("gap-6 px-5 py-6 sm:px-8 sm:py-8", className)} {...props} />;
}

export function AuthHeading({ title, description, eyebrow }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      {eyebrow ? <p className="text-sm text-muted-foreground break-words">{eyebrow}</p> : null}
      <h1 className="text-[28px] leading-tight font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {description ? <p className="text-[15px] text-muted-foreground sm:text-base">{description}</p> : null}
    </header>
  );
}

// Secondary links and actions under the card: plain text on the canvas, 44px targets.
export function AuthFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-1 text-center text-[15px] text-muted-foreground">{children}</div>;
}

export const authLinkClass = "inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline";

// A field's own error: icon + text in the danger tone, announced, and referenced by the field's
// aria-describedby through `id`.
export function InlineError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <FieldError id={id} className="flex items-start gap-1.5 text-[15px] text-danger">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </FieldError>
  );
}

const ALERT_ICON = { destructive: CircleAlert, success: CheckCircle2, info: Info, warning: TriangleAlert } as const;

// A form-level message: icon + text + tone. Errors are announced as alerts, the rest as status.
export function StatusAlert({ variant, id, children }: {
  variant: keyof typeof ALERT_ICON;
  id?: string;
  children: React.ReactNode;
}) {
  const Icon = ALERT_ICON[variant];
  return (
    <Alert variant={variant} id={id} role={variant === "destructive" ? "alert" : "status"}>
      <Icon aria-hidden="true" />
      <AlertDescription className="text-[15px] text-pretty">{children}</AlertDescription>
    </Alert>
  );
}
