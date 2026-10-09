import { notFound } from "next/navigation";

/** Unknown dashboard URLs render the dashboard not-found page inside the shell. */
export default function UnknownDashboardRoute() {
  notFound();
}
