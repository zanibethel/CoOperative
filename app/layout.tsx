import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://cooperative.chat";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "CoOperative AI",
  description: "Your business. Your team. Your AI operatives.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
