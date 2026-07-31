import { redirect } from "next/navigation";

export default async function GLPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/t/${code}/gl/journals`);
}
