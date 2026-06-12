import type { MetadataRoute } from "next";
import { getSiteSettings } from "@/lib/site-settings";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const siteSettings = await getSiteSettings();

  return {
    name: siteSettings.siteName,
    short_name: siteSettings.siteName,
    description: "Small-team AI API gateway with quotas and admin controls",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fff8ed",
    theme_color: "#fff8ed",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png"
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
