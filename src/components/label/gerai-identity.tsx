"use client";

import { useState } from "react";
import { geraiLogoDataUrl, type GeraiLogo } from "@/lib/gerai-logo";

// T-095 seam: pass snapshot.true_tenant_name / snapshot.gerai_logo to render the immutable identity
// on the future 10x5 slip. Never resolve a live logo here. The name remains visible even if an image
// fails during printing; alt text alone is not a reliable printed fallback.
export function GeraiIdentity({ name, logo }: { name: string; logo?: GeraiLogo | null }) {
  const src = geraiLogoDataUrl(logo);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <div data-testid="gerai-identity" className="flex min-w-0 flex-col items-end gap-[0.3mm]" data-logo-version={logo?.version}>
      {src && failedSrc !== src ? (
        // Inline, bounded raster: no optimizer, public storage URL or provider read.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`Logo ${name}`} onError={() => setFailedSrc(src)}
          ref={(image) => {
            // SSR images can fail before hydration attaches onError; reconcile that completed read.
            if (image?.complete && image.naturalWidth === 0) setFailedSrc(src);
          }}
          style={{ width: "22mm", height: "5mm", objectFit: "contain", objectPosition: "right center" }} />
      ) : null}
      <span className="line-clamp-2 max-w-[40mm] text-right text-[2.2mm] font-semibold">{name}</span>
    </div>
  );
}
