import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SUPPORT_EMAIL = "joo15572ny@gmail.com";

type UIMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  escalate?: boolean;
};

export function SupportChatWidget() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<UIMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const userMsg: UIMsg = { id: crypto.randomUUID(), role: "user", text };
    const nextMsgs = [...msgs, userMsg];
    setMsgs([...nextMsgs, { id: "streaming", role: "assistant", text: "" }]);
    setInput("");
    setBusy(true);

    try {
      // Build UIMessage shape for the AI SDK route
      const uiMessages = nextMsgs.map((m) => ({
        id: m.id,
        role: m.role,
        parts: [{ type: "text", text: m.text }],
      }));

      const res = await fetch("/api/support-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: uiMessages }),
      });
      if (!res.ok || !res.body) throw new Error("Chat failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let escalate = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        // AI SDK v5 UI-message stream: line-delimited JSON events
        for (const line of chunk.split("\n")) {
          if (!line.trim()) continue;
          const raw = line.startsWith("data: ") ? line.slice(6) : line;
          try {
            const evt = JSON.parse(raw);
            if (evt.type === "text-delta" && typeof evt.delta === "string") {
              assistantText += evt.delta;
            } else if (evt.type === "message-metadata" && evt.messageMetadata?.escalate) {
              escalate = true;
            } else if (evt.type === "text" && typeof evt.text === "string") {
              assistantText += evt.text;
            }
          } catch {
            // ignore non-JSON keepalive lines
          }
        }
        setMsgs([
          ...nextMsgs,
          { id: "streaming", role: "assistant", text: assistantText, escalate },
        ]);
      }
      setMsgs([
        ...nextMsgs,
        { id: crypto.randomUUID(), role: "assistant", text: assistantText, escalate },
      ]);
    } catch {
      setMsgs([
        ...nextMsgs,
        { id: crypto.randomUUID(), role: "assistant", text: t("errors.unknown") },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Support"
        className="fixed bottom-4 end-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:opacity-90"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>

      {open && (
        <div className="fixed bottom-20 end-4 z-40 flex h-[520px] w-[360px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b p-3">
            <div className="text-sm font-medium">{t("support.title")}</div>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {msgs.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t("app.tagline")}
              </p>
            )}
            {msgs.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ms-auto max-w-[80%] bg-primary text-primary-foreground"
                    : "me-auto max-w-[85%] bg-secondary"
                }`}
              >
                {m.text || (m.role === "assistant" && busy ? "…" : "")}
                {m.role === "assistant" && m.escalate && (
                  <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                    <div className="font-medium text-destructive">{t("support.escalation")}</div>
                    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-destructive underline">
                      {SUPPORT_EMAIL}
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={send} className="flex gap-2 border-t p-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("support.placeholder")}
              disabled={busy}
            />
            <Button size="icon" type="submit" disabled={busy || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
