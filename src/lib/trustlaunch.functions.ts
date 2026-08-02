import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// -------- KYC --------
export const submitKyc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ idDocumentPath: z.string().min(1), selfiePath: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("kyc_submissions")
      .insert({
        user_id: context.userId,
        id_document_path: data.idDocumentPath,
        selfie_path: data.selfiePath,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getMyKyc = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("kyc_submissions")
      .select("*")
      .eq("user_id", context.userId)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  });

// -------- Projects --------
export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        title: z.string().min(3).max(200),
        description: z.string().min(10).max(5000),
        budgetCents: z.number().int().positive(),
        deadline: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("projects")
      .insert({
        client_id: context.userId,
        title: data.title,
        description: data.description,
        budget_cents: data.budgetCents,
        deadline: data.deadline ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listOpenProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listMyProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("client_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// -------- Proposals --------
export const submitProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        coverLetter: z.string().min(10).max(3000),
        bidCents: z.number().int().positive(),
        estimatedDays: z.number().int().min(1).max(365),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: kyc } = await context.supabase
      .from("kyc_submissions")
      .select("status")
      .eq("user_id", context.userId)
      .eq("status", "approved")
      .maybeSingle();
    if (!kyc) throw new Error("KYC_REQUIRED");

    const { data: row, error } = await context.supabase
      .from("proposals")
      .insert({
        project_id: data.projectId,
        freelancer_id: context.userId,
        cover_letter: data.coverLetter,
        bid_cents: data.bidCents,
        estimated_days: data.estimatedDays,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // notify client
    const { data: proj } = await context.supabase
      .from("projects")
      .select("client_id, title")
      .eq("id", data.projectId)
      .single();
    if (proj) {
      await context.supabase.from("notifications").insert({
        user_id: proj.client_id,
        type: "new_proposal",
        title: "New proposal received",
        body: `A freelancer submitted a proposal on "${proj.title}".`,
        related_id: row.id,
      });
    }
    return row;
  });

export const listProjectProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("proposals")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listMyProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("proposals")
      .select("*, projects(title, status)")
      .eq("freelancer_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// -------- Contracts / Escrow (thin wrappers around RPCs) --------
// Return only { ok: true } — clients refetch contracts/wallets/notifications after mutation.
async function callRpc(
  ctx: { supabase: { rpc: (fn: never, args: never) => { then: (...a: never[]) => unknown } } },
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: true }> {
  const res = (await (ctx.supabase.rpc as unknown as (f: string, a: unknown) => Promise<{ error: { message: string } | null }>)(fn, args));
  if (res.error) {
    const msg = res.error.message.replace(/^.*ERROR:\s*/i, "").trim();
    throw new Error(msg || "unknown");
  }
  return { ok: true };
}

export const acceptProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ proposalId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => callRpc(context, "accept_proposal", { _proposal_id: data.proposalId }));

export const fundContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ contractId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => callRpc(context, "fund_contract", { _contract_id: data.contractId }));

export const submitWork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ contractId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => callRpc(context, "submit_work", { _contract_id: data.contractId }));

export const approveWork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ contractId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => callRpc(context, "approve_work", { _contract_id: data.contractId }));

export const openDispute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ contractId: z.string().uuid(), reason: z.string().min(3).max(1000) }).parse(d),
  )
  .handler(({ data, context }) =>
    callRpc(context, "open_dispute", { _contract_id: data.contractId, _reason: data.reason }),
  );

export const requestRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ contractId: z.string().uuid(), note: z.string().min(3).max(1000) }).parse(d),
  )
  .handler(({ data, context }) =>
    callRpc(context, "request_revision", { _contract_id: data.contractId, _note: data.note }),
  );

export const adminResolveDispute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        contractId: z.string().uuid(),
        release: z.boolean(),
        reason: z.string().min(3).max(1000),
      })
      .parse(d),
  )
  .handler(({ data, context }) =>
    callRpc(context, "admin_resolve_dispute", {
      _contract_id: data.contractId,
      _release: data.release,
      _reason: data.reason,
    }),
  );

