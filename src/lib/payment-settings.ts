import {
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
};

export async function getPublicPaymentSettings(): Promise<PublicPaymentSettings> {
  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" },
    select: {
      easyPayEnabled: true,
      easyPayDisplayMode: true,
      easyPayMethodsJson: true,
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
    easyPayMethods: parseEasyPayMethods(settings?.easyPayMethodsJson)
  };
}
