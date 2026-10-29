import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { robotsFor } from "../lib/marketing-data";

// Reading the request host makes this route dynamic: the production apex keeps the index rules and
// every other host (preview, staging, local) is disallowed entirely (SUP-15).
export default async function robots(): Promise<MetadataRoute.Robots> {
  return robotsFor((await headers()).get("host"));
}
