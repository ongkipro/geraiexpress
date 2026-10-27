import Link from "next/link";
import type { ReactNode } from "react";
import {
  BRAND,
  MARKETING_NAV,
  MENGANTAR_URL,
  SIGN_IN_URL,
  SIGN_UP_URL,
  WHATSAPP_DISPLAY,
} from "@/lib/marketing-data";

interface MarketingShellProps {
  currentPath: string;
  children: ReactNode;
}

export function MarketingShell({ currentPath, children }: MarketingShellProps) {
  const isCurrent = (href: string) =>
    href === "/" ? currentPath === "/" : currentPath === href || currentPath.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh bg-card text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus: inline-flex focus:min-h-11 focus:items-center focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground"
        href="#utama"
      >
        Lompat ke konten utama
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            aria-label={`${BRAND}, beranda`}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center gap-2.5 rounded-md py-1 pr-2 text-foreground"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-8 items-center justify-center rounded-sm bg-primary text-sm font-semibold text-primary-foreground"
            >
              GX
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-base font-semibold tracking-tight text-foreground">{BRAND}</span>
              <span className="mt-0.5 text-xs text-muted-foreground">Loket Multi-Kurir</span>
            </span>
          </Link>

          <nav className="hidden lg:block" aria-label="Navigasi utama">
            <ul className="flex items-center gap-1 lg:gap-2">
              {MARKETING_NAV.map((item) => {
                const active = isCurrent(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`inline-flex min-h-11 min-w-11 items-center rounded-md px-3 text-sm font-semibold transition-colors ${
                        active
                          ? "bg-background text-primary underline decoration-primary decoration-2 underline-offset-8"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href={SIGN_IN_URL}
              data-cta="masuk"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Masuk
            </Link>
            <Link
              href={SIGN_UP_URL}
              data-cta="daftar"
              className="hidden min-h-11 min-w-11 items-center justify-center whitespace-nowrap rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:inline-flex"
            >
              Daftar gratis
            </Link>

            <details className="group relative lg:hidden">
              <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-md border border-border bg-secondary px-3.5 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                Menu
              </summary>
              <nav
                className="absolute right-0 mt-2 w-64 rounded-lg border border-border bg-card p-2"
                aria-label="Navigasi seluler"
              >
                <ul className="flex flex-col gap-0.5 text-sm font-semibold text-foreground">
                  {MARKETING_NAV.map((item) => {
                    const active = isCurrent(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`flex min-h-11 items-center rounded-md px-3 ${
                            active ? "bg-background font-semibold text-primary" : "hover:bg-secondary"
                          }`}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                  <li className="mt-1 border-t border-border pt-1">
                    <Link
                      href={SIGN_UP_URL}
                      data-cta="daftar"
                      className="flex min-h-11 items-center rounded-md px-3 font-semibold text-primary hover:bg-secondary"
                    >
                      Daftar gratis
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={SIGN_IN_URL}
                      data-cta="masuk"
                      className="flex min-h-11 items-center rounded-md px-3 font-semibold text-foreground hover:bg-secondary"
                    >
                      Masuk &amp; coba demo
                    </Link>
                  </li>
                </ul>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="utama">{children}</main>

      <footer className="border-t border-border bg-background py-12 text-sm text-muted-foreground">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 md:grid-cols-[1.4fr_1fr] lg:px-8">
          <div className="max-w-md space-y-3">
            <p className="text-base font-semibold text-foreground">{BRAND} · Kasir Loket Multi-Kurir</p>
            <p>
              Aplikasi kasir loket pengiriman multi-kurir untuk toko, konter, dan agen ritel di Indonesia. Gratis,
              tanpa biaya franchise.
            </p>
            <p>WhatsApp onboarding: {WHATSAPP_DISPLAY}</p>
            <div>
              <a
                href={MENGANTAR_URL}
                rel="noopener noreferrer"
                className="inline-flex min-h-11 min-w-11 items-center font-semibold text-primary underline-offset-4 hover:underline"
              >
                Terhubung dengan jaringan resmi Mengantar →
              </a>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6">
            <nav aria-labelledby="footer-halaman">
              <p id="footer-halaman" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Halaman
              </p>
              <ul className="mt-2 space-y-0.5">
                {MARKETING_NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="inline-flex min-h-11 min-w-11 items-center text-muted-foreground hover:text-primary"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-labelledby="footer-akun">
              <p id="footer-akun" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Akun gerai
              </p>
              <ul className="mt-2 space-y-0.5">
                <li>
                  <Link
                    href={SIGN_UP_URL}
                    data-cta="daftar"
                    className="inline-flex min-h-11 min-w-11 items-center text-muted-foreground hover:text-primary"
                  >
                    Daftar gratis
                  </Link>
                </li>
                <li>
                  <Link
                    href={SIGN_IN_URL}
                    data-cta="masuk"
                    className="inline-flex min-h-11 min-w-11 items-center text-muted-foreground hover:text-primary"
                  >
                    Masuk / Coba demo
                  </Link>
                </li>
              </ul>
            </nav>
          </div>

          <p className="border-t border-border pt-6 text-xs text-muted-foreground md:col-span-2">
            © 2026 {BRAND} · Bahasa Indonesia · Rupiah · WIB
          </p>
        </div>
      </footer>
    </div>
  );
}

interface MarketingPageHeroProps {
  title: string;
  lead: string;
  showSignUp?: boolean;
  children?: ReactNode;
}

export function MarketingPageHero({ title, lead, showSignUp = true, children }: MarketingPageHeroProps) {
  return (
    <section className="border-b border-border bg-background pb-10 pt-12 sm:pb-14 sm:pt-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-xl">{lead}</p>
        {showSignUp && (
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href={SIGN_UP_URL}
              data-cta="daftar"
              className="inline-flex min-h-12 min-w-11 items-center justify-center rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Daftar gratis
            </Link>
            <Link
              href={SIGN_IN_URL}
              data-cta="demo"
              className="inline-flex min-h-12 min-w-11 items-center justify-center rounded-full border border-border bg-card px-7 text-base font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Masuk / Coba demo
            </Link>
          </div>
        )}
        {children}
      </div>
    </section>
  );
}

const ACTIVATION_STEPS = [
  "Daftar dan verifikasi email",
  "Hubungkan akun Mengantar gerai",
  "Disetujui admin, mulai kirim",
];

interface MarketingClosingCtaProps {
  heading?: string;
  text?: string;
}

export function MarketingClosingCta({
  heading = "Buka loket ekspedisi di toko Anda sekarang",
  text = "Gratis, tanpa biaya franchise. Gerai aktif dalam tiga tahap:",
}: MarketingClosingCtaProps) {
  return (
    <section className="border-t border-border bg-[#1d1d1f] py-16 text-white sm:py-20" aria-labelledby="judul-mulai">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 id="judul-mulai" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {heading}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-[#cccccc]">{text}</p>
        <ol
          role="list"
          className="mx-auto mt-6 flex max-w-2xl flex-col items-center gap-x-6 gap-y-2 text-base font-semibold sm:flex-row sm:justify-center"
        >
          {ACTIVATION_STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-2">
              <span className="font-semibold text-[#cccccc]" aria-hidden="true">
                {index + 1}.
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={SIGN_UP_URL}
            data-cta="daftar"
            className="inline-flex min-h-12 w-full min-w-11 items-center justify-center rounded-full bg-primary px-9 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:w-auto"
          >
            Daftar gratis
          </Link>
          <Link
            href={SIGN_IN_URL}
            data-cta="masuk"
            className="inline-flex min-h-12 w-full min-w-11 items-center justify-center rounded-full border border-white/40 px-8 text-base font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto"
          >
            Sudah punya akun? Masuk / Coba demo
          </Link>
        </div>
      </div>
    </section>
  );
}
