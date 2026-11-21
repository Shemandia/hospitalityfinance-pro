import type { ReactNode } from "react";

/**
 * Integrations layout — wraps all integrations pages.
 *
 * Adds a "best viewed on desktop" banner for viewports below 1024px (§9).
 */
export default function IntegrationLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Sub-1024px responsive message */}
      <div className="lg:hidden mx-4 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
        <p className="font-medium">Best viewed on desktop</p>
        <p className="mt-0.5 text-amber-600">
          The Integrations wizard and data tables are optimized for screens 1024px and wider.
        </p>
      </div>
      {children}
    </>
  );
}
