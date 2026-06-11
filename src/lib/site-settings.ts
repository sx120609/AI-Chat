import { cacheGetJson, cacheSetJson } from "./cache";
import { prisma } from "./prisma";

export type SiteSettings = {
  siteName: string;
  siteUrl: string;
};

export const DEFAULT_SITE_NAME = "Team AI Gateway";
export const SITE_SETTINGS_CACHE_KEY = "site-settings:v1";
const SITE_SETTINGS_CACHE_TTL_SECONDS = 60;

export function normalizeSiteName(value: string | null | undefined) {
  const name = value?.trim();

  return name || DEFAULT_SITE_NAME;
}

export function normalizeSiteUrl(value: string | null | undefined) {
  const raw = value?.trim();

  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }

    return raw.replace(/\/+$/, "");
  } catch {
    throw new Error("请输入有效的站点地址，例如 https://chat.example.com");
  }
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const cached = await cacheGetJson<SiteSettings>(SITE_SETTINGS_CACHE_KEY);

  if (cached) {
    return cached;
  }

  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" },
    select: {
      siteName: true,
      siteUrl: true
    }
  });

  if (settings) {
    const siteSettings = {
      siteName: normalizeSiteName(settings.siteName),
      siteUrl: normalizeSiteUrl(settings.siteUrl)
    };

    await cacheSetJson(SITE_SETTINGS_CACHE_KEY, siteSettings, SITE_SETTINGS_CACHE_TTL_SECONDS);

    return siteSettings;
  }

  const siteSettings = {
    siteName: normalizeSiteName(process.env.SITE_NAME),
    siteUrl: normalizeSiteUrl(process.env.SITE_URL)
  };

  await cacheSetJson(SITE_SETTINGS_CACHE_KEY, siteSettings, SITE_SETTINGS_CACHE_TTL_SECONDS);

  return siteSettings;
}
