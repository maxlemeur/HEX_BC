import { redirect } from "next/navigation";

export default function LegacyEstimateDashboardPage() {
  redirect("/dashboard/analytics");
}
