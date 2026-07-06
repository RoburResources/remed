import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Robur Remed Operations",
  description: "Protected autonomous operations surface for Robur Resources"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
