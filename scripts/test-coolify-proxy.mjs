// Local executable proof of the Coolify -> Caddy -> app header/route boundary.
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

// node:http permits an explicit Host header; Node fetch intentionally replaces it.
const request = (url, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request(url, { method, headers, timeout: 5000 }, (res) => {
    let text = ""; res.on("data", (c) => { text += c; });
    res.on("end", () => resolve({ status: res.statusCode, json: () => JSON.parse(text) }));
  });
  req.on("error", reject); req.on("timeout", () => req.destroy(new Error("timeout"))); req.end(body);
});
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const endpoint = process.env.DOCKER_HOST ?? docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}");
if (!endpoint.startsWith("unix://")) throw new Error("Proxy tests require a local Docker socket");
const name = `gx-proxy-audit-${randomBytes(4).toString("hex")}`;
const nodeImage = readFileSync("Dockerfile", "utf8").match(/^FROM (node:[^ ]+)/m)[1];
const caddyImage = readFileSync("compose.coolify.yaml", "utf8").match(/image: (caddy:[^\s]+)/)[1];
const containers = [];
docker("network", "create", name);
try {
  docker("run", "-d", "--name", `${name}-app`, "--network", name, "--network-alias", "app", nodeImage, "node", "-e",
    `require('http').createServer(async (req,res)=>{for await(const chunk of req){} res.setHeader('content-type','application/json');res.end(JSON.stringify(req.headers));}).listen(3000,'0.0.0.0')`);
  containers.push(`${name}-app`);
  docker("run", "-d", "--name", `${name}-edge`, "--network", name, nodeImage, "node", "-e", "setInterval(()=>{},1000)");
  containers.push(`${name}-edge`);
  const peer = docker("inspect", "--format", `{{(index .NetworkSettings.Networks "${name}").IPAddress}}`, `${name}-edge`);
  docker("run", "-d", "--name", `${name}-proxy`, "--network", name, "--network-alias", "proxy",
    "--user", "65534:65534", "--read-only", "--cap-drop", "ALL", "--cap-add", "NET_BIND_SERVICE", "--security-opt", "no-new-privileges:true",
    "--tmpfs", "/tmp:uid=65534,gid=65534,mode=0700", "--tmpfs", "/data:uid=65534,gid=65534,mode=0700", "--tmpfs", "/config:uid=65534,gid=65534,mode=0700",
    "-e", `COOLIFY_PROXY_CIDR=${peer}/32`, "-p", "127.0.0.1::8080",
    "-v", `${process.cwd()}/infra/proxy/Caddyfile.coolify:/etc/caddy/Caddyfile:ro`, caddyImage);
  containers.push(`${name}-proxy`);
  const url = `http://${docker("port", `${name}-proxy`, "8080/tcp")}`;
  for (let i = 0; i < 40; i++) {
    try { if ((await request(url)).status === 404) break; } catch {}
    if (i === 39) throw new Error("Test proxy did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
  const host = { Host: "app.geraiexpress.com" };
  // An untrusted peer cannot choose its address with any header, CF-Connecting-IP included.
  const direct = await request(url, { headers: { ...host, "X-Real-IP": "203.0.113.1", "X-Forwarded-For": "203.0.113.2", "CF-Connecting-IP": "203.0.113.3" } });
  assert.equal(direct.status, 200);
  const directHeaders = await direct.json();
  for (const forged of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) assert.notEqual(directHeaders["x-real-ip"], forged);
  assert.equal(directHeaders["cf-connecting-ip"], undefined);
  const viaEdge = (headers) => JSON.parse(docker("exec", `${name}-edge`, "node", "-e", `
    require('http').get('http://proxy:8080/',{headers:${JSON.stringify({ host: "app.geraiexpress.com", ...headers })}},
      r=>{if(r.statusCode!==200)process.exit(1);r.pipe(process.stdout)}).on('error',()=>process.exit(1));
  `));
  // Live shape (2026-11-10): Traefik puts the Cloudflare edge in X-Forwarded-For; the visitor is in CF-Connecting-IP.
  const forwarded = viaEdge({ "x-real-ip": "203.0.113.1", "x-forwarded-for": "162.158.106.7", "cf-connecting-ip": "198.51.100.24", forwarded: "for=203.0.113.1" });
  assert.equal(forwarded["x-real-ip"], "198.51.100.24");
  assert.equal(forwarded["x-forwarded-proto"], "https");
  assert.equal(forwarded.forwarded, undefined);
  assert.equal(forwarded["cf-connecting-ip"], undefined);
  // From the trusted edge without CF-Connecting-IP, X-Forwarded-For is NOT a fallback: the address stays the edge's.
  const noCf = viaEdge({ "x-forwarded-for": "203.0.113.9" });
  assert.notEqual(noCf["x-real-ip"], "203.0.113.9");
  for (const path of ["/api/internal/cron/dispatch", "/API//internal/cron/dispatch", "/api%2Finternal/cron/dispatch"]) {
    assert.equal((await request(`${url}${path}`, { headers: host })).status, 404);
  }
  assert.equal((await request(url, { headers: { Host: "internal.geraiexpress.local" } })).status, 404);
  assert.equal((await request(url, { headers: { Host: "unknown.example" } })).status, 404);
  assert.equal((await request(url, { method: "POST", headers: host, body: "x".repeat(1_048_577) })).status, 413);
  console.log("Coolify proxy boundary: PASS (trusted peer + CF-Connecting-IP, forged headers, TLS scheme, internal/unknown hosts, body limit)");
} finally {
  for (const container of containers.reverse()) docker("rm", "-f", "-v", container);
  docker("network", "rm", name);
}
