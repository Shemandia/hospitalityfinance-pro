export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen overflow-hidden bg-[#f8fafc]">{children}</div>;
}
