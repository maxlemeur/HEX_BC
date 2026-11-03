import { LabVerdictsScreen } from "@/components/takeoff/lab/LabVerdictsScreen";
import { readTakeoffLabPageAccess } from "@/lib/takeoff/lab/server";

export default async function TakeoffLabVerdictsPage() {
  if ((await readTakeoffLabPageAccess()).status !== "allowed") return null;
  return <LabVerdictsScreen />;
}
