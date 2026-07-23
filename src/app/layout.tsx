import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Personal CRM",
  description: "Remember the people who matter.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let users pinch-zoom; never lock scale on mobile.
  maximumScale: 5,
  // Required for env(safe-area-inset-*) to resolve to anything but 0. Safari
  // draws under the status bar whenever its chrome is hidden, so the app has
  // to pad for the Dynamic Island itself.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // No fixed height on html/body: iOS Safari ties its auto-hiding toolbar
    // to natural document scrolling, and `height: 100%` breaks it — leaving
    // the tab/search bar unreachable.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body className="flex flex-col">{children}</body>
    </html>
  );
}
