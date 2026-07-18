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
