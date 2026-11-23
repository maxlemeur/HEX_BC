"use client";

import { useState } from "react";

import { AiAnalysisPreferencesCard } from "@/components/ai/AiAnalysisPreferencesCard";
import { ApiKeyAccessEntry } from "@/components/ai/ApiKeyAccessEntry";
import { ChatGptConnectionCard, type ChatGptAnalysisOptions } from "@/components/ai/ChatGptConnectionCard";
import { PageSection } from "@/components/layout/page-section";
import type { ApiKeyAccessState } from "@/lib/ai/access/contracts";

/**
 * « Accès IA » in Mon profil: the two ways to pay for analyses, each with its state. The subscription stays the
 * default; a member’s API key can be selected for photo analysis and the takeoff lab.
 */
export function AiAccessCard() {
  const [keyState, setKeyState] = useState<ApiKeyAccessState | null>(null);
  const [chatgpt, setChatGpt] = useState<ChatGptAnalysisOptions | null>(null);
  return (
    <PageSection title="Accès IA">
      <div className="divide-y divide-border-subtle">
        {keyState || chatgpt ? (
          <div className="pb-5">
            <AiAnalysisPreferencesCard keyState={keyState} chatgpt={chatgpt} onKeyStateChange={setKeyState} onChatGptChange={setChatGpt} />
          </div>
        ) : null}
        <div className="pb-5">
          <ChatGptConnectionCard onOptionsChange={setChatGpt} selectedModel={chatgpt?.preferences?.model} />
        </div>
        <div className="pt-5">
          <ApiKeyAccessEntry state={keyState} onStateChange={setKeyState} />
        </div>
      </div>
    </PageSection>
  );
}
