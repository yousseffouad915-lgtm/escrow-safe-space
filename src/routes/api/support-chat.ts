import { createFileRoute } from "@tanstack/react-router";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

// Scam / legitimacy triggers — EN + AR
const ESCALATION_RE =
  /\b(scam|fraud|legit|legitimacy|stolen|steal|cheat|rip[\s-]?off|fake)\b|نصب|احتيال|موثوق|مشبوه|سرقة/i;

const SYSTEM_PROMPT = `You are TrustLance Support, a concise assistant for a freelance marketplace with escrow protection.
Answer briefly (2-4 sentences). Cover: how escrow works (funds locked until client approval, 3-day auto-release, 5% platform fee), KYC identity verification (ID + selfie, admin review), dispute resolution, and how to use the client/freelancer dashboards.
NEVER mention any support email address, even if asked. Never say "contact support at X". If a user is worried about scams or legitimacy, respond calmly and reassure them — the app itself will surface the support escalation card.
Keep responses friendly and professional. If asked something outside TrustLance, politely redirect.`;

export const Route = createFileRoute("/api/support-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { messages?: UIMessage[] };
        const messages = body.messages ?? [];
        if (!Array.isArray(messages) || messages.length === 0) {
          return new Response("messages required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("AI not configured", { status: 500 });

        // Escalation detection on latest user message
        const last = [...messages].reverse().find((m) => m.role === "user");
        const lastText =
          last?.parts?.map((p) => (p.type === "text" ? p.text : "")).join(" ") ?? "";
        const shouldEscalate = ESCALATION_RE.test(lastText);

        const gateway = createLovableAiGatewayProvider(key);
        const modelMessages = await convertToModelMessages(messages);

        const result = streamText({
          model: gateway("openai/gpt-5.5"),
          system: SYSTEM_PROMPT,
          messages: modelMessages,
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          messageMetadata: () => (shouldEscalate ? { escalate: true } : undefined),
        });
      },
    },
  },
});
