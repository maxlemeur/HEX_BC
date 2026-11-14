import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** A screen part that could not be loaded: what failed, the server's sentence, and a retry. */
export function LoadFailure({ title, message, onRetry }: Readonly<{ title: string; message: string; onRetry: () => void }>) {
  return (
    <Alert variant="danger">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Réessayer
        </Button>
      </AlertDescription>
    </Alert>
  );
}
