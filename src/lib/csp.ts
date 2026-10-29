// SEC-6: enforce the low-risk document boundaries now; observe the nonce-based script policy
// before enforcing it. No default-src or style-src is imposed by this rollout.
export function createCspNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export function buildCsp(nonce: string, development = false) {
  const enforced = "frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'";
  return {
    enforced,
    reportOnly: `${enforced}; script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${development ? " 'unsafe-eval'" : ""}; frame-src https://challenges.cloudflare.com`,
    permissions: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  };
}
