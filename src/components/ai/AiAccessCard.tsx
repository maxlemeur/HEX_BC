"use client";

import { ApiKeyAccessEntry } from "@/components/ai/ApiKeyAccessEntry";
import { ChatGptConnectionCard } from "@/components/ai/ChatGptConnectionCard";
import { PageSection } from "@/components/layout/page-section";

/**
 * « Accès IA » in Mon profil: the two ways to pay for analyses, each with its state. The subscription stays the
 * default and keeps every command it had; the API key is the member's own, on this Mac, for the takeoff lab only.
 */
export function AiAccessCard() {
  return (
    <PageSection title="Accès IA" description="Abonnement ChatGPT ou clé API : chaque analyse dit laquelle elle utilise.">
      <div className="divide-y divide-border-subtle">
        <div className="pb-5">
          <ChatGptConnectionCard />
        </div>
        <div className="pt-5">
          <ApiKeyAccessEntry />
        </div>
      </div>
    </PageSection>
  );
}
