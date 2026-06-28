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

export type PublicPaymentSettings = {
  easyPayEnabled: boolean;
  easyPayDisplayMode: EasyPayDisplayMode;
  easyPayMethods: EasyPayMethod[];
  easyPayBalanceCentsPerYuan: number;
  easyPayAmountTiers: EasyPayAmountTier[];
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

  return {
    easyPayEnabled: configured,
    easyPayDisplayMode: normalizeEasyPayDisplayMode(settings?.easyPayDisplayMode),
    easyPayMethods: parseEasyPayMethods(settings?.easyPayMethodsJson),
    easyPayBalanceCentsPerYuan,
    easyPayAmountTiers: parseEasyPayAmountTiers(
      settings?.easyPayAmountTiersJson,
      easyPayBalanceCentsPerYuan
    )
  };
}
