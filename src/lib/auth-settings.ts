import { prisma } from "@/lib/prisma";

export type PublicAuthSettings = {
  registrationEnabled: boolean;
  registrationRequireEmailVerification: boolean;
};

export const DEFAULT_REGISTRATION_COST_LIMIT_CENTS = 5000;

export function normalizeRegistrationCostLimitCents(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_REGISTRATION_COST_LIMIT_CENTS;
  }

  return Math.max(1, Math.round(parsed));
}

export async function getPublicAuthSettings(): Promise<PublicAuthSettings> {
  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" },
    select: {
      registrationEnabled: true,
      registrationRequireEmailVerification: true
    }
  });

  return {
    registrationEnabled:
      settings?.registrationEnabled ?? process.env.REGISTRATION_ENABLED === "true",
    registrationRequireEmailVerification:
      settings?.registrationRequireEmailVerification ??
      process.env.REGISTRATION_REQUIRE_EMAIL_VERIFICATION === "true"
  };
}
