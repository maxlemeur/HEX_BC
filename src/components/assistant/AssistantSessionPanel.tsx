"use client";

import Link from "next/link";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import { AssistantAiSettingsMenu, usableAiChoice, useAssistantAiSettings, type AssistantContextOption } from "@/components/ai/AssistantAiSettings";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { defaultAiRequestSettings, AI_REQUEST_SOURCE_LABELS } from "@/lib/ai/request-settings";
import { readAssistantStream } from "@/lib/assistant/client-stream";
import { ASSISTANT_CEILING_MESSAGE, ASSISTANT_KEY_CEILING } from "@/lib/assistant/request-settings";
import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { ASSISTANT_HISTORY_LIMIT, ASSISTANT_HISTORY_MESSAGE_LIMIT, type AssistantSessionContext, type AssistantSourceLink } from "@/lib/assistant/session-context";
import { isZeroReliabilityCriterion } from "@/lib/catalogue/workbook-reliability-filter";
import {
  ASSISTANT_FILE_ACCEPT, ASSISTANT_FILE_FORMAT_MESSAGE, ASSISTANT_FILE_LIMIT_MESSAGE, ASSISTANT_MAX_FILE_BYTES, ASSISTANT_MAX_FILES,
  assistantFileName, assistantFileType,
} from "@/lib/assistant/session-files";
import { AnswerText } from "./AssistantPanel";

const storedMessage = z.object({
  id: z.string(), role: z.enum(["user", "assistant"]), text: z.string().max(60_000), contextKey: z.string().max(500),
  sources: z.array(z.object({ label: z.string(), href: z.string().regex(/^\/dashboard(?:\/|$)/) })).max(8).optional(),
  projectId: z.uuid().optional(), interrupted: z.boolean().optional(),
  fileNames: z.array(z.string().max(180)).max(ASSISTANT_MAX_FILES).optional(),
});
type Message = z.infer<typeof storedMessage>;
const MAX_SAVED_MESSAGES = 24;

function encodeFile(file: File): Promise<{ name: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma === -1) reject(new Error("Le fichier n’a pas pu être lu."));
      else resolve({ name: assistantFileName(file.name), base64: result.slice(comma + 1) });
    };
    reader.onerror = () => reject(new Error("Le fichier n’a pas pu être lu."));
    reader.readAsDataURL(file);
  });
}

