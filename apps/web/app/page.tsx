import { redirect } from "next/navigation";

export default function RootPage() {
  // Without a tenant slug in the URL, redirect to platform admin.
  // In production, this could be a landing page.
  redirect("/platform/tenants");
}
