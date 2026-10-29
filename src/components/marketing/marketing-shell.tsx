import { Menu, PackageCheck, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BRAND,
  MARKETING_NAV,
  signInHref,
  signUpHref,
  WHATSAPP_DISPLAY,
} from "@/lib/marketing-data";

// Public-site layout system (C10, design/DIRECTION.md): one content width, full-width sections that
// alternate white and parchment with no rule between them, and a display type scale that grows with
// the viewport through clamp() while keeping a rem term so browser zoom still scales it.
export const CONTAINER = "mx-auto w-full max-w-[70rem] px-5 sm:px-8";
export const DISPLAY_HOME =
  "text-[clamp(2.125rem,1.2rem+3.4vw,4rem)] font-semibold leading-[1.05] tracking-[-0.025em] text-balance";
export const DISPLAY_PAGE =
  "text-[clamp(2.375rem,1.6rem+3vw,3.5rem)] font-semibold leading-[1.07] tracking-[-0.025em] text-balance";
export const HEADLINE = "text-[clamp(2rem,1.4rem+2.2vw,3rem)] font-semibold leading-[1.08] tracking-[-0.02em] text-balance";
export const LEAD = "text-[19px] leading-[1.45] text-pretty text-muted-foreground sm:text-xl sm:leading-[1.42]";

interface MarketingShellProps {
  currentPath: string;
  children: ReactNode;
}

