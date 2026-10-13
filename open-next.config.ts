import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// lazy: no incremental cache binding; every operator page is dynamic and private.
// Add an R2/KV cache only when a public cacheable route exists.
export default defineCloudflareConfig({});
