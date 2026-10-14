// DEC-009 local plumbing: the Auth container calls http://host.docker.internal:3199. This relay
// listens only on the host's docker0 address (not on public interfaces) and forwards the Send
// Email Hook path, unchanged, to the local app (next dev by default; AUTH_HOOK_TARGET to change).
import http from "node:http";
import { networkInterfaces } from "node:os";

const host = process.env.AUTH_HOOK_RELAY_HOST
  ?? networkInterfaces().docker0?.find((a) => a.family === "IPv4")?.address;
const target = new URL(process.env.AUTH_HOOK_TARGET ?? "http://127.0.0.1:3100");
if (!host) {
  console.error("auth-hook-relay: no docker0 IPv4 address; set AUTH_HOOK_RELAY_HOST");
  process.exit(1);
}

http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/api/auth/send-email") {
    res.writeHead(404).end();
    return;
  }
  const upstream = http.request({ hostname: target.hostname, port: target.port, path: req.url, method: "POST", headers: { ...req.headers, host: target.host } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  upstream.on("error", () => res.writeHead(502).end());
  req.pipe(upstream);
}).listen(3199, host, () => console.log(`auth-hook-relay: ${host}:3199 -> ${target.origin}`));
