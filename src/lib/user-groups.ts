export const USER_GROUPS = ["NORMAL", "VIP"] as const;

export type UserGroup = (typeof USER_GROUPS)[number];

export function normalizeUserGroup(value: unknown): UserGroup {
  return value === "VIP" ? "VIP" : "NORMAL";
}

export function canUsePersonalApi(user: { userGroup: string; active: boolean; emailVerified: boolean }) {
  return user.active && user.emailVerified && normalizeUserGroup(user.userGroup) === "VIP";
}
