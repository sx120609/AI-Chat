import { prisma } from "./prisma";

export type SiteSettings = {
  siteName: string;
  siteUrl: string;
};

export const DEFAULT_SITE_NAME = "Team AI Gateway";

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
  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" },
    select: {
      siteName: true,
      siteUrl: true
    }
  });

  if (settings) {
    return {
      siteName: normalizeSiteName(settings.siteName),
      siteUrl: normalizeSiteUrl(settings.siteUrl)
    };
  }

  return {
    siteName: normalizeSiteName(process.env.SITE_NAME),
    siteUrl: normalizeSiteUrl(process.env.SITE_URL)
  };
}
