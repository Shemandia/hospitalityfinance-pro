import { redirect } from "next/navigation";

export default async function TenantRootPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/t/${code}/dashboard`);
}
