import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { GlobalImageViewer } from "@/components/global-image-viewer";
import { getSiteSettings } from "@/lib/site-settings";

const appDescription = "Small-team AI API gateway with quotas and admin controls";

export async function generateMetadata(): Promise<Metadata> {
  const siteSettings = await getSiteSettings();

  return {
    title: siteSettings.siteName,
    applicationName: siteSettings.siteName,
    description: appDescription,
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: siteSettings.siteName,
      statusBarStyle: "default"
    },
    formatDetection: {
      telephone: false
    },
    other: {
      "apple-mobile-web-app-capable": "yes"
    },
    icons: {
      icon: [
        { url: "/logo.svg", type: "image/svg+xml" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
      ],
      shortcut: "/logo.svg",
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
    }
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f4f8f5",
  colorScheme: "light"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <GlobalImageViewer />
      </body>
    </html>
  );
}
