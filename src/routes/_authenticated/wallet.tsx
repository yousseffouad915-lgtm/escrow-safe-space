import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Wallet as WalletIcon } from "lucide-react";

import {
  getMyWallet,
  listMyLedger,
  listMyWithdrawals,
  requestWithdrawal,
} from "@/lib/trustlaunch.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TopUpCard } from "./dashboard";

const fmt = (cents: number | null | undefined) =>
  `$${((cents ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type LedgerRow = {
  id: string;
  delta_cents: number;
  kind: string;
  memo: string | null;
  created_at: string;
};
type WithdrawalRow = {
  id: string;
  amount_cents: number;
  method: string;
  destination: string;
  status: string;
  created_at: string;
};

export const Route = createFileRoute("/_authenticated/wallet")({
  ssr: false,
  component: WalletPage,
  head: () => ({
    meta: [
      { title: "My Wallet — TrustLance" },
      {
        name: "description",
        content: "View your TrustLance balance, top up, withdraw funds and track every transaction.",
      },
      { property: "og:title", content: "My Wallet — TrustLance" },
      {
        property: "og:description",
        content: "Balance, top-ups, withdrawals and full transaction history on TrustLance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function WalletPage() {
  const { t } = useTranslation();
  const walletFn = useServerFn(getMyWallet);
  const walletQ = useQuery({ queryKey: ["wallet"], queryFn: () => walletFn() });
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <WalletIcon className="h-5 w-5 text-primary" />
            {t("wallet.title")}
          </h1>
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowLeft className="me-1 h-4 w-4" />
              {t("wallet.back")}
            </Link>
          </Button>
        </div>

        <Card>
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">{t("wallet.available")}</div>
              <div className="text-2xl font-semibold">{fmt(walletQ.data?.available_cents)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("wallet.locked")}</div>
              <div className="text-2xl font-semibold">{fmt(walletQ.data?.locked_cents)}</div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="topup">
          <TabsList>
            <TabsTrigger value="topup">{t("wallet.topup")}</TabsTrigger>
            <TabsTrigger value="withdraw">{t("wallet.withdraw")}</TabsTrigger>
            <TabsTrigger value="ledger">{t("wallet.ledger")}</TabsTrigger>
          </TabsList>

          <TabsContent value="topup" className="mt-4">
            <TopUpCard />
          </TabsContent>

          <TabsContent value="withdraw" className="mt-4 space-y-4">
            <Button onClick={() => setWithdrawOpen(true)}>
              <ArrowUpRight className="me-1 h-4 w-4" />
              {t("wallet.withdraw")}
            </Button>
            <WithdrawalHistory />
            <WithdrawDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} />
          </TabsContent>

          <TabsContent value="ledger" className="mt-4">
            <LedgerList />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function LedgerList() {
  const { t } = useTranslation();
  const fn = useServerFn(listMyLedger);
  const q = useQuery({ queryKey: ["ledger"], queryFn: () => fn() });
  const rows = (q.data ?? []) as LedgerRow[];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t("wallet.ledger")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && <p className="text-xs text-muted-foreground">{t("wallet.noTx")}</p>}
        {rows.map((r) => {
          const inflow = r.delta_cents >= 0;
          return (
            <div key={r.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
              <div className="flex items-center gap-2">
                {inflow ? (
                  <ArrowDownLeft className="h-4 w-4 text-primary" />
                ) : (
                  <ArrowUpRight className="h-4 w-4 text-destructive" />
                )}
                <div>
                  <div className="font-medium">{t(`wallet.kind_${r.kind}`, r.kind)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()} {r.memo ? `· ${r.memo}` : ""}
                  </div>
                </div>
              </div>
              <div className="text-end">
                <div className={`font-semibold ${inflow ? "text-primary" : "text-destructive"}`}>
                  {inflow ? "+" : "−"}
                  {fmt(Math.abs(r.delta_cents))}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {inflow ? t("wallet.in") : t("wallet.out")}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function WithdrawalHistory() {
  const { t } = useTranslation();
  const fn = useServerFn(listMyWithdrawals);
  const q = useQuery({ queryKey: ["myWithdrawals"], queryFn: () => fn() });
  const rows = (q.data ?? []) as WithdrawalRow[];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t("wallet.history")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("wallet.noWithdrawals")}</p>
        )}
        {rows.map((w) => (
          <div key={w.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
            <div>
              <div className="font-medium">
                {fmt(w.amount_cents)} · {t(`wallet.${w.method}`, w.method)}
              </div>
              <div className="text-[10px] text-muted-foreground">{w.destination}</div>
            </div>
            <Badge
              variant={
                w.status === "paid" ? "default" : w.status === "rejected" ? "destructive" : "secondary"
              }
            >
              {t(`wallet.${w.status}`, w.status)}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function WithdrawDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fn = useServerFn(requestWithdrawal);
  const [method, setMethod] = useState<"vodafone_cash" | "instapay" | "bank">("vodafone_cash");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      fn({
        data: {
          method,
          destination,
          amountCents: Math.round(parseFloat(amount) * 100),
        },
      }),
    onSuccess: () => {
      toast.success(t("wallet.requested"));
      setDestination("");
      setAmount("");
      onOpenChange(false);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(t(`errors.${e.message}`, e.message)),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => (!mut.isPending ? onOpenChange(v) : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("wallet.withdrawTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("wallet.method")}</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["vodafone_cash", "instapay", "bank"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`rounded-md border p-2 text-xs ${method === m ? "border-primary bg-primary/10" : "hover:bg-accent"}`}
                >
                  {t(`wallet.${m}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("wallet.destination")}</Label>
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("wallet.amount")}</Label>
            <Input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || destination.length < 3 || !amount}
          >
            {t("wallet.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
