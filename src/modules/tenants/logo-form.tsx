"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/notice";
import { GERAI_LOGO_MAX_BYTES, LOGO_READ_ERROR, LOGO_SIZE_ERROR, LOGO_TYPE_ERROR, geraiLogoDataUrl, geraiLogoMime, type GeraiLogoState } from "@/lib/gerai-logo";
import { setGeraiLogoAction, type LogoActionState } from "./logo-actions";

export function GeraiLogoForm({ name, current, canEdit }: { name: string; current: GeraiLogoState | null; canEdit: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const readId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState<LogoActionState, FormData>(async (previous, form) => {
    const result = await setGeraiLogoAction(previous, form);
    if (result.ok) {
      setPreview(null);
      setLocalError(null);
      if (input.current) input.current.value = "";
    }
    return result;
  }, {});
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const src = preview ?? geraiLogoDataUrl(current?.logo);
  const failedImage = src !== null && failedSrc === src;
  const error = localError ?? state.error ?? (current === null || failedImage ? LOGO_READ_ERROR : null);
  const select = async (file: File | undefined) => {
    const id = ++readId.current;
    setPreview(null);
    setLocalError(null);
    if (!file) return;
    if (file.size > GERAI_LOGO_MAX_BYTES) { setLocalError(LOGO_SIZE_ERROR); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setLocalError(LOGO_TYPE_ERROR); return; }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (id !== readId.current) return;
      if (geraiLogoMime(bytes) !== file.type) { setLocalError(LOGO_TYPE_ERROR); return; }
      setPreview(URL.createObjectURL(file));
    } catch {
      if (id === readId.current) setLocalError(LOGO_READ_ERROR);
    } finally {
      if (id === readId.current) setReading(false);
    }
  };
  return (
    <form action={action} className="flex min-w-0 flex-col gap-4" data-testid="gerai-logo-form">
      <input type="hidden" name="revision" value={current?.revision ?? ""} />
      <div className="flex min-w-0 flex-col items-start gap-2 rounded-md bg-muted p-3" data-testid="logo-preview">
        {src && !failedImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`Logo ${name}`} className="h-16 w-40 object-contain object-left" onError={() => setFailedSrc(src)}
            ref={(image) => {
              // SSR images can fail before hydration attaches onError; reconcile that completed read.
              if (image?.complete && image.naturalWidth === 0) setFailedSrc(src);
            }} />
        ) : null}
        <p className="max-w-full break-words">{name}</p>
        <p className="text-sm text-muted-foreground">{preview ? "Pratinjau pilihan — belum disimpan." : current?.logo ? `Logo tersimpan versi ${current.logo.version}.` : "Tanpa logo — label memakai nama gerai."}</p>
      </div>
      {canEdit ? <>
        <div className="flex flex-col gap-2">
          <Label htmlFor="gerai-logo">Logo gerai</Label>
          <p id="logo-hint" className="text-sm text-muted-foreground">PNG, JPEG, atau WebP, maksimal 200 KB. SVG tidak diizinkan. Mengganti atau menghapus logo tidak mengubah label yang sudah tersimpan.</p>
          <Input ref={input} id="gerai-logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" disabled={pending || reading || current === null}
            aria-invalid={error ? true : undefined} aria-describedby={error ? "logo-hint logo-error" : "logo-hint"}
            onChange={(event) => { void select(event.target.files?.[0]); }} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="operation" value="upload" disabled={pending || reading || current === null || !preview || failedImage} aria-busy={pending}>
            {pending ? "Menyimpan…" : current?.logo ? "Ganti logo" : "Simpan logo"}
          </Button>
          {current?.logo ? <Button type="submit" name="operation" value="remove" variant="outline" disabled={pending || reading} aria-busy={pending}>Hapus logo</Button> : null}
        </div>
      </> : <p className="text-sm text-muted-foreground">Hanya admin gerai yang dapat mengubah logo.</p>}
      {error ? <Notice id="logo-error" tone="danger">{error}</Notice> : null}
      {state.ok ? <Notice tone="success">{state.ok}</Notice> : null}
    </form>
  );
}
