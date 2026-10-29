import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// T-062 / DEC-020: the app runs as a self-hosted Node.js server. `output: "standalone"` traces the files
// `next start` needs into .next/standalone (a minimal server.js plus its node_modules), which the Docker
// image copies. The tracing root is pinned to this directory so server.js sits at the top of that folder
// whatever lockfiles exist in parent directories.
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  poweredByHeader: false,
  // DEV_EXTRA_HOSTS (src/lib/hosts.ts): hosts other than loopback that may load `next dev` resources,
  // for example a Tailscale address. Empty in every deployed environment.
  allowedDevOrigins: (process.env.DEV_EXTRA_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean),
};

export default nextConfig;
