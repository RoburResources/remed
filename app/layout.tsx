import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Robur Autonomous Worker",
  description: "Safety-first autonomous worker for Robur Resources"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
