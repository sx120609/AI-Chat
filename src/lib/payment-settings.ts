import {
  DEFAULT_EASYPAY_BALANCE_CENTS_PER_YUAN,
  normalizeEasyPayBalanceCentsPerYuan,
  parseEasyPayMethods,
  normalizeEasyPayDisplayMode,
  type EasyPayDisplayMode,
  type EasyPayMethod
} from "@/lib/easypay";
import { prisma } from "@/lib/prisma";

export type PublicPaymentSettings = {
  easyPayEnabled: boolean;
  easyPayDisplayMode: EasyPayDisplayMode;
  easyPayMethods: EasyPayMethod[];
  easyPayBalanceCentsPerYuan: number;
};

export async function getPublicPaymentSettings(): Promise<PublicPaymentSettings> {
  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" },
    select: {
      easyPayEnabled: true,
      easyPayDisplayMode: true,
      easyPayMethodsJson: true,
      easyPayBalanceCentsPerYuan: true,
      easyPayPid: true,
      easyPayKey: true,
      easyPayApiBaseUrl: true
    }
  });

  const configured = Boolean(
    settings?.easyPayEnabled &&
      settings.easyPayPid &&
      settings.easyPayKey &&
      settings.easyPayApiBaseUrl
  );

  return {
    easyPayEnabled: configured,
    easyPayDisplayMode: normalizeEasyPayDisplayMode(settings?.easyPayDisplayMode),
    easyPayMethods: parseEasyPayMethods(settings?.easyPayMethodsJson),
    easyPayBalanceCentsPerYuan: normalizeEasyPayBalanceCentsPerYuan(
      settings?.easyPayBalanceCentsPerYuan ?? DEFAULT_EASYPAY_BALANCE_CENTS_PER_YUAN
    )
  };
}
