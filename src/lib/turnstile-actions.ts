// The Turnstile `action` of each protected surface (T-016 / SEC-5). The widget sends it to Cloudflare
// and the server accepts a token only when siteverify echoes the action of the surface it is used on,
// so a token solved for one form is refused by every other. Shared by the client widget and the server.
// Cloudflare's action rules: 1-32 characters, letters, digits, underscore and hyphen only.
export const TURNSTILE_ACTIONS = {
  signin: "signin",
  demo: "demo",
  codeRequest: "code_request",
  codeVerify: "code_verify",
} as const;

export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
