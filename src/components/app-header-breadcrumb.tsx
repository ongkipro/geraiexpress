"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { crumbsFor } from "@/components/app-header-crumbs";

// UX-16 app header: where the page sits, from the pathname. The page keeps its own H1; the last crumb is
// the current page and is not a link. Between 768 and 1023 px only the current page is shown.
export function AppHeaderBreadcrumb() {
  const crumbs = crumbsFor(usePathname());
  if (!crumbs.length) return null;
  return (
    <Breadcrumb aria-label="Lokasi halaman" className="min-w-0">
      <BreadcrumbList className="flex-nowrap gap-1.5 text-[15px] sm:gap-2">
        {crumbs.map((crumb, index) =>
          index === crumbs.length - 1 ? (
            <BreadcrumbItem key={crumb.href} className="min-w-0">
              <span aria-current="page" className="truncate font-semibold text-foreground">{crumb.label}</span>
            </BreadcrumbItem>
          ) : (
            <Fragment key={crumb.href}>
              <BreadcrumbItem className="shrink-0 max-lg:hidden">
                <BreadcrumbLink asChild>
                  <Link href={crumb.href} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm px-1">{crumb.label}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="max-lg:hidden" />
            </Fragment>
          ),
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