function readMessages(key: string): Message[] {
  try {
    const parsed = z.array(storedMessage).max(MAX_SAVED_MESSAGES).safeParse(JSON.parse(sessionStorage.getItem(key) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export default function AssistantSessionPanel({ context, userId, tenantId, visible, contextOptions, workbookSnapshot, onWorkbookExclusion, onWorkbookReliabilityZero }: {
  context: AssistantSessionContext; userId: string; tenantId: string; visible: boolean; contextOptions: readonly AssistantContextOption[];
  workbookSnapshot?: symbol;
  onWorkbookExclusion(snapshot: symbol, criterion: string): void;
  onWorkbookReliabilityZero(snapshot: symbol): boolean;
}) {
  const storageKey = "mergeone:assistant:v1:" + userId + ":" + tenantId;
  const shared = useAssistantAiSettings();
  const options = shared?.options;
  const selection = shared?.choice ?? (options ? defaultAiRequestSettings(options.defaultSource, options.sources) : undefined);
  const ready = Boolean(options && usableAiChoice(selection, options.sources) && !shared?.pending
    && (selection?.source !== "personal_api_key" || options.keyConnectionId));
  const [messages, setMessages] = useState<Message[]>([]);
  const [restored, setRestored] = useState(false);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState<{ text: string; activity?: string } | null>(null);
  const [workbookAction, setWorkbookAction] = useState<{ messageId: string; snapshot: symbol; criterion: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextKey = JSON.stringify(context);
  const directWorkbookFilter = context.kind === "workbook" && isZeroReliabilityCriterion(input);

  useEffect(() => {
    setMessages(readMessages(storageKey));
    setRestored(true);
    return () => controller.current?.abort();
  }, [storageKey]);
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-MAX_SAVED_MESSAGES))); } catch { /* Keep the conversation in memory. */ }
  }, [messages, restored, storageKey]);
  useEffect(() => {
    if (visible && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [visible, messages, pending]);
  useEffect(() => {
    if (visible) inputRef.current?.focus({ preventScroll: true });
  }, [visible]);

  function addFiles(selected: File[]) {
    const next = [...files, ...selected];
    if (next.length > ASSISTANT_MAX_FILES || next.reduce((sum, file) => sum + file.size, 0) > ASSISTANT_MAX_FILE_BYTES) {
      setError(ASSISTANT_FILE_LIMIT_MESSAGE);
      return;
    }
    if (selected.some((file) => !assistantFileType(assistantFileName(file.name)) || file.size === 0)) {
      setError("Choisissez un fichier lisible et non vide. " + ASSISTANT_FILE_FORMAT_MESSAGE);
      return;
    }
    setError(null);
    setFiles(next);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (controller.current) return;
    if (directWorkbookFilter) {
      if (files.length) {
        setError("Retirez les pièces jointes pour appliquer ce filtre au classeur d’import.");
        return;
      }
      if (!workbookSnapshot || !onWorkbookReliabilityZero(workbookSnapshot)) {
        setError("Ouvrez un classeur prêt à être analysé avant d’appliquer ce filtre.");
        return;
      }
      setMessages((current) => [...current,
        { id: crypto.randomUUID(), role: "user" as const, text: input.trim(), contextKey },
        { id: crypto.randomUUID(), role: "assistant" as const,
          text: "L’aperçu « Fiabilité Excel à zéro » est ouvert.", contextKey },
      ].slice(-MAX_SAVED_MESSAGES));
      setInput("");
      setError(null);
      return;
    }
    const question = input.trim() || (files.length ? "Résume les fichiers joints." : "");
    if (!question || !ready || !selection?.source || !selection.preferences || !options) return;
    const request = new AbortController();
    controller.current = request;
    const analysisSnapshot = context.kind === "workbook" ? workbookSnapshot : undefined;
    const attachments = files;
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", text: question, contextKey,
      ...(attachments.length ? { fileNames: attachments.map((file) => assistantFileName(file.name)) } : {}) };
    const history = messages.filter(({ text, contextKey: previous, interrupted }) => previous === contextKey && !interrupted && text.trim())
      .slice(-ASSISTANT_HISTORY_LIMIT).map(({ role, text }) => ({ role, content: text.trim().slice(0, ASSISTANT_HISTORY_MESSAGE_LIMIT) }));
    setMessages((current) => [...current, userMessage].slice(-MAX_SAVED_MESSAGES));
    setInput("");
    setFiles([]);
    setPending({ text: "" });
    setError(null);
    let text = "";
    let finished = false;
    let accepted = false;
    const restoreDraft = () => {
      setInput((current) => current || input);
      setFiles(attachments);
      setMessages((current) => current.filter(({ id }) => id !== userMessage.id));
    };
    function addAnswer(id: string, body: string, sources?: AssistantSourceLink[], projectId?: string, interrupted?: boolean) {
      if (!body && !sources?.length) return;
      setMessages((current) => [...current, { id, role: "assistant" as const, text: body.slice(0, 60_000),
        contextKey, sources, projectId, interrupted }].slice(-MAX_SAVED_MESSAGES));
    }
    try {
      const encoded = await Promise.all(attachments.map(encodeFile));
      request.signal.throwIfAborted();
      const response = await fetch("/api/assistant/session/messages", {
        method: "POST", credentials: "same-origin", signal: request.signal,
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ content: question, context, history, userId, tenantId,
          ...(analysisSnapshot ? { workbookLoaded: true } : {}),
          ...(encoded.length ? { files: encoded } : {}),
          aiSettings: { source: selection.source, model: selection.preferences.model, effort: selection.preferences.reasoningEffort,
            ...(selection.source === "personal_api_key" ? { connectionId: options.keyConnectionId } : {}) } }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "La question n’a pas pu être envoyée.");
        restoreDraft();
        if (response.status === 409) shared?.refresh();
        return;
      }
      await readAssistantStream(response, (part) => {
        if (part.type === "started") {
          accepted = true;
        } else if (part.type === "text") {
          text += part.delta;
          setPending({ text });
        } else if (part.type === "tool_started") {
          setPending({ text, activity: part.activity });
        } else if (part.type === "done") {
          finished = true;
          const answerId = part.message?.id ?? crypto.randomUUID();
          const criterion = analysisSnapshot ? part.workbookExclusion : undefined;
          if (analysisSnapshot && criterion) setWorkbookAction({ messageId: answerId, snapshot: analysisSnapshot, criterion });
          addAnswer(answerId, part.message?.content || text || (criterion ? "Le critère d’exclusion est prêt." : ""),
            part.sources, part.projectId, part.message?.status === "interrupted");
          if (part.message?.errorCode === "AI_KEY_CEILING") setError(ASSISTANT_CEILING_MESSAGE);
          else if (part.error) setError(part.error.message);
        }
      });
      if (!finished && !request.signal.aborted) throw new Error("Flux interrompu");
    } catch {
      if (text && !finished) addAnswer(crypto.randomUUID(), text, undefined, undefined, true);
      if (!request.signal.aborted) {
        setError("L’envoi a été interrompu. Réessayez.");
      }
      if (!text && (!accepted || !request.signal.aborted)) restoreDraft();
    } finally {
      controller.current = null;
      setPending(null);
    }
  }

  const availability = directWorkbookFilter ? "Filtre direct sur le fichier Excel."
    : options ? ready ? null : "Choisissez une source et un modèle disponibles dans Réglages IA."
    : shared?.error ?? "Chargement des réglages IA…";

  return (
    <div hidden={!visible} className="min-w-0">
      <div ref={scroller}
        className="max-h-[min(42dvh,28rem)] space-y-3 overflow-y-auto px-4 text-foreground [--foreground:var(--workbook-composer-text)] [--muted-foreground:var(--workbook-composer-muted)] [--primary:var(--workbook-composer-send)]"
        aria-label="Conversation" role="log">
        {messages.map((message) => message.role === "user" ? (
          <div key={message.id} className="ml-auto mt-3 w-fit max-w-[90%] space-y-1 rounded-xl bg-(--workbook-composer-control) px-3 py-2 text-sm">
            {message.fileNames?.length ? <ul aria-label="Fichiers joints" className="text-xs text-muted-foreground">
              {message.fileNames.map((name, index) => <li key={index} className="flex items-center gap-1.5 break-all">
                <Paperclip aria-hidden="true" className="size-3 shrink-0" /> {name}
              </li>)}
            </ul> : null}
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
          </div>
        ) : (
          <div key={message.id} className="space-y-1.5 py-1.5">
            <AnswerText text={message.text} streaming={false} projectId={message.projectId} verified={Boolean(message.projectId)} />
            {message.sources?.length ? <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {message.sources.map(({ href, label }) => <li key={href}>
                <Link href={href} className="text-xs font-medium text-primary underline underline-offset-2">{label}</Link>
              </li>)}
            </ul> : null}
            {workbookAction?.messageId === message.id && workbookAction.snapshot === workbookSnapshot ? (
              <Button type="button" variant="outline" size="sm"
                className="mt-1 whitespace-normal rounded-full border-(--workbook-composer-border) bg-(--workbook-composer-control) text-(--workbook-composer-text) hover:bg-(--workbook-composer-control) hover:text-(--workbook-composer-text)"
                onClick={() => onWorkbookExclusion(workbookAction.snapshot, workbookAction.criterion)}>
                Préparer l’analyse du classeur
              </Button>
            ) : null}
            {message.interrupted ? <p className="text-xs text-muted-foreground">Réponse interrompue</p> : null}
          </div>
        ))}
        {pending ? <div className="space-y-2 py-2" aria-live="off">
          {pending.text ? <AnswerText text={pending.text} streaming verified={false} /> : null}
          <p className="text-xs text-muted-foreground">{pending.activity ?? "L’assistant répond…"}</p>
        </div> : null}
      </div>
      <form onSubmit={(event) => void send(event)}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = controller.current ? "none" : "copy";
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          const dropped = Array.from(event.dataTransfer.files);
          if (dropped.length && !controller.current) addFiles(dropped);
        }}
        className="m-2 space-y-1.5 rounded-2xl border border-(--workbook-composer-border) bg-(--workbook-composer-surface) p-2 focus-within:border-(--workbook-composer-muted) sm:m-3 sm:p-3">
        {files.length ? <>
          <ul aria-label="Fichiers à envoyer" className="flex flex-wrap gap-1.5">
            {files.map((file, index) => (
              <li key={index} className="flex min-w-0 max-w-full items-center gap-1 rounded-lg bg-(--workbook-composer-control) pl-2 text-xs text-(--workbook-composer-text)">
                <span className="truncate">{assistantFileName(file.name)}</span>
                <IconButton type="button" size="icon-xs" label={`Retirer ${assistantFileName(file.name)}`} icon={<X aria-hidden="true" />}
                  className="shrink-0 text-(--workbook-composer-text) hover:bg-(--workbook-composer-surface) hover:text-(--workbook-composer-text)"
                  onClick={() => { setFiles((current) => current.filter((_, position) => position !== index)); setError(null); }} />
              </li>
            ))}
          </ul>
          <p className="px-2 text-xs text-(--workbook-composer-muted)">Les fichiers seront transmis à la source IA choisie avec ce message.</p>
        </> : null}
        <Textarea ref={inputRef} rows={2} value={input} onChange={(event) => setInput(event.target.value)}
          aria-label="Votre message à l’assistant"
          placeholder={context.kind === "workbook" && workbookSnapshot ? "Ex. Écarte les articles en acier galvanisé…" : "Écrivez votre message…"}
          maxLength={4000}
          className="max-h-32 min-h-14 resize-none border-0 bg-transparent text-(--workbook-composer-text) placeholder:text-(--workbook-composer-muted) focus-visible:ring-0"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} />
        {error ? <p role="alert" className="px-2 text-sm text-(--workbook-composer-text)">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" ref={fileInputRef} accept={ASSISTANT_FILE_ACCEPT} multiple hidden
            onChange={(event) => {
              const selected = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (selected.length && !controller.current) addFiles(selected);
            }} />
          <IconButton type="button" size="icon" label="Joindre des fichiers" icon={<Paperclip aria-hidden="true" />}
            disabled={Boolean(pending)} onClick={() => fileInputRef.current?.click()}
            className="rounded-full text-(--workbook-composer-text) hover:bg-(--workbook-composer-control) hover:text-(--workbook-composer-text)" />
          <p className="min-w-24 flex-1 text-xs text-(--workbook-composer-muted)" role="status">
            {availability ?? (selection?.source === "personal_api_key" ? "Clé API · " + formatUsdCeiling(ASSISTANT_KEY_CEILING) + " au plus par message"
              : selection?.source ? AI_REQUEST_SOURCE_LABELS[selection.source] : null)}
          </p>
          <AssistantAiSettingsMenu contextOptions={contextOptions} />
          {pending ? <IconButton label="Arrêter la réponse" icon={<Square aria-hidden="true" />} size="icon"
            variant="secondary" onClick={() => controller.current?.abort()} />
            : <Button type="submit" size="icon-lg" disabled={!directWorkbookFilter && (!ready || (!input.trim() && !files.length))} aria-label="Envoyer"
              className="size-11 shrink-0 rounded-full bg-(--workbook-composer-send) text-(--workbook-composer-send-text) hover:bg-(--workbook-composer-send-hover)">
              <ArrowUp aria-hidden="true" className="size-5" />
            </Button>}
        </div>
      </form>
    </div>
  );
}
