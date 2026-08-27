import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { redeemCode, RedemptionCodeError } from "@/lib/redemption-codes";

export const runtime = "nodejs";

type RedeemBody = {
  code?: string;
};

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const authError = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  let body: RedeemBody;

  try {
    body = await readJson<RedeemBody>(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "兑换失败。", 400);
  }

  try {
    const result = await redeemCode(currentUser.id, body.code);

    return NextResponse.json({
      codingPlanExpiresAt: result.codingPlanExpiresAt?.toISOString() ?? null,
      label: result.label,
      reward: result.reward
    });
  } catch (error) {
    if (error instanceof RedemptionCodeError) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: error.status }
      );
    }

    console.error("[redemption] Failed to redeem code:", error);
    return jsonError("兑换失败，请稍后重试。", 500);
  }
}
