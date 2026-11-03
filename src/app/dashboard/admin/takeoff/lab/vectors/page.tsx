import { LabVectorsScreen } from "@/components/takeoff/lab/LabVectorsScreen";
import { readTakeoffLabPageAccess } from "@/lib/takeoff/lab/server";

export default async function TakeoffLabVectorsPage() {
  if ((await readTakeoffLabPageAccess()).status !== "allowed") return null;
  return <LabVectorsScreen />;
}
