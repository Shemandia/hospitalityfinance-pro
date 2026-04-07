"use client";

import Link from "next/link";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { useTenantHref } from "../../../hooks/use-tenant-router";

export default function DashboardNotFound() {
  const tenantHref = useTenantHref();
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          <CardTitle>Page Not Found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The page you are looking for does not exist or has been moved.
          </p>
          <Button asChild variant="outline">
            <Link href={tenantHref("/dashboard")}>Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
