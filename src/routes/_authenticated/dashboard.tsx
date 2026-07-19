import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Globe, Lock, LogOut, Shield, Bell, Wallet as WalletIcon } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

import {
  getMyRoles,
  setMyRoles,
  getMyKyc,
  submitKyc,
  getMyWallet,
  listMyNotifications,
  markNotificationRead,
  listMyProjects,
  createProject,
  listOpenProjects,
  submitProposal,
  listMyProposals,
  listProjectProposals,
  acceptProposal,
  listMyContracts,
  fundContract,
  submitWork,
  approveWork,
  openDispute,
  requestRevision,
} from "@/lib/trustlaunch.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  component: DashboardPage,
});

const fmt = (cents: number | null | undefined) =>
  `$${((cents ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { lang, setLang } = useLanguage();
  const qc = useQueryClient();

  const rolesFn = useServerFn(getMyRoles);
  const kycFn = useServerFn(getMyKyc);
  const walletFn = useServerFn(getMyWallet);
  const notifFn = useServerFn(listMyNotifications);

  const rolesQ = useQuery({ queryKey: ["roles"], queryFn: () => rolesFn() });
  const kycQ = useQuery({ queryKey: ["kyc"], queryFn: () => kycFn() });
  const walletQ = useQuery({ queryKey: ["wallet"], queryFn: () => walletFn() });
  const notifQ = useQuery({ queryKey: ["notifications"], queryFn: () => notifFn(), refetchInterval: 15_000 });

  const roles = (rolesQ.data ?? []) as string[];
  const appRoles = roles.filter((r) => r === "client" || r === "freelancer");
  const isAdmin = roles.includes("admin");
  const needsOnboarding = rolesQ.isSuccess && appRoles.length === 0;

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  if (rolesQ.isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">…</div>;
  }

  if (needsOnboarding) {
    return <OnboardingWizard onDone={() => qc.invalidateQueries()} />;
  }

  const hasClient = appRoles.includes("client");
  const hasFreelancer = appRoles.includes("freelancer");
  const defaultTab = hasClient ? "client" : "freelancer";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="font-semibold">{t("app.name")}</span>
            {isAdmin && <Badge variant="destructive" className="ms-2">admin</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
              <Globe className="me-1 h-4 w-4" />
              {lang === "ar" ? "EN" : "عربي"}
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="me-1 h-4 w-4" />
              {t("dashboard.signOut")}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <WalletCard wallet={walletQ.data} />
          <KycCard kyc={kycQ.data} onSubmitted={() => qc.invalidateQueries({ queryKey: ["kyc"] })} />
          <NotificationsCard notifications={notifQ.data ?? []} onRead={() => qc.invalidateQueries({ queryKey: ["notifications"] })} />
        </div>

        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList>
            {hasClient && <TabsTrigger value="client">{t("dashboard.clientTab")}</TabsTrigger>}
            {hasFreelancer && <TabsTrigger value="freelancer">{t("dashboard.freelancerTab")}</TabsTrigger>}
          </TabsList>
          {hasClient && (
            <TabsContent value="client" className="mt-4">
              <ClientDashboard kycApproved={kycQ.data?.status === "approved"} />
            </TabsContent>
          )}
          {hasFreelancer && (
            <TabsContent value="freelancer" className="mt-4">
              <FreelancerDashboard kycApproved={kycQ.data?.status === "approved"} />
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}

// ------------ Onboarding wizard with Back ------------
function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0); // 0 role, 1 kyc, 2 done
  const [picked, setPicked] = useState<{ client: boolean; freelancer: boolean }>({ client: false, freelancer: false });
  const [savedRoles, setSavedRoles] = useState(false);
  const rolesFn = useServerFn(setMyRoles);
  const submitKycFn = useServerFn(submitKyc);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveRoles() {
    const list: ("client" | "freelancer")[] = [];
    if (picked.client) list.push("client");
    if (picked.freelancer) list.push("freelancer");
    if (list.length === 0) {
      toast.error("Pick at least one role");
      return;
    }
    setBusy(true);
    try {
      await rolesFn({ data: { roles: list } });
      setSavedRoles(true);
      setStep(1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAndSubmitKyc() {
    if (!idFile || !selfieFile) {
      toast.error("Upload both files");
      return;
    }
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      const base = `${uid}/${Date.now()}`;
      const idPath = `${base}/id.${idFile.name.split(".").pop() || "bin"}`;
      const selfiePath = `${base}/selfie.${selfieFile.name.split(".").pop() || "bin"}`;
      const [u1, u2] = await Promise.all([
        supabase.storage.from("kyc-documents").upload(idPath, idFile, { upsert: true }),
        supabase.storage.from("kyc-documents").upload(selfiePath, selfieFile, { upsert: true }),
      ]);
      if (u1.error) throw u1.error;
      if (u2.error) throw u2.error;
      await submitKycFn({ data: { idDocumentPath: idPath, selfiePath } });
      toast.success("KYC submitted");
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t("onboarding.welcome")}</CardTitle>
          <div className="text-xs text-muted-foreground">{t("onboarding.step", { n: step + 1, total: 3 })}</div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <>
              <div className="text-sm font-medium">{t("onboarding.stepRole")}</div>
              <p className="text-xs text-muted-foreground">{t("onboarding.roleDesc")}</p>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent">
                <Checkbox checked={picked.client} onCheckedChange={(v) => setPicked((p) => ({ ...p, client: !!v }))} />
                <div>
                  <div className="font-medium">{t("onboarding.client")}</div>
                  <div className="text-xs text-muted-foreground">{t("onboarding.clientDesc")}</div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent">
                <Checkbox checked={picked.freelancer} onCheckedChange={(v) => setPicked((p) => ({ ...p, freelancer: !!v }))} />
                <div>
                  <div className="font-medium">{t("onboarding.freelancer")}</div>
                  <div className="text-xs text-muted-foreground">{t("onboarding.freelancerDesc")}</div>
                </div>
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <div className="text-sm font-medium">{t("onboarding.stepKyc")}</div>
              <p className="text-xs text-muted-foreground">{t("onboarding.kycNote")}</p>
              <div className="space-y-2">
                <Label>{t("kyc.idDoc")}</Label>
                <Input type="file" accept="image/*,application/pdf" onChange={(e) => setIdFile(e.target.files?.[0] ?? null)} />
              </div>
              <div className="space-y-2">
                <Label>{t("kyc.selfie")}</Label>
                <Input type="file" accept="image/*" onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)} />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="text-sm font-medium">{t("onboarding.stepDone")}</div>
              <p className="text-xs text-muted-foreground">{t("kyc.statusPending")}. {t("onboarding.kycNote")}</p>
            </>
          )}
        </CardContent>
        <DialogFooter className="flex justify-between gap-2 p-6 pt-0">
          {/* Back button — present on every step after 0 */}
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
            {t("onboarding.back")}
          </Button>
          {step === 0 && (
            <Button onClick={saveRoles} disabled={busy}>
              {t("onboarding.next")}
            </Button>
          )}
          {step === 1 && (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>
                {t("onboarding.skipKyc")}
              </Button>
              <Button onClick={uploadAndSubmitKyc} disabled={busy || !idFile || !selfieFile}>
                {busy ? t("kyc.uploading") : t("kyc.submit")}
              </Button>
            </div>
          )}
          {step === 2 && (
            <Button onClick={onDone} disabled={!savedRoles}>
              {t("onboarding.finish")}
            </Button>
          )}
        </DialogFooter>
      </Card>
    </div>
  );
}

// ------------ Wallet ------------
function WalletCard({ wallet }: { wallet: { available_cents: number; locked_cents: number } | null | undefined }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><WalletIcon className="h-4 w-4" />{t("dashboard.wallet")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("dashboard.available")}</span>
          <span className="font-semibold">{fmt(wallet?.available_cents)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("dashboard.locked")}</span>
          <span className="font-semibold">{fmt(wallet?.locked_cents)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------ KYC ------------
function KycCard({ kyc, onSubmitted }: { kyc: { status: string } | null | undefined; onSubmitted: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const status = kyc?.status ?? "none";
  const label =
    status === "approved" ? t("kyc.statusApproved")
    : status === "pending" ? t("kyc.statusPending")
    : status === "rejected" ? t("kyc.statusRejected")
    : "—";
  const variant: "default" | "secondary" | "destructive" =
    status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm"><Shield className="h-4 w-4" />{t("kyc.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Badge variant={variant}>{label}</Badge>
        {status !== "approved" && (
          <Button size="sm" variant="outline" className="w-full" onClick={() => setOpen(true)}>
            {status === "none" ? t("kyc.submit") : t("kyc.reupload")}
          </Button>
        )}
        <KycDialog open={open} onOpenChange={setOpen} onSubmitted={onSubmitted} />
      </CardContent>
    </Card>
  );
}

function KycDialog({ open, onOpenChange, onSubmitted }: { open: boolean; onOpenChange: (v: boolean) => void; onSubmitted: () => void }) {
  const { t } = useTranslation();
  const [idFile, setIdFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const submitKycFn = useServerFn(submitKyc);

  async function upload() {
    if (!idFile || !selfieFile) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user!.id;
      const base = `${uid}/${Date.now()}`;
      const idPath = `${base}/id.${idFile.name.split(".").pop() || "bin"}`;
      const selfiePath = `${base}/selfie.${selfieFile.name.split(".").pop() || "bin"}`;
      const [u1, u2] = await Promise.all([
        supabase.storage.from("kyc-documents").upload(idPath, idFile, { upsert: true }),
        supabase.storage.from("kyc-documents").upload(selfiePath, selfieFile, { upsert: true }),
      ]);
      if (u1.error) throw u1.error;
      if (u2.error) throw u2.error;
      await submitKycFn({ data: { idDocumentPath: idPath, selfiePath } });
      toast.success("KYC submitted");
      onSubmitted();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("kyc.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("kyc.subtitle")}</p>
          <div className="space-y-1.5">
            <Label>{t("kyc.idDoc")}</Label>
            <Input type="file" accept="image/*,application/pdf" onChange={(e) => setIdFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("kyc.selfie")}</Label>
            <Input type="file" accept="image/*" onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("onboarding.back")}</Button>
          <Button onClick={upload} disabled={busy || !idFile || !selfieFile}>{busy ? t("kyc.uploading") : t("kyc.submit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------ Notifications ------------
type Notif = { id: string; type: string; title: string; body: string | null; read_at: string | null; created_at: string };

function NotificationsCard({ notifications, onRead }: { notifications: Notif[]; onRead: () => void }) {
  const { t } = useTranslation();
  const markFn = useServerFn(markNotificationRead);
  const unread = notifications.filter((n) => !n.read_at).length;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2"><Bell className="h-4 w-4" />{t("dashboard.notifications")}</span>
          {unread > 0 && <Badge>{unread}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-40 space-y-2 overflow-auto p-3 pt-0">
        {notifications.length === 0 && <p className="text-xs text-muted-foreground">{t("dashboard.noNotifications")}</p>}
        {notifications.slice(0, 6).map((n) => (
          <button
            key={n.id}
            onClick={async () => {
              if (!n.read_at) {
                await markFn({ data: { id: n.id } });
                onRead();
              }
            }}
            className={`block w-full rounded-md border p-2 text-start text-xs ${n.read_at ? "opacity-60" : ""}`}
          >
            <div className="font-medium">{n.title}</div>
            {n.body && <div className="text-muted-foreground">{n.body}</div>}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

// ------------ Client dashboard ------------
type Project = { id: string; title: string; description: string; budget_cents: number; status: string; created_at: string };

function ClientDashboard({ kycApproved }: { kycApproved: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(listMyProjects);
  const createFn = useServerFn(createProject);
  const projectsQ = useQuery({ queryKey: ["myProjects"], queryFn: () => listFn() });

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [budget, setBudget] = useState("");

  const createMut = useMutation({
    mutationFn: async () => {
      const cents = Math.round(parseFloat(budget) * 100);
      return createFn({ data: { title, description: desc, budgetCents: cents } });
    },
    onSuccess: () => {
      toast.success("Project posted");
      setTitle(""); setDesc(""); setBudget("");
      qc.invalidateQueries({ queryKey: ["myProjects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-sm">{t("dashboard.createProject")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><Label>{t("dashboard.projectTitle")}</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{t("dashboard.projectDescription")}</Label><Textarea rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{t("dashboard.budget")}</Label><Input type="number" min="1" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !title || desc.length < 10 || !budget}>
            {t("dashboard.post")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">{t("dashboard.myProjects")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(projectsQ.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">{t("dashboard.noProjects")}</p>}
          {(projectsQ.data as Project[] | undefined)?.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <ContractsPanel role="client" kycApproved={kycApproved} />
      </div>
    </div>
  );
}

function ProjectRow({ project }: { project: Project }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const proposalsFn = useServerFn(listProjectProposals);
  const acceptFn = useServerFn(acceptProposal);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["proposals", project.id],
    queryFn: () => proposalsFn({ data: { projectId: project.id } }),
    enabled: open,
  });
  const acceptMut = useMutation({
    mutationFn: (proposalId: string) => acceptFn({ data: { proposalId } }),
    onSuccess: () => {
      toast.success("Proposal accepted — fund escrow from Contracts");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{project.title}</div>
          <div className="text-xs text-muted-foreground">{fmt(project.budget_cents)} · <Badge variant="secondary">{t(`status.${project.status}`, project.status)}</Badge></div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>{t("dashboard.viewProposals")}</Button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          {(q.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">{t("dashboard.noProposals")}</p>}
          {(q.data as Array<{ id: string; bid_cents: number; estimated_days: number; cover_letter: string; status: string }> | undefined)?.map((pr) => (
            <div key={pr.id} className="rounded border p-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium">{fmt(pr.bid_cents)} · {pr.estimated_days}d</div>
                {pr.status === "submitted" && project.status === "open" && (
                  <Button size="sm" onClick={() => acceptMut.mutate(pr.id)} disabled={acceptMut.isPending}>{t("dashboard.accept")}</Button>
                )}
                {pr.status !== "submitted" && <Badge variant="secondary">{pr.status}</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{pr.cover_letter}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------ Freelancer dashboard ------------
function FreelancerDashboard({ kycApproved }: { kycApproved: boolean }) {
  const { t } = useTranslation();
  const openFn = useServerFn(listOpenProjects);
  const propFn = useServerFn(listMyProposals);
  const openQ = useQuery({ queryKey: ["openProjects"], queryFn: () => openFn() });
  const myPropQ = useQuery({ queryKey: ["myProposals"], queryFn: () => propFn() });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-sm">{t("dashboard.browseProjects")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!kycApproved && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
              {t("kyc.required")}
            </div>
          )}
          {(openQ.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">{t("dashboard.noOpenProjects")}</p>}
          {(openQ.data as Project[] | undefined)?.map((p) => (
            <OpenProjectRow key={p.id} project={p} kycApproved={kycApproved} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">{t("dashboard.myProposals")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(myPropQ.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">{t("dashboard.noProposals")}</p>}
          {(myPropQ.data as Array<{ id: string; bid_cents: number; estimated_days: number; status: string; projects: { title: string } | null }> | undefined)?.map((pr) => (
            <div key={pr.id} className="rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium">{pr.projects?.title ?? "—"}</div>
                <Badge variant="secondary">{pr.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">{fmt(pr.bid_cents)} · {pr.estimated_days}d</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <ContractsPanel role="freelancer" kycApproved={kycApproved} />
      </div>
    </div>
  );
}

function OpenProjectRow({ project, kycApproved }: { project: Project; kycApproved: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [bid, setBid] = useState("");
  const [days, setDays] = useState("");
  const [letter, setLetter] = useState("");
  const submitFn = useServerFn(submitProposal);
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => submitFn({ data: { projectId: project.id, coverLetter: letter, bidCents: Math.round(parseFloat(bid) * 100), estimatedDays: parseInt(days, 10) } }),
    onSuccess: () => {
      toast.success("Proposal submitted");
      setOpen(false); setBid(""); setDays(""); setLetter("");
      qc.invalidateQueries({ queryKey: ["myProposals"] });
    },
    onError: (e: Error) => toast.error(e.message === "KYC_REQUIRED" ? t("errors.KYC_REQUIRED") : e.message),
  });

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{project.title}</div>
          <div className="text-xs text-muted-foreground">{fmt(project.budget_cents)}</div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)} disabled={!kycApproved}>
          {t("dashboard.submitProposal")}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground line-clamp-3">{project.description}</p>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">{t("dashboard.bid")}</Label><Input type="number" min="1" step="0.01" value={bid} onChange={(e) => setBid(e.target.value)} /></div>
            <div><Label className="text-xs">{t("dashboard.days")}</Label><Input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} /></div>
          </div>
          <div><Label className="text-xs">{t("dashboard.coverLetter")}</Label><Textarea rows={3} value={letter} onChange={(e) => setLetter(e.target.value)} /></div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("onboarding.back")}</Button>
            <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending || !bid || !days || letter.length < 10}>
              {t("dashboard.submitProposal")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------ Contracts panel (shared client/freelancer views) ------------
type Contract = {
  id: string; client_id: string; freelancer_id: string; amount_cents: number; fee_bps: number;
  status: string; submitted_at: string | null; auto_release_at: string | null;
};

function ContractsPanel({ role, kycApproved }: { role: "client" | "freelancer"; kycApproved: boolean }) {
  const { t } = useTranslation();
  const listFn = useServerFn(listMyContracts);
  const q = useQuery({ queryKey: ["contracts"], queryFn: () => listFn() });
  const contracts = (q.data as Contract[] | undefined) ?? [];

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{t("dashboard.myContracts")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {contracts.length === 0 && <p className="text-xs text-muted-foreground">{t("dashboard.noContracts")}</p>}
        {contracts.map((c) => (
          <ContractRow key={c.id} contract={c} role={role} kycApproved={kycApproved} />
        ))}
      </CardContent>
    </Card>
  );
}

function ContractRow({ contract, role, kycApproved }: { contract: Contract; role: "client" | "freelancer"; kycApproved: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fundFn = useServerFn(fundContract);
  const submitWorkFn = useServerFn(submitWork);
  const approveFn = useServerFn(approveWork);
  const disputeFn = useServerFn(openDispute);
  const revisionFn = useServerFn(requestRevision);
  const [reason, setReason] = useState("");
  const [showDispute, setShowDispute] = useState(false);
  const [showRevision, setShowRevision] = useState(false);

  const invalidate = () => qc.invalidateQueries();

  const call = async <T,>(fn: () => Promise<T>, msg: string) => {
    try { await fn(); toast.success(msg); invalidate(); }
    catch (e) { toast.error(e instanceof Error ? (t(`errors.${e.message}`, e.message)) : "error"); }
  };

  const days = contract.auto_release_at
    ? Math.max(0, Math.ceil((new Date(contract.auto_release_at).getTime() - Date.now()) / 86_400_000))
    : null;

  const fee = Math.round((contract.amount_cents * contract.fee_bps) / 10000);
  const payout = contract.amount_cents - fee;

  const iAmClient = role === "client";
  const iAmFreelancer = role === "freelancer";

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <div className="font-semibold">{fmt(contract.amount_cents)}</div>
          <div className="text-xs text-muted-foreground">
            {t("dashboard.youEarn")}: {fmt(payout)} · <Badge variant="secondary">{t(`status.${contract.status}`, contract.status)}</Badge>
            {iAmFreelancer && contract.status === "funded_locked" && (
              <Badge className="ms-2 bg-emerald-600 text-white"><Lock className="me-1 h-3 w-3" />{t("escrow.fundsSecured")}</Badge>
            )}
          </div>
          {days !== null && contract.status === "work_submitted" && (
            <div className="mt-1 text-xs text-muted-foreground">{t("escrow.autoReleaseIn", { days })}</div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {iAmClient && contract.status === "pending_funding" && (
            <Button size="sm" disabled={!kycApproved} onClick={() => call(() => fundFn({ data: { contractId: contract.id } }), "Funded")}>
              {t("dashboard.fund")}
            </Button>
          )}
          {iAmFreelancer && contract.status === "funded_locked" && (
            <Button size="sm" onClick={() => call(() => submitWorkFn({ data: { contractId: contract.id } }), "Submitted")}>
              {t("dashboard.submit")}
            </Button>
          )}
          {iAmClient && contract.status === "work_submitted" && (
            <>
              <Button size="sm" onClick={() => call(() => approveFn({ data: { contractId: contract.id } }), "Released")}>
                {t("dashboard.approve")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowRevision(true)}>{t("dashboard.revision")}</Button>
              <Button size="sm" variant="destructive" onClick={() => setShowDispute(true)}>{t("dashboard.dispute")}</Button>
            </>
          )}
        </div>
      </div>

      <Dialog open={showDispute} onOpenChange={setShowDispute}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("dashboard.dispute")}</DialogTitle></DialogHeader>
          <Label>{t("dashboard.reason")}</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDispute(false)}>{t("onboarding.back")}</Button>
            <Button variant="destructive" onClick={async () => { await call(() => disputeFn({ data: { contractId: contract.id, reason } }), "Dispute opened"); setShowDispute(false); setReason(""); }} disabled={reason.length < 3}>
              {t("dashboard.dispute")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRevision} onOpenChange={setShowRevision}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("dashboard.revision")}</DialogTitle></DialogHeader>
          <Label>{t("dashboard.note")}</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRevision(false)}>{t("onboarding.back")}</Button>
            <Button onClick={async () => { await call(() => revisionFn({ data: { contractId: contract.id, note: reason } }), "Revision requested"); setShowRevision(false); setReason(""); }} disabled={reason.length < 3}>
              {t("dashboard.revision")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// prevent unused import warnings in strict builds
void useEffect; void useMemo;
