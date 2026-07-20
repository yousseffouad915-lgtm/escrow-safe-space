import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "./dashboard";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  component: () => <DashboardShell view="admin" />,
});
