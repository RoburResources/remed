import type { Metadata } from "next";
import { ConsoleClient } from "./console-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Robur Remed Console",
  description: "Secure operations console for Robur Remed"
};

export default function ConsolePage() {
  return <ConsoleClient />;
}
