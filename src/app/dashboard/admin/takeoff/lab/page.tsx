import { LabEssaiScreen } from "@/components/takeoff/lab/LabEssaiScreen";
import { readTakeoffLabPageAccess } from "@/lib/takeoff/lab/server";

export default async function TakeoffLabPage() {
  // The layout renders the refusal; a page reached without it shows nothing.
  if ((await readTakeoffLabPageAccess()).status !== "allowed") return null;
  return <LabEssaiScreen />;
}
