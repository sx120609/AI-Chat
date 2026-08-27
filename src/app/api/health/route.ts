import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      release: process.env.DEPLOY_RELEASE || "development",
      status: "ok"
    });
  } catch (error) {
    console.error("[health] Database readiness check failed:", error);

    return NextResponse.json(
      {
        release: process.env.DEPLOY_RELEASE || "development",
        status: "unavailable"
      },
      { status: 503 }
    );
  }
}
