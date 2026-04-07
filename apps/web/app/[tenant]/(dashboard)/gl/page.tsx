import { redirect } from "next/navigation";

export default async function GLPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  redirect(`/${tenant}/gl/journals`);
}