export const adminReviewKyc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ kycId: z.string().uuid(), approve: z.boolean(), notes: z.string().max(1000).optional() }).parse(d),
  )
  .handler(({ data, context }) =>
    callRpc(context, "admin_review_kyc", {
      _kyc_id: data.kycId,
      _approve: data.approve,
      _notes: data.notes ?? null,
    }),
  );

export const listMyContracts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("contracts")
      .select("*")
      .or(`client_id.eq.${context.userId},freelancer_id.eq.${context.userId}`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getMyWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("wallets")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    return data;
  });

export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("notifications")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    return { ok: true };
  });

export const getMyRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: roles }, { data: cfg }] = await Promise.all([
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
      context.supabase.from("admin_config").select("super_admin_id").eq("id", 1).maybeSingle(),
    ]);
    const list = (roles ?? []).map((r) => r.role);
    if (cfg?.super_admin_id && cfg.super_admin_id === context.userId) list.push("admin");
    return list;
  });

export const setMyRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ roles: z.array(z.enum(["client", "freelancer"])).min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await context.supabase.from("user_roles").delete().eq("user_id", context.userId).in("role", ["client", "freelancer"]);
    const rows = data.roles.map((role) => ({ user_id: context.userId, role }));
    const { error } = await context.supabase.from("user_roles").insert(rows);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Reviews --------
export const submitReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        contractId: z.string().uuid(),
        revieweeId: z.string().uuid(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("reviews")
      .insert({
        contract_id: data.contractId,
        reviewer_id: context.userId,
        reviewee_id: data.revieweeId,
        rating: data.rating,
        comment: data.comment ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("notifications").insert({
      user_id: data.revieweeId,
      type: "new_review",
      title: "You received a new review",
      body: `${data.rating}★ · ${data.comment ?? ""}`,
      related_id: data.contractId,
    });
    return row;
  });

export const listReviewsForUser = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("reviews")
      .select("id, contract_id, reviewer_id, rating, comment, created_at")
      .eq("reviewee_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listMyReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("reviews")
      .select("id, contract_id, reviewer_id, reviewee_id, rating, comment, created_at")
      .or(`reviewer_id.eq.${context.userId},reviewee_id.eq.${context.userId}`)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listMyReviewableContracts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const uid = context.userId;
    const { data: contracts, error } = await context.supabase
      .from("contracts")
      .select("id, client_id, freelancer_id, amount_cents, status, resolved_at")
      .in("status", ["approved_released", "refunded"])
      .or(`client_id.eq.${uid},freelancer_id.eq.${uid}`);
    if (error) throw new Error(error.message);
    const ids = (contracts ?? []).map((c) => c.id);
    if (ids.length === 0) return [];
    const { data: existing } = await context.supabase
      .from("reviews")
      .select("contract_id")
      .eq("reviewer_id", uid)
      .in("contract_id", ids);
    const done = new Set((existing ?? []).map((r) => r.contract_id));
    return (contracts ?? [])
      .filter((c) => !done.has(c.id))
      .map((c) => ({
        id: c.id,
        amount_cents: c.amount_cents,
        counterpartyId: c.client_id === uid ? c.freelancer_id : c.client_id,
        counterpartyRole: c.client_id === uid ? "freelancer" : "client",
      }));
  });

