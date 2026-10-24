"use client";
import { DRIVE_READ_SCOPE } from "./contracts";

type TokenResponse = { access_token?: string; expires_in?: number; error?: string };
type Identity = { accounts: { oauth2: {
  initTokenClient: (options: { client_id: string; scope: string; include_granted_scopes: boolean;
    callback: (response: TokenResponse) => void; error_callback: () => void }) => { requestAccessToken: (options: { prompt: string }) => void };
  revoke: (token: string, callback: (result: { successful?: boolean }) => void) => void;
} } };
declare global { interface Window { google?: Identity } }
let loading: Promise<void> | undefined;
export function prepareGoogleIdentity() {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  if (!loading) loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { loading = undefined; script.remove(); reject(new Error("Service de connexion Google indisponible.")); };
    document.head.appendChild(script);
  });
  return loading;
}
export function connectGoogleDrive(clientId: string) {
  return new Promise<{ token: string; expiresAt: number }>((resolve, reject) => {
    if (!window.google?.accounts.oauth2) return reject(new Error("Service Google indisponible. Rouvrez le panneau."));
    const client = window.google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: DRIVE_READ_SCOPE,
      include_granted_scopes: false,
      callback: (response) => {
        if (!response.access_token || response.error) return reject(new Error("Connexion annulée ou consentement refusé. Aucune pièce importée."));
        resolve({ token: response.access_token, expiresAt: Date.now() + Math.max(0, (response.expires_in ?? 0) - 30) * 1000 });
      },
      error_callback: () => reject(new Error("Fenêtre Google fermée ou bloquée. Relancez la connexion.")),
    });
    client.requestAccessToken({ prompt: "consent" });
  });
}
export function revokeGoogleDrive(token: string) {
  return new Promise<void>((resolve, reject) => {
    if (!window.google?.accounts.oauth2) return reject(new Error("Révocation Google indisponible. Retirez l'accès dans votre compte Google."));
    window.google.accounts.oauth2.revoke(token, (result) => result.successful ? resolve()
      : reject(new Error("Connexion locale fermée. Vérifiez la révocation dans votre compte Google.")));
  });
}
