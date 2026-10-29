import { Suspense } from "react";
import { requireWorkspace } from "@/lib/workspace";
import { CreateDraftButton } from "@/modules/shipments/list-create";
import { periodHref, type PeriodDays } from "./aggregate";
import { QuickActions, SetupCallout } from "./actions-panel";
import { AttentionRegion } from "./attention";
import { requestNow } from "./load";
import { RecentRegion } from "./recent";
import { RegionSkeleton } from "./parts";
import { StatsRegion } from "./stats";
import { TrendRegion } from "./trend";

const longDate = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
const clock = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

export const DASHBOARD_TITLE = "Dashboard";

// UX-16 Dashboard, the gerai's home at "/": what needs me now, how today is going, how the last days
// went, where to start. Regions read separately and stream behind skeletons.
export async function DashboardPage({ periodDays }: { periodDays: PeriodDays }) {
  const ws = await requireWorkspace();
  const now = requestNow();
  const region = { tenantId: ws.tenant.id, sample: ws.isDemo, reloadHref: periodHref(periodDays) };

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-muted-foreground first-letter:uppercase" data-testid="dashboard-date">
            <time dateTime={now.toISOString()}>{longDate.format(now)} · {clock.format(now)} WIB</time>
          </p>
          <h1 className="text-3xl tracking-tight">{DASHBOARD_TITLE}</h1>
          <p className="truncate text-[15px] text-muted-foreground" data-testid="dashboard-scope">
            {ws.tenant.name} · {ws.outlet.name}
          </p>
        </div>
        <CreateDraftButton className="w-full md:w-auto" />
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Suspense fallback={<RegionSkeleton title="Perlu tindakan" lines={3} />}>
          <AttentionRegion {...region} />
        </Suspense>
        <Suspense fallback={<RegionSkeleton title="Ringkasan hari ini" lines={2} className="min-h-64" />}>
          <StatsRegion tenantId={ws.tenant.id} periodDays={periodDays} sample={ws.isDemo} />
        </Suspense>
      </div>

      <Suspense fallback={<RegionSkeleton title="Tren pengiriman" lines={4} className="min-h-96" />}>
        <TrendRegion {...region} periodDays={periodDays} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="min-w-0 lg:col-span-2">
          <Suspense fallback={<RegionSkeleton title="Terbaru" lines={5} />}>
            <RecentRegion {...region} />
          </Suspense>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <QuickActions />
          {ws.role === "tenant_admin" && !ws.isDemo ? (
            <Suspense fallback={null}>
              <SetupCallout tenantId={ws.tenant.id} mengantarPickupId={ws.outlet.mengantarPickupId} />
            </Suspense>
          ) : null}
        </div>
      </div>
    </div>
  );
}
