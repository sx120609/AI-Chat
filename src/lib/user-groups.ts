export const USER_GROUPS = ["NORMAL", "VIP"] as const;

export type UserGroup = (typeof USER_GROUPS)[number];

export function normalizeUserGroup(value: unknown): UserGroup {
  return value === "VIP" ? "VIP" : "NORMAL";
}

export function canUsePersonalApi(user: {
  userGroup: string;
  active: boolean;
  emailVerified: boolean;
  codingPlanExpiresAt?: Date | string | null;
  codingPlanPersonalApiEnabled?: boolean;
}) {
  const planExpiresAt = user.codingPlanExpiresAt ? new Date(user.codingPlanExpiresAt) : null;
  const codingPlanApiAccess =
    Boolean(user.codingPlanPersonalApiEnabled) &&
    Boolean(planExpiresAt && Number.isFinite(planExpiresAt.getTime()) && planExpiresAt > new Date());

  return (
    user.active &&
    user.emailVerified &&
    (normalizeUserGroup(user.userGroup) === "VIP" || codingPlanApiAccess)
  );
}
