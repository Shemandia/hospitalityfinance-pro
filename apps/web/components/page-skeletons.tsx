import { Card, CardContent, CardHeader } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

/** KPI summary cards skeleton (e.g. dashboard, AP, AR pages) */
export function KPICardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="py-4 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Table skeleton with configurable rows/columns */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Header row */}
          <div className="flex gap-4 pb-2 border-b">
            {Array.from({ length: cols }).map((_, i) => (
              <Skeleton key={i} className="h-4 flex-1" />
            ))}
          </div>
          {/* Data rows */}
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex gap-4">
              {Array.from({ length: cols }).map((_, j) => (
                <Skeleton key={j} className="h-4 flex-1" style={{ opacity: 1 - i * 0.08 }} />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Dashboard page skeleton (KPIs + charts) */
export function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-fade-in">
      {/* Controls bar */}
      <Card>
        <CardContent className="flex items-center gap-4 py-3.5 px-6">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <div className="ml-auto">
            <Skeleton className="h-8 w-52" />
          </div>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <KPICardsSkeleton count={6} />

      {/* Chart placeholders */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** List page skeleton (filter bar + table) */
export function ListPageSkeleton() {
  return (
    <div className="space-y-4">
      <KPICardsSkeleton count={4} />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <Skeleton className="h-5 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </CardHeader>
        <CardContent>
          <TableSkeleton rows={10} cols={6} />
        </CardContent>
      </Card>
    </div>
  );
}
