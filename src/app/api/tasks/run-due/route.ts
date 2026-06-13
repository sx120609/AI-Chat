import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { runDueTasks } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasRunnerSecret(request: NextRequest) {
  const configured = process.env.TASK_RUNNER_SECRET?.trim();

  if (!configured) {
    return false;
  }

  const provided =
    request.headers.get("x-task-runner-secret") ||
    request.nextUrl.searchParams.get("secret") ||
    "";

  return provided === configured;
}

async function authorize(request: NextRequest) {
  if (hasRunnerSecret(request)) {
    return true;
  }

  const user = await getUserFromRequest(request);

  return user?.active && user.role === "ADMIN";
}

async function run(request: NextRequest) {
  if (!(await authorize(request))) {
    return jsonError("没有权限运行到期任务。", 401);
  }

  const limitValue = Number(request.nextUrl.searchParams.get("limit") || "10");
  const result = await runDueTasks({
    limit: Number.isFinite(limitValue) ? limitValue : 10,
    signal: request.signal
  });

  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
