import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GeraiExpress", template: "%s · GeraiExpress" },
  description: "Ruang kerja gerai pengiriman multi-tenant.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f5f5f7" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