// -------- Admin queues --------
export const adminListPendingKyc = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("kyc_submissions")
      .select("*")
      .eq("status", "pending")
      .order("submitted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminListDisputedContracts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("contracts")
      .select("*")
      .eq("status", "disputed")
      .order("disputed_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// -------- Deposits (wallet top-up) --------
const depositMethods = ["vodafone_cash", "instapay", "reference", "card"] as const;

export const createDepositRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        method: z.enum(depositMethods),
        amountCents: z.number().int().positive(),
        reference: z.string().max(200).optional(),
        receiptPath: z.string().max(500).optional(),
      })
      .parse(d),
  )
  // Automated verification: the deposit is checked and credited immediately.
  .handler(({ data, context }) =>
    callRpc(context, "create_deposit_auto", {
      _method: data.method,
      _amount_cents: data.amountCents,
      _reference: data.reference ?? null,
      _receipt_path: data.receiptPath ?? null,
    }),
  );

export const listMyDeposits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("deposit_requests")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminListPendingDeposits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("deposit_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminReviewDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        depositId: z.string().uuid(),
        approve: z.boolean(),
        notes: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(({ data, context }) =>
    callRpc(context, "admin_review_deposit", {
      _deposit_id: data.depositId,
      _approve: data.approve,
      _notes: data.notes ?? null,
    }),
  );

export const getReceiptUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: url, error } = await context.supabase.storage
      .from("deposit-receipts")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return url.signedUrl;
  });

// -------- Deliverables (freelancer work upload) --------
export const submitDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        contractId: z.string().uuid(),
        files: z
          .array(
            z.object({
              path: z.string().min(1),
              name: z.string().min(1),
              size: z.number().int().nonnegative(),
              mimeType: z.string().max(200).optional(),
            }),
          )
          .min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = data.files.map((f) => ({
      contract_id: data.contractId,
      uploader_id: context.userId,
      file_name: f.name,
      file_path: f.path,
      file_size: f.size,
      mime_type: f.mimeType ?? null,
    }));
    const { error: insErr } = await context.supabase.from("contract_deliverables").insert(rows);
    if (insErr) throw new Error(insErr.message);

    return callRpc(context, "submit_work", { _contract_id: data.contractId });
  });

export const listContractDeliverables = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ contractId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("contract_deliverables")
      .select("*")
      .eq("contract_id", data.contractId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getDeliverableUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: url, error } = await context.supabase.storage
      .from("deliverables")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return url.signedUrl;
  });

// -------- Automated identity verification --------
export const submitKycAuto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        documentType: z.enum(["national_id", "passport"]),
        frontPath: z.string().min(1),
        backPath: z.string().min(1).nullable().optional(),
        selfiePath: z.string().min(1),
        meta: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(d),
  )
  .handler(({ data, context }) =>
    callRpc(context, "submit_kyc_auto", {
      _document_type: data.documentType,
      _front_path: data.frontPath,
      _back_path: data.backPath ?? null,
      _selfie_path: data.selfiePath,
      _meta: data.meta ?? null,
    }),
  );

// -------- Dispute review tickets (manual, admin only) --------
export const adminListDisputeTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: tickets, error } = await context.supabase
      .from("dispute_tickets")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!tickets || tickets.length === 0) return [];

    const userIds = Array.from(new Set(tickets.flatMap((t) => [t.client_id, t.freelancer_id])));
    const { data: kyc } = await context.supabase
      .from("kyc_submissions")
      .select("user_id, document_type, id_document_path, back_document_path, selfie_path, submitted_at, status")
      .in("user_id", userIds)
      .order("submitted_at", { ascending: false });

    const latest = new Map<string, NonNullable<typeof kyc>[number]>();
    for (const k of kyc ?? []) if (!latest.has(k.user_id)) latest.set(k.user_id, k);

    return tickets.map((t) => ({
      ...t,
      clientKyc: latest.get(t.client_id) ?? null,
      freelancerKyc: latest.get(t.freelancer_id) ?? null,
    }));
  });

// Signed URL for an identity document. Admins can open any document; users only their own.
export const getKycFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ path: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const isOwn = data.path.startsWith(`${context.userId}/`);
    if (!isOwn) {
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isAdmin) throw new Error("FORBIDDEN");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: url, error } = await supabaseAdmin.storage
      .from("kyc-documents")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return url.signedUrl;
  });
