import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Humana Agent Assist — prototype",
  description: "Standalone stand-in for an embedded advocate workspace.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
