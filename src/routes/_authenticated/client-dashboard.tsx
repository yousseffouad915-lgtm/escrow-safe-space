import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "./dashboard";

export const Route = createFileRoute("/_authenticated/client-dashboard")({
  ssr: false,
  component: () => <DashboardShell view="client" />,
});
