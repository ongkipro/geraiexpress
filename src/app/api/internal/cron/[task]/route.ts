import { handleCron } from "@/lib/cron";

// T-062: POST /api/internal/cron/{dispatch|cleanup}, called by the scheduler container on the internal
// host name only. All gates (host, CRON_SECRET, bearer compare, lock, deadline) live in src/lib/cron.ts.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ task: string }> }) {
  return handleCron(request, (await params).task);
}
