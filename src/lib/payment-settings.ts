import {
  DEFAULT_EASYPAY_BALANCE_CENTS_PER_YUAN,
  normalizeEasyPayBalanceCentsPerYuan,
  parseEasyPayAmountTiers,
  parseEasyPayMethods,
  normalizeEasyPayDisplayMode,
  type EasyPayAmountTier,
  type EasyPayDisplayMode,
  type EasyPayMethod
} from "@/lib/easypay";
import { prisma } from "@/lib/prisma";
import { normalizeCodingPlanConfig, type CodingPlanConfig } from "@/lib/coding-plan";

export type PublicPaymentSettings = {
  easyPayEnabled: boolean;
  easyPayDisplayMode: EasyPayDisplayMode;
  easyPayMethods: EasyPayMethod[];
  easyPayBalanceCentsPerYuan: number;
  easyPayAmountTiers: EasyPayAmountTier[];
  codingPlan: CodingPlanConfig;
};

export async function getPublicPaymentSettings(): Promise<PublicPaymentSettings> {
  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });

  const configured = Boolean(
    settings?.easyPayEnabled &&
      settings.easyPayPid &&
      settings.easyPayKey &&
      settings.easyPayApiBaseUrl
  );

  const easyPayBalanceCentsPerYuan = normalizeEasyPayBalanceCentsPerYuan(
    settings?.easyPayBalanceCentsPerYuan ?? DEFAULT_EASYPAY_BALANCE_CENTS_PER_YUAN
  );
  const codingPlan = normalizeCodingPlanConfig({
    description: settings?.codingPlanDescription,
    enabled: settings?.codingPlanEnabled,
    monthlyCostLimitCents: settings?.codingPlanMonthlyCostLimitCents,
    name: settings?.codingPlanName,
    personalApiEnabled: settings?.codingPlanPersonalApiEnabled,
    priceCents: settings?.codingPlanPriceCents
  });

  return {
    easyPayEnabled: configured,
    easyPayDisplayMode: normalizeEasyPayDisplayMode(settings?.easyPayDisplayMode),
    easyPayMethods: parseEasyPayMethods(settings?.easyPayMethodsJson),
    easyPayBalanceCentsPerYuan,
    easyPayAmountTiers: parseEasyPayAmountTiers(
      settings?.easyPayAmountTiersJson,
      easyPayBalanceCentsPerYuan
    ),
    codingPlan
  };
}
