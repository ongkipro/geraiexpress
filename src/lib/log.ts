import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// T-105 / OBS: one JSON object per stdout line, with a server-generated correlation id. A cron run or an
// interactive dispatch step runs inside `withCorrelation`, so every event it logs carries the same
// `correlationId`; the cron response returns it to the scheduler, which logs it beside the call.
// Callers pass bounded fields only: counts, flags and stable codes. Never a token, a path or URL that may
// carry one, a credential, personal data or a provider payload.
const context = new AsyncLocalStorage<string>();

export function withCorrelation<T>(fn: () => T, correlationId: string = randomUUID()): T {
  return context.run(correlationId, fn);
}

export function logEvent(event: string, fields: Record<string, unknown> = {}, sink: (line: string) => void = (line) => console.log(line)) {
  const correlationId = context.getStore();
  sink(JSON.stringify({ event, ...(correlationId ? { correlationId } : {}), ...fields }));
}
