import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// DEC-022: Coolify parses compose.coolify.yaml with Symfony YAML (no custom tags) and does not resolve `extends`,
// so the file must stay flat. Checks are textual on purpose: the repository has no direct YAML dependency.
const text = readFileSync(new URL("../../compose.coolify.yaml", import.meta.url), "utf8");

// Comments and quoted scalars blanked, so a `!`, `&`, `*` or `<<` inside them is not mistaken for YAML syntax.
// One pass, left to right: a quoted scalar is skipped as a whole, so a `#` or an apostrophe inside it cannot start a
// comment, and a comment is removed only when it starts outside quotes.
const stripComments = (line: string) =>
  line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|(\s#.*$|^#.*$)/g, (match, comment) => (comment ? "" : match));
// `code`: comments removed and quoted scalars blanked, for syntax checks (a `!`, `&`, `*` or `<<` inside a quoted value
// is data, not YAML syntax). `keys`: comments removed but quotes kept, for key checks ("ports": is still a ports key).
const keys = text.split("\n").map(stripComments).join("\n");
const code = keys.replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, '""');

const serviceNames = ["app", "scheduler", "postgrest", "proxy", "postgres"] as const;

// One service's lines: after its two-space-indented key, up to the next key at indentation 0 or 2 (comments skipped).
function serviceBlock(source: string, name: string): string {
  const lines = source.split("\n");
  const servicesAt = lines.indexOf("services:");
  const start = lines.findIndex((line, i) => servicesAt >= 0 && i > servicesAt && line === `  ${name}:`);
  expect(start, `service ${name} under services:`).toBeGreaterThan(servicesAt);
  const end = lines.findIndex((line, i) => i > start && /^ {0,2}[^\s#]/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

describe("compose.coolify.yaml stays parseable by Coolify", () => {
  it("uses no extends, YAML tags, anchors, aliases or merge keys", () => {
    expect(keys).not.toMatch(/(^|[\s{,])["']?extends["']?\s*:/m);
    // Any YAML tag: !reset, !override, !!merge, !<tag:...>, also after a flow-collection delimiter.
    expect(code).not.toMatch(/(^|[\s[{,:-])![!a-zA-Z<]/m);
    expect(code).not.toMatch(/(^|[\s[{,:-])&[A-Za-z0-9_-]+/m);
    expect(code).not.toMatch(/(^|[\s[{,:-])\*[A-Za-z0-9_-]+/m);
    expect(keys).not.toMatch(/["']?<<["']?\s*:/);
  });

  it("starts all five services without profiles and publishes no ports", () => {
    for (const name of serviceNames) {
      // Any indentation, quoted or flow-style key (`"ports": [...]`, `{ports: [...]}`).
      const block = serviceBlock(keys, name);
      expect(block, `${name} profiles`).not.toMatch(/(^|[\s{,])["']?profiles["']?\s*:/m);
      expect(block, `${name} ports`).not.toMatch(/(^|[\s{,])["']?ports["']?\s*:/m);
    }
  });

  it("exposes the proxy on 8080 with the read-only Coolify Caddyfile", () => {
    const proxy = serviceBlock(text, "proxy");
    expect(proxy).toMatch(/^ {4}expose:\n {6}- "8080"$/m);
    expect(proxy).toMatch(/^ {4}volumes:\n {6}- \.\/infra\/proxy\/Caddyfile\.coolify:\/etc\/caddy\/Caddyfile:ro$/m);
  });

  it("runs app and scheduler from the GX_IMAGE variable", () => {
    for (const name of ["app", "scheduler"]) {
      expect(serviceBlock(text, name)).toMatch(/^ {4}image: \$\{GX_IMAGE(:-[^}]*)?\}$/m);
    }
  });
});
