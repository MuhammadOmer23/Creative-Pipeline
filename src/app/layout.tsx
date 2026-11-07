import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creative pipeline",
  description: "TriCore creative pipeline. The final outcome is the final draft.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
