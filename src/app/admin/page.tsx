import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { getCurrentUser, serializeCurrentUser } from "@/lib/auth";

export default async function AdminPage() {
  const user = await getCurrentUser();

  if (!user || !user.active) {
    redirect("/login");
  }

  if (user.role !== "ADMIN") {
    redirect("/chat");
  }

  return <AdminDashboard currentUser={serializeCurrentUser(user)} />;
}
