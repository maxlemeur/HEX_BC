import { LabStatsScreen } from "@/components/takeoff/lab/LabStatsScreen";
import { readTakeoffLabPageAccess } from "@/lib/takeoff/lab/server";

export default async function TakeoffLabStatsPage() {
  if ((await readTakeoffLabPageAccess()).status !== "allowed") return null;
  return <LabStatsScreen />;
}
