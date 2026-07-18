import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Shield, Lock, MessageCircle, Globe } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TrustLaunch — Secure freelance marketplace with escrow" },
      { name: "description", content: "Escrow-backed contracts, KYC identity verification, and dispute protection for freelancers and clients." },
      { property: "og:title", content: "TrustLaunch — Escrow-secured freelance work" },
      { property: "og:description", content: "Post projects, submit proposals, and get paid safely. Funds locked in escrow until you approve." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t } = useTranslation();
  const { lang, setLang } = useLanguage();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold">{t("app.name")}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            <Globe className="me-1 h-4 w-4" />
            {lang === "ar" ? "EN" : "عربي"}
          </Button>
          <Link to="/auth">
            <Button size="sm">{t("nav.signIn")}</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border bg-secondary px-3 py-1 text-xs">
          <Lock className="h-3 w-3" />
          {t("escrow.fundsSecured")} · {t("escrow.fee")}
        </div>
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">{t("app.name")}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">{t("app.tagline")}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/auth">
            <Button size="lg">{t("auth.signUp")}</Button>
          </Link>
          <Link to="/auth">
            <Button size="lg" variant="outline">
              {t("auth.signIn")}
            </Button>
          </Link>
        </div>

        <div className="mx-auto mt-16 grid max-w-3xl grid-cols-1 gap-6 text-start sm:grid-cols-3">
          <Feature icon={<Lock className="h-5 w-5" />} title="Escrow-locked funds" desc="Client payment is locked until you approve delivery. 3-day auto-release protects freelancers." />
          <Feature icon={<Shield className="h-5 w-5" />} title="Verified identity" desc="Mandatory KYC for both parties keeps the platform safe from bad actors." />
          <Feature icon={<MessageCircle className="h-5 w-5" />} title="AI support 24/7" desc="Ask anything about your contract, escrow, or dispute — instant answers." />
        </div>
      </main>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
      <h3 className="mt-3 font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}
