import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "./dashboard";

export const Route = createFileRoute("/_authenticated/freelancer-dashboard")({
  ssr: false,
  component: () => <DashboardShell view="freelancer" />,
});
