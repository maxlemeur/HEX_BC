import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import AppProviders from "@/app/providers";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hydro Express - Gestion des commandes",
  description: "Application interne de gestion des bons de commande",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=general-sans@500,600,700&display=swap"
        />
      </head>
      <body
        className={`${geist.variable} ${geistMono.variable} antialiased`}
      >
        {process.env.NODE_ENV === "development" ? (
          <Script id="dev-safe-performance-measure" strategy="beforeInteractive">
            {`(() => {
  if (typeof window === "undefined" || !window.performance || typeof window.performance.measure !== "function") {
    return;
  }

  const performanceApi = window.performance;
  const originalMeasure = performanceApi.measure.bind(performanceApi);

  performanceApi.measure = function patchedMeasure(...args) {
    try {
      return originalMeasure(...args);
    } catch (error) {
      const message =
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof error.message === "string"
          ? error.message
          : String(error);

      if (message.toLowerCase().includes("negative time stamp")) {
        return undefined;
      }

      throw error;
    }
  };
})();`}
          </Script>
        ) : null}
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
