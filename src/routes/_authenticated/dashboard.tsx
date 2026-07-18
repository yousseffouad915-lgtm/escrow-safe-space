import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPlaceholder,
});

function DashboardPlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">{t("nav.dashboard")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Phase 2 will render your Client and Freelancer dashboards here.
      </p>
    </div>
  );
}
