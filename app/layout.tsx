import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
// import Script from "next/script";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0B110E" },
  ],
  colorScheme: "light dark",
};

export const metadata: Metadata = {
  title: "Morrow — Competitor Website Monitoring",
  description:
    "Monitor competitor pages, review recorded changes and source captures, and keep a reliable history with Morrow.",
  icons: {
    icon: [{ type: "image/png", url: "/logo.png" }],
    apple: [{ type: "image/png", url: "/logo.png" }],
  },
};

// Google Analytics (uncomment when ready to implement Google Ads / analytics)
// const GA_MEASUREMENT_ID = "G-BL73YGP427";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
        {/* Google Analytics tag (gtag.js) - uncomment when ready to implement:
        <Script
          strategy="afterInteractive"
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        />
        <Script
          id="google-analytics"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());

              gtag('config', '${GA_MEASUREMENT_ID}');
            `,
          }}
        />
        */}
      </body>
    </html>
  );
}