// A plain synchronous component: the call-to-action links come from environment configuration
// (APP_ORIGIN, read by signInHref/signUpHref in src/lib/marketing-data.ts) and never from the
// request, so the pages using the shell can be prerendered. APP_ORIGIN must therefore be present in
// the environment of the build that produces the public site.
export function MarketingShell({ currentPath, children }: MarketingShellProps) {
  const isCurrent = (href: string) =>
    href === "/" ? currentPath === "/" : currentPath === href || currentPath.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh bg-card text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-sm focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground"
        href="#utama"
      >
        Lompat ke konten utama
      </a>

      {/* C10.1: sticky, solid (no blur), hairline edge. The <details> menu is keyed by route so a
          client-side navigation from inside it closes it. */}
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className={cn(CONTAINER, "flex h-13 items-center justify-between gap-3")}>
          <Link
            href="/"
            aria-label={`${BRAND}, beranda`}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center gap-2.5 rounded-sm pr-2 text-foreground"
          >
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-sm bg-primary text-primary-foreground"
            >
              <PackageCheck className="size-[18px]" />
            </span>
            <span className="text-[17px] font-semibold tracking-tight">{BRAND}</span>
          </Link>

          <nav className="hidden lg:block" aria-label="Navigasi utama">
            <ul className="flex items-center gap-1">
              {MARKETING_NAV.map((item) => {
                const active = isCurrent(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex min-h-11 min-w-11 items-center rounded-sm px-3 text-sm transition-colors",
                        active ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-3">
            <Link
              href={signInHref()}
              data-cta="masuk"
              className="hidden min-h-11 min-w-11 items-center justify-center rounded-sm px-3 text-sm text-foreground transition-colors hover:text-primary sm:inline-flex"
            >
              Masuk
            </Link>
            <Button asChild size="sm" className="font-semibold">
              <Link href={signInHref()} data-cta="demo">
                Coba demo
              </Link>
            </Button>

            <details key={currentPath} className="group lg:hidden">
              <summary
                className="flex size-11 cursor-pointer list-none items-center justify-center rounded-sm text-foreground transition-colors hover:bg-accent [&::-webkit-details-marker]:hidden"
              >
                <Menu className="size-5 group-open:hidden" aria-hidden="true" />
                <X className="hidden size-5 group-open:block" aria-hidden="true" />
                <span className="sr-only">Menu</span>
              </summary>
              <nav
                className="absolute inset-x-0 top-full hidden border-b border-border bg-card group-open:block"
                aria-label="Navigasi seluler"
              >
                <ul className={cn(CONTAINER, "flex flex-col py-3")}>
                  {MARKETING_NAV.map((item) => {
                    const active = isCurrent(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-12 items-center text-xl",
                            active ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                  <li className="mt-3 flex flex-wrap gap-x-6 border-t border-border pt-3">
                    <Link
                      href={signInHref()}
                      data-cta="masuk"
                      className="inline-flex min-h-11 items-center text-base font-semibold text-foreground hover:text-primary"
                    >
                      Masuk
                    </Link>
                    <Link
                      href={signUpHref()}
                      data-cta="daftar"
                      className="inline-flex min-h-11 items-center text-base font-semibold text-primary"
                    >
                      Daftar
                    </Link>
                  </li>
                </ul>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="utama">{children}</main>

      <footer className="bg-background pb-10 pt-14 text-sm text-muted-foreground sm:pt-16">
        <div className={cn(CONTAINER, "grid gap-10 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]")}>
          <div className="max-w-md space-y-3">
            <p className="text-base font-semibold text-foreground">{BRAND}</p>
            <p>Aplikasi kasir loket pengiriman multi-kurir untuk toko, konter, dan agen ritel di Indonesia.</p>
            <p>
              WhatsApp onboarding: <span className="tabular whitespace-nowrap">{WHATSAPP_DISPLAY}</span>
            </p>
            <p>GeraiExpress adalah layanan mandiri; nama kurir milik masing-masing pemiliknya.</p>
          </div>

          <div className="grid grid-cols-2 gap-x-6">
            <nav aria-labelledby="footer-halaman">
              <p id="footer-halaman" className="font-semibold text-foreground">
                Halaman
              </p>
              <ul className="mt-1">
                {MARKETING_NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="inline-flex min-h-11 min-w-11 items-center hover:text-primary"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-labelledby="footer-akun">
              <p id="footer-akun" className="font-semibold text-foreground">
                Akun gerai
              </p>
              <ul className="mt-1">
                <li>
                  <Link
                    href={signInHref()}
                    data-cta="demo"
                    className="inline-flex min-h-11 min-w-11 items-center hover:text-primary"
                  >
                    Coba demo
                  </Link>
                </li>
                <li>
                  <Link
                    href={signInHref()}
                    data-cta="masuk"
                    className="inline-flex min-h-11 min-w-11 items-center hover:text-primary"
                  >
                    Masuk
                  </Link>
                </li>
                <li>
                  <Link
                    href={signUpHref()}
                    data-cta="daftar"
                    className="inline-flex min-h-11 min-w-11 items-center hover:text-primary"
                  >
                    Daftar
                  </Link>
                </li>
              </ul>
            </nav>
          </div>

          <p className="border-t border-border pt-6 text-sm md:col-span-2">
            © 2026 {BRAND}
          </p>
        </div>
      </footer>
    </div>
  );
}

interface MarketingSectionProps {
  tone: "white" | "parchment";
  labelledBy?: string;
  label?: string;
  id?: string;
  className?: string;
  children: ReactNode;
}

// C10.4: one full-width section per idea; sections are told apart by background, not by rules.
export function MarketingSection({ tone, labelledBy, label, id, className, children }: MarketingSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      aria-label={label}
      className={cn(tone === "white" ? "bg-card" : "bg-background", "py-20 sm:py-28 lg:py-32", className)}
    >
      <div className={CONTAINER}>{children}</div>
    </section>
  );
}

interface CtaLinksProps {
  className?: string;
  // "demo" leads with the demo, "daftar" leads with sign-up; both keep the other as the secondary action.
  lead?: "demo" | "daftar";
  onDark?: boolean;
}

export function CtaLinks({ className, lead = "demo", onDark = false }: CtaLinksProps) {
  const actions = [
    { cta: "demo", href: signInHref(), label: "Coba demo" },
    { cta: "daftar", href: signUpHref(), label: "Daftar" },
  ];
  if (lead === "daftar") actions.reverse();
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {actions.map((action, index) => (
        <Button
          key={action.cta}
          asChild
          size="lg"
          variant={index === 0 ? "default" : "outline"}
          className={cn(
            "font-semibold",
            index > 0 && (onDark ? "border-background/60 text-background hover:bg-background/10" : "hover:bg-info-soft"),
          )}
        >
          <Link href={action.href} data-cta={action.cta}>
            {action.label}
          </Link>
        </Button>
      ))}
    </div>
  );
}

interface MarketingPageHeroProps {
  title: string;
  lead: string;
  cta?: "demo" | "daftar" | "none";
  children?: ReactNode;
}

// Sub-page hero: the home page's left-aligned statement without a visual. From 1024px the title and the
// lead + actions sit side by side so the first screen uses the full width instead of a half-empty band.
export function MarketingPageHero({ title, lead, cta = "demo", children }: MarketingPageHeroProps) {
  return (
    <section className="bg-card pb-16 pt-14 sm:pb-20 sm:pt-20 lg:pb-24 lg:pt-24">
      <div className={cn(CONTAINER, "grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-16")}>
        <h1 className={cn(DISPLAY_PAGE, "max-w-[18ch]")}>{title}</h1>
        <div className="lg:pt-6">
          <p className={cn(LEAD, "max-w-[38rem]")}>{lead}</p>
          {cta !== "none" && <CtaLinks lead={cta} className="mt-8" />}
          {children}
        </div>
      </div>
    </section>
  );
}

// The same activation sequence as the sign-up steps on /hubungi-kami.
const ACTIVATION_STEPS = [
  "Daftar dan verifikasi email",
  "Ajukan profil gerai",
  "Tunggu persetujuan admin GeraiExpress",
  "Hubungkan akun Mengantar, mulai kirim",
];

interface MarketingClosingCtaProps {
  heading?: string;
  text?: string;
}

// C10.7: the one dark band of every page, so it reads as the end of the story after any section tone.
export function MarketingClosingCta({
  heading = "Coba alur kasir lewat demo",
  text = "Demo membuka gerai contoh. Harga dan resi di demo adalah simulasi dan tidak dikirim ke kurir.",
}: MarketingClosingCtaProps) {
  return (
    <section className="bg-foreground py-20 text-background sm:py-28" aria-labelledby="judul-mulai">
      <div className={CONTAINER}>
        <div className="flex flex-col items-center text-center">
          <h2 id="judul-mulai" className={cn(HEADLINE, "max-w-[20ch]")}>
            {heading}
          </h2>
          <p className="mt-5 max-w-[34rem] text-[19px] leading-[1.45] text-background/80 sm:text-xl">{text}</p>
          <CtaLinks onDark className="mt-9 justify-center" />
        </div>

        <div className="mt-16 border-t border-background/20 pt-8">
          <p className="text-sm text-background/80">Untuk gerai sungguhan, aktif dalam empat tahap:</p>
          <ol className="mt-5 grid gap-5 sm:grid-cols-2 sm:gap-8 lg:grid-cols-4">
            {ACTIVATION_STEPS.map((step, index) => (
              <li key={step} className="flex items-baseline gap-3 sm:flex-col sm:gap-2">
                <span className="tabular text-2xl font-semibold leading-none text-background/70" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="text-base font-semibold">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
