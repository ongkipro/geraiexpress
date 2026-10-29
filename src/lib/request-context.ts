import "server-only";
import { headers } from "next/headers";
import { clientAddress } from "@/lib/client-address";

// What the auth service needs to know about the caller of a Server Action: the trusted proxy's view of the
// client address (never a submitted or X-Forwarded-For value; undefined when unknown) and the user agent,
// which the service stores only as a hash.
export async function requestContext(): Promise<{ remoteIp: string | undefined; userAgent: string | undefined }> {
  const requestHeaders = await headers();
  return {
    remoteIp: clientAddress(requestHeaders) ?? undefined,
    userAgent: requestHeaders.get("user-agent") ?? undefined,
  };
}
