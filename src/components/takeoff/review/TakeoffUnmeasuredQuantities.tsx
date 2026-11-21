import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function TakeoffUnmeasuredQuantities({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return <Alert variant="warning">
    <AlertTitle>Quantités à vérifier</AlertTitle>
    <AlertDescription><ul className="list-disc space-y-1 pl-4">
      {messages.map((message) => <li key={message}>{message}</li>)}
    </ul></AlertDescription>
  </Alert>;
}

export function takeoffUnmeasuredQuantityMessages(warnings: unknown[] | null | undefined) {
  const messages = new Set<string>();
  for (const warning of warnings ?? []) {
    if (warning && typeof warning === "object" && "code" in warning && warning.code === "QUANTITE_A_VERIFIER" &&
        "message" in warning && typeof warning.message === "string") messages.add(warning.message);
  }
  return [...messages];
}
