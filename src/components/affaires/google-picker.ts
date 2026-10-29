"use client";

import { z } from "zod";
import { DRIVE_MAX_FILES, driveIdSchema } from "@/lib/affaires/google-drive/contracts";

type Picker = { setVisible: (visible: boolean) => void; dispose: () => void };
type DocsView = { setIncludeFolders: (value: boolean) => DocsView; setSelectFolderEnabled: (value: boolean) => DocsView;
  setEnableDrives: (value: boolean) => DocsView; setMode: (value: string) => DocsView };
type PickerBuilder = { addView: (view: DocsView) => PickerBuilder; enableFeature: (value: string) => PickerBuilder;
  setOAuthToken: (value: string) => PickerBuilder; setDeveloperKey: (value: string) => PickerBuilder;
  setAppId: (value: string) => PickerBuilder; setCallback: (callback: (value: unknown) => void) => PickerBuilder; build: () => Picker };
type PickerApi = { DocsView: new (viewId: string) => DocsView; PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: string }; DocsViewMode: { LIST: string }; Feature: { MULTISELECT_ENABLED: string };
  Action: { PICKED: string; CANCEL: string; ERROR: string } };
type GoogleWindow = Window & { gapi?: { load: (name: string, options: { callback: () => void; onerror: () => void;
  timeout: number; ontimeout: () => void }) => void }; google?: { picker?: PickerApi } };

const fileSchema = z.object({ id: driveIdSchema, name: z.string().min(1).max(255) });
let library: Promise<PickerApi> | undefined;

function loadPicker(): Promise<PickerApi> {
  if (library) return library;
  const browser = window as GoogleWindow;
  library = new Promise<PickerApi>((resolve, reject) => {
    const script = browser.gapi ? undefined : document.createElement("script");
    const timer: { id?: ReturnType<typeof setTimeout> } = {};
    const failed = () => { clearTimeout(timer.id); script?.remove(); reject(new Error("Impossible de charger le sélecteur Google Drive.")); };
    const load = () => {
      clearTimeout(timer.id);
      if (!browser.gapi) return failed();
      try {
        browser.gapi.load("picker", { callback: () => browser.google?.picker ? resolve(browser.google.picker) : failed(),
          onerror: failed, timeout: 15_000, ontimeout: failed });
      } catch { failed(); }
    };
    if (!script) return load();
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = load;
    script.onerror = failed;
    timer.id = setTimeout(failed, 15_000);
    document.head.appendChild(script);
  }).catch((error: unknown) => { library = undefined; throw error; });
  return library;
}

/** Opens Google's file selector only on user request. The token is not persisted. */
export async function openGooglePicker(input: { accessToken: string; apiKey: string; projectNumber: string; signal?: AbortSignal }) {
  if (input.signal?.aborted) throw new DOMException("Sélection annulée.", "AbortError");
  const api = await loadPicker();
  if (input.signal?.aborted) throw new DOMException("Sélection annulée.", "AbortError");
  return new Promise<Array<z.infer<typeof fileSchema>>>((resolve, reject) => {
    let picker: Picker | undefined;
    let finished = false;
    const finish = (files?: Array<z.infer<typeof fileSchema>>, error?: Error) => {
      if (finished) return;
      finished = true;
      input.signal?.removeEventListener("abort", abort);
      try { picker?.dispose(); } catch { /* The result must still reach the caller. */ }
      if (error) reject(error); else resolve(files ?? []);
    };
    const abort = () => finish(undefined, new DOMException("Sélection annulée.", "AbortError"));
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      const myDrive = new api.DocsView(api.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false).setMode(api.DocsViewMode.LIST);
      const sharedDrives = new api.DocsView(api.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false)
        .setEnableDrives(true).setMode(api.DocsViewMode.LIST);
      picker = new api.PickerBuilder().addView(myDrive).addView(sharedDrives).enableFeature(api.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(input.accessToken).setDeveloperKey(input.apiKey).setAppId(input.projectNumber)
        .setCallback((value) => {
          const response = value as { action?: unknown; docs?: unknown } | null;
          if (response?.action === api.Action.CANCEL) return finish([]);
          if (response?.action === api.Action.ERROR) return finish(undefined, new Error("Le sélecteur Google Drive a rencontré une erreur."));
          if (response?.action !== api.Action.PICKED) return;
          const files = z.array(fileSchema).min(1).max(DRIVE_MAX_FILES).safeParse(response.docs);
          if (!files.success || new Set(files.data.map((file) => file.id)).size !== files.data.length) {
            return finish(undefined, new Error(`Sélection invalide : choisissez au plus ${DRIVE_MAX_FILES} fichiers différents.`));
          }
          finish(files.data);
        }).build();
      if (input.signal?.aborted) return abort();
      picker.setVisible(true);
    } catch {
      finish(undefined, new Error("Impossible d'ouvrir le sélecteur Google Drive."));
    }
  });
}
