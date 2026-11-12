"use client";

import Link from "next/link";
import { ArrowUp, Check, Plus, Square, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import useSWR from "swr";

import {
  loadAssistantThread, loadAssistantThreads, removeAssistantThread, startAssistantThread,
} from "@/app/dashboard/_actions/assistant";
import type { AssistantScope } from "@/components/assistant/AssistantDock";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { readAssistantStream, splitAssistantText } from "@/lib/assistant/client-stream";
import type { AssistantActivity, AssistantMessage } from "@/lib/assistant/threads-server";

type Draft = { text: string; activity: AssistantActivity[]; running: string | null };
/** `retryable`: the answer failed, so asking again makes sense; loading or deleting a conversation is not an answer. */
type Failure = { code: string; message: string; retryable: boolean };

/** A sentence written for the member. Anything else (network, parsing) gets one fixed sentence instead of its own text. */
class AssistantUserError extends Error {
  constructor(message: string, readonly code = "AI_FAILED") {
    super(message);
  }
}

const CONNECTION_FAILED = "La connexion à l’assistant a échoué. Vérifiez votre réseau, puis réessayez.";
const PENDING = "pending-";

const SUGGESTIONS: Record<AssistantScope["screen"]["screen"], string[]> = {
  estimate_editor: [
    "Comment se décompose le total de ce devis ?",
    "Quelles lignes ne sont pas encore chiffrées ?",
    "Quelles sont les sections les plus lourdes ?",
  ],
  takeoff_review: [
    "Résume ce métré en quelques lignes.",
    "Quelles lignes du métré restent à vérifier ?",
    "Quelles quantités semblent incohérentes ?",
  ],
  affaire: ["Quels devis existent sur cette affaire ?", "Quel est le total du dernier devis ?"],
};

/** Codes whose fix is in the profile page: the ChatGPT account, its model or its allowance. */
const PROFILE_CODES = new Set(["AI_AUTH_REQUIRED", "AI_NOT_CONFIGURED", "AI_QUOTA", "AI_RATE_LIMIT", "AI_REQUEST_REJECTED"]);
const NEW_THREAD = "";

function AnswerText({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
      {splitAssistantText(text, streaming).map((part, index) => part.type === "text" ? part.value : (
        // A cited line opens in the estimate it belongs to, which may not be the one on screen.
        <Link
          key={`${part.id}-${index}`}
          href={`/dashboard/estimates/${part.versionId}/edit?focusItemId=${part.id}`}
          className="font-medium text-primary underline underline-offset-2"
          data-testid="assistant-line-link"
        >
          {part.label}
        </Link>
      ))}
    </p>
  );
}

function ActivityList({ activity, running }: { activity: AssistantActivity[]; running?: string | null }) {
  if (activity.length === 0 && !running) return null;
  return (
    <ul className="space-y-1 text-xs text-muted-foreground" data-testid="assistant-activity">
      {activity.map((entry, index) => (
        <li key={`${entry.name}-${index}`} className="flex items-center gap-1.5">
          {entry.ok ? <Check aria-hidden="true" className="size-3" /> : <X aria-hidden="true" className="size-3" />}
          <span>{entry.activity}{entry.ok ? "" : " (refusée)"}</span>
        </li>
      ))}
      {running ? (
        <li className="flex items-center gap-1.5">
          <Spinner className="size-3" aria-label="En cours" />
          <span>{running}…</span>
        </li>
      ) : null}
    </ul>
  );
}

export default function AssistantPanel({ scope, activeThreadId, onActiveThreadChange, onClose }: {
  scope: AssistantScope;
  activeThreadId: string | null;
  onActiveThreadChange(threadId: string | null): void;
  onClose(): void;
}) {
  const { projectId, screen } = scope;
  const threads = useSWR(["assistant-threads", projectId], () => loadAssistantThreads(projectId), { revalidateOnFocus: false });
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [input, setInput] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const request = useRef<AbortController | null>(null);
  // A conversation opened by its first question has nothing to load yet.
  const justStarted = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const sending = draft !== null;

  useEffect(() => {
    setConfirmingDelete(false);
    // Once: coming back to this conversation later reads it from the server like any other.
    if (activeThreadId !== null && justStarted.current === activeThreadId) { justStarted.current = null; return; }
    // Never show one conversation's messages under another's title while it loads.
    setMessages([]);
    setFailure(null);
    if (activeThreadId === null) return;
    let cancelled = false;
    setLoading(true);
    void loadAssistantThread(activeThreadId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) setMessages(result.data.messages);
      else setFailure({ code: "LOAD_FAILED", message: result.message, retryable: false });
    }, () => {
      if (cancelled) return;
      setLoading(false);
      setFailure({ code: "LOAD_FAILED", message: CONNECTION_FAILED, retryable: false });
    });
    return () => { cancelled = true; setLoading(false); };
  }, [activeThreadId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, draft]);

  // Leaving the panel stops the answer being written; what was written is saved by the server.
  useEffect(() => () => request.current?.abort(), []);

  const send = useCallback(async (content: string, retryOf?: string) => {
    const question = content.trim();
    if (!question || request.current || loading) return;
    setFailure(null);
    setAnnouncement("L’assistant répond.");
    let threadId = activeThreadId;
    const controller = new AbortController();
    request.current = controller;
    setDraft({ text: "", activity: [], running: null });
    const pendingId = `${PENDING}${Date.now()}`;
    if (!retryOf) {
      setMessages((current) => [...current, {
        id: pendingId, role: "user", status: "complete", content: question, activity: [], errorCode: null,
        createdAt: new Date().toISOString(),
      }]);
    }
    let written = "";
    let activity: AssistantActivity[] = [];
    const running = new Map<string, { name: string; activity: string }>();
    let finished = false;
    const local = (status: AssistantMessage["status"]): AssistantMessage => ({
      id: `local-${Date.now()}`, role: "assistant", status, content: written.trim(), activity, errorCode: null,
      createdAt: new Date().toISOString(),
    });
    try {
      if (threadId === null) {
        const started = await startAssistantThread(projectId, question);
        if (!started.ok) throw new AssistantUserError(started.message);
        threadId = started.data.id;
        justStarted.current = threadId;
        onActiveThreadChange(threadId);
        void threads.mutate();
      }
      const response = await fetch(`/api/assistant/threads/${threadId}/messages`, {
        method: "POST", credentials: "same-origin", signal: controller.signal,
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ content: question, screen, ...(retryOf ? { retryOf } : {}) }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
        throw new AssistantUserError(payload?.error?.message ?? "L’assistant n’a pas pu répondre. Réessayez.", payload?.error?.code);
      }
      await readAssistantStream(response, (event) => {
        if (event.type === "started") {
          setMessages((current) => current.map((message) => message.id === pendingId ? event.question : message));
        } else if (event.type === "text") {
          written += event.delta;
          setDraft({ text: written, activity, running: null });
        } else if (event.type === "tool_started") {
          running.set(event.callId, { name: event.name, activity: event.activity });
          setDraft({ text: written, activity, running: event.activity });
        } else if (event.type === "tool_finished") {
          const tool = running.get(event.callId);
          if (tool) activity = [...activity, { ...tool, ok: event.ok }];
          setDraft({ text: written, activity, running: null });
        } else if (event.type === "done") {
          finished = true;
          // Not saved: keep on screen what was written rather than losing it with the draft.
          const shown = event.message ?? (written.trim() || activity.length > 0 ? local(event.error ? "failed" : "complete") : null);
          if (shown) setMessages((current) => [...current, shown]);
          if (event.error) setFailure({ ...event.error, retryable: true });
          setAnnouncement(event.error ? event.error.message : "Réponse terminée.");
        }
      });
      if (!finished) throw new AssistantUserError("La connexion a été coupée avant la fin de la réponse. Réessayez.");
    } catch (error) {
      if (controller.signal.aborted) {
        // Stopped by the member: the server saves what was written; show the same thing here.
        if (written.trim() || activity.length > 0) setMessages((current) => [...current, local("interrupted")]);
        setAnnouncement("Réponse interrompue.");
      } else {
        const message = error instanceof AssistantUserError ? error.message : CONNECTION_FAILED;
        const code = error instanceof AssistantUserError ? error.code : "AI_FAILED";
        // The connection dropped mid-answer: keep on screen what the member was reading.
        if (!finished && (written.trim() || activity.length > 0)) setMessages((current) => [...current, local("failed")]);
        // Another question was asked in this conversation elsewhere: show it as it is now before any new retry.
        const stale = code === "ASSISTANT_RETRY_STALE";
        if (stale && threadId !== null) {
          const reloaded = await loadAssistantThread(threadId).catch(() => null);
          if (reloaded?.ok) setMessages(reloaded.data.messages);
        }
        setFailure({ code, message, retryable: !stale });
        setAnnouncement(message);
      }
    } finally {
      request.current = null;
      setDraft(null);
      void threads.mutate();
    }
  }, [activeThreadId, loading, onActiveThreadChange, projectId, screen, threads]);

  const lastQuestion = [...messages].reverse().find((message) => message.role === "user") ?? null;
  const lastMessage = messages[messages.length - 1];
  const canRetry = !sending && !loading && lastQuestion !== null && (failure
    ? failure.retryable
    : lastMessage?.role === "user" || lastMessage?.status === "failed" || lastMessage?.status === "interrupted");

  function retry() {
    if (!lastQuestion) return;
    if (lastQuestion.id.startsWith(PENDING)) {
      // The question never reached the server: ask it again as a new one, shown once.
      setMessages((current) => current.filter((message) => message.id !== lastQuestion.id));
      void send(lastQuestion.content);
    } else {
      void send(lastQuestion.content, lastQuestion.id);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (sending || loading || !input.trim()) return;
    const question = input;
    setInput("");
    void send(question);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  }
  async function deleteThread() {
    if (!activeThreadId) return;
    if (!confirmingDelete) { setConfirmingDelete(true); return; }
    const removed = await removeAssistantThread(activeThreadId).catch(() => ({ ok: false as const, message: CONNECTION_FAILED }));
    setConfirmingDelete(false);
    if (!removed.ok) { setFailure({ code: "DELETE_FAILED", message: removed.message, retryable: false }); return; }
    onActiveThreadChange(null);
    void threads.mutate();
  }

  const threadList = threads.data?.ok ? threads.data.data : [];
  const empty = messages.length === 0 && !sending && !loading && !failure;

  return (
    <aside
      id="assistant-panel"
      aria-label="Assistant de chiffrage"
      className="fixed bottom-0 right-0 top-[60px] z-40 flex w-full flex-col border-l border-border bg-surface shadow-xl lg:w-[420px]"
      onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) onClose(); }}
      data-testid="assistant-panel"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <NativeSelect
          size="sm"
          aria-label="Conversation"
          value={activeThreadId ?? NEW_THREAD}
          disabled={sending}
          onChange={(event) => onActiveThreadChange(event.target.value === NEW_THREAD ? null : event.target.value)}
          data-testid="assistant-thread-select"
        >
          <option value={NEW_THREAD}>Nouvelle conversation</option>
          {threadList.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}
        </NativeSelect>
        <IconButton
          label="Nouvelle conversation" icon={<Plus aria-hidden="true" className="size-4" />}
          disabled={sending || activeThreadId === null} onClick={() => onActiveThreadChange(null)}
          data-testid="assistant-new-thread"
        />
        <IconButton
          label={confirmingDelete ? "Confirmer la suppression de la conversation" : "Supprimer la conversation"}
          icon={<Trash2 aria-hidden="true" className="size-4" />} variant={confirmingDelete ? "danger" : "ghost"}
          disabled={sending || activeThreadId === null} onClick={() => void deleteThread()}
          onBlur={() => setConfirmingDelete(false)} data-testid="assistant-delete-thread"
        />
        <IconButton
          label="Fermer l’assistant" icon={<X aria-hidden="true" className="size-4" />} onClick={onClose}
          data-testid="assistant-close"
        />
      </header>

      {/* Announced once per answer: the streamed text itself would be read word by word. */}
      <p className="sr-only" role="status">{announcement}</p>
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {loading ? <div className="flex justify-center py-6"><Spinner /></div> : null}
        {empty ? (
          <div className="space-y-3" data-testid="assistant-empty">
            <p className="text-sm text-foreground-secondary">
              Posez une question sur ce {screen.screen === "takeoff_review" ? "métré" : "devis"}. L’assistant lit vos données et ne modifie rien.
            </p>
            <ul className="space-y-1.5">
              {SUGGESTIONS[screen.screen].map((suggestion) => (
                <li key={suggestion}>
                  <Button type="button" variant="outline" size="sm" className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                    onClick={() => void send(suggestion)}>
                    {suggestion}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {messages.map((message) => message.role === "user" ? (
          <div key={message.id} className="flex justify-end" data-testid="assistant-message-user">
            <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-surface-subtle px-3 py-2 text-sm text-foreground">
              {message.content}
            </p>
          </div>
        ) : (
          <div key={message.id} className="space-y-2" data-testid="assistant-message-assistant" data-status={message.status}>
            <ActivityList activity={message.activity} />
            {message.content ? <AnswerText text={message.content} streaming={false} /> : null}
            {message.status === "interrupted" ? <p className="text-xs text-muted-foreground">Réponse interrompue.</p> : null}
            {message.status === "failed" && !failure ? <p className="text-xs text-muted-foreground">Cette réponse n’a pas abouti.</p> : null}
          </div>
        ))}
        {draft ? (
          <div className="space-y-2" data-testid="assistant-draft">
            <ActivityList activity={draft.activity} running={draft.running} />
            {draft.text ? <AnswerText text={draft.text} streaming />
              : draft.running ? null : <Spinner aria-label="L’assistant réfléchit" />}
          </div>
        ) : null}
        {failure ? (
          <Alert variant="danger" data-testid="assistant-error">
            <AlertDescription>
              {failure.message}
              {PROFILE_CODES.has(failure.code) ? (
                <> <Link href="/dashboard/profile" className="font-medium underline underline-offset-2">Ouvrir Mon profil</Link></>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {canRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={retry} data-testid="assistant-retry">
            Réessayer
          </Button>
        ) : null}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-border bg-surface p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown}
            aria-label="Votre question" placeholder="Votre question sur ce chiffrage" rows={2} maxLength={4000} autoFocus
            className="max-h-40 min-h-12 resize-none py-2 text-sm" data-testid="assistant-input"
          />
          {sending ? (
            <IconButton
              label="Arrêter la réponse" icon={<Square aria-hidden="true" className="size-4" />} variant="secondary" size="icon"
              onClick={() => request.current?.abort()} data-testid="assistant-stop"
            />
          ) : (
            <IconButton
              type="submit" label="Envoyer" icon={<ArrowUp aria-hidden="true" className="size-4" />} variant="primary" size="icon"
              disabled={!input.trim() || loading} data-testid="assistant-send"
            />
          )}
        </div>
      </form>
    </aside>
  );
}
