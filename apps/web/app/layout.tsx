import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "../components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "HospitalityFinance Pro",
  description: "Multi-tenant hospitality finance platform"
};

export default function RootLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
