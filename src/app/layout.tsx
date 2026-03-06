import type { Metadata, Viewport } from "next";
import { DM_Sans, Outfit, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import AppProviders from "@/app/providers";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
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
      <body
        className={`${dmSans.variable} ${outfit.variable} ${jetbrainsMono.variable} antialiased`}
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
