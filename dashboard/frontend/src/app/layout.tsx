import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Sales Dashboard",
  description: "Salesforce Sales Report Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <Navbar />
        <main style={{ width: '100%' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
