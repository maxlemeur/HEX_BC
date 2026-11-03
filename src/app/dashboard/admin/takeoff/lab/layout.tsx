import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TakeoffLabShell } from "@/components/takeoff/lab/TakeoffLabShell";
import { readLabState, readTakeoffLabPageAccess } from "@/lib/takeoff/lab/server";

export const metadata = { title: "Labo métré" };

/**
 * Takeoff lab (TI-661), a « tool » screen of the dashboard (no margins, no
 * footer, only its panels scroll). Checked on the server: MergeOne local on
 * 127.0.0.1, tenant admin. Its API routes check the same and answer 403.
 */
export default async function TakeoffLabLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const gate = await readTakeoffLabPageAccess();
  if (gate.status !== "allowed") {
    return (
      <div className="flex h-full items-start justify-center overflow-auto p-8">
        <Alert variant="warning" className="max-w-xl">
          <AlertTitle>Labo métré indisponible</AlertTitle>
          <AlertDescription>{gate.message}</AlertDescription>
        </Alert>
      </div>
    );
  }
  return <TakeoffLabShell initialState={await readLabState(gate.access)}>{children}</TakeoffLabShell>;
}
