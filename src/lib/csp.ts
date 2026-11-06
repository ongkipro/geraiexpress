// SEC-6 / T-055: one enforced policy, sent on the response AND set on the render request. Next reads the
// script nonce from the request's Content-Security-Policy (next/dist/server/app-render/
// get-script-nonce-from-header.js) and, after the proxy runs, copies every proxy response header onto
// the request headers (next/dist/server/lib/router-utils/resolve-routes.js:465). Both copies are this
// same string, so the copy cannot drop the nonce. No default-src or style-src is imposed.
export function createCspNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export function buildCsp(nonce: string, development = false) {
  return {
    policy: "frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; "
      + `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${development ? " 'unsafe-eval'" : ""}; `
      + "frame-src https://challenges.cloudflare.com",
    permissions: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  };
}
