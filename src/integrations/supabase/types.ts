export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_config: {
        Row: {
          id: number
          super_admin_id: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          super_admin_id?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          super_admin_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      contract_deliverables: {
        Row: {
          contract_id: string
          created_at: string
          file_name: string
          file_path: string
          file_size: number
          id: string
          mime_type: string | null
          uploader_id: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number
          id?: string
          mime_type?: string | null
          uploader_id: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number
          id?: string
          mime_type?: string | null
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_deliverables_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          amount_cents: number
          approved_at: string | null
          auto_release_at: string | null
          client_id: string
          created_at: string
          disputed_at: string | null
          fee_bps: number
          freelancer_id: string
          id: string
          project_id: string
          proposal_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          submitted_at: string | null
        }
        Insert: {
          amount_cents: number
          approved_at?: string | null
          auto_release_at?: string | null
          client_id: string
          created_at?: string
          disputed_at?: string | null
          fee_bps?: number
          freelancer_id: string
          id?: string
          project_id: string
          proposal_id: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          submitted_at?: string | null
        }
        Update: {
          amount_cents?: number
          approved_at?: string | null
          auto_release_at?: string | null
          client_id?: string
          created_at?: string
          disputed_at?: string | null
          fee_bps?: number
          freelancer_id?: string
          id?: string
          project_id?: string
          proposal_id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      deposit_requests: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          method: Database["public"]["Enums"]["deposit_method"]
          notes: string | null
          receipt_path: string | null
          reference: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["deposit_status"]
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["deposit_method"]
          notes?: string | null
          receipt_path?: string | null
          reference?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["deposit_status"]
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["deposit_method"]
          notes?: string | null
          receipt_path?: string | null
          reference?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["deposit_status"]
          user_id?: string
        }
        Relationships: []
      }
      escrow_transactions: {
        Row: {
          actor_id: string | null
          amount_cents: number
          contract_id: string
          created_at: string
          fee_cents: number
          id: string
          reason: string | null
          state: Database["public"]["Enums"]["escrow_state"]
        }
        Insert: {
          actor_id?: string | null
          amount_cents: number
          contract_id: string
          created_at?: string
          fee_cents?: number
          id?: string
          reason?: string | null
          state: Database["public"]["Enums"]["escrow_state"]
        }
        Update: {
          actor_id?: string | null
          amount_cents?: number
          contract_id?: string
          created_at?: string
          fee_cents?: number
          id?: string
          reason?: string | null
          state?: Database["public"]["Enums"]["escrow_state"]
        }
        Relationships: [
          {
            foreignKeyName: "escrow_transactions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_submissions: {
        Row: {
          id: string
          id_document_path: string
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          selfie_path: string
          status: Database["public"]["Enums"]["kyc_status"]
          submitted_at: string
          user_id: string
        }
        Insert: {
          id?: string
          id_document_path: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_path: string
          status?: Database["public"]["Enums"]["kyc_status"]
          submitted_at?: string
          user_id: string
        }
        Update: {
          id?: string
          id_document_path?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_path?: string
          status?: Database["public"]["Enums"]["kyc_status"]
          submitted_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          related_id: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          related_id?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          related_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
      }
      platform_wallet: {
        Row: {
          collected_fees_cents: number
          id: number
          updated_at: string
        }
        Insert: {
          collected_fees_cents?: number
          id?: number
          updated_at?: string
        }
        Update: {
          collected_fees_cents?: number
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          budget_cents: number
          client_id: string
          created_at: string
          deadline: string | null
          description: string
          id: string
          status: Database["public"]["Enums"]["project_status"]
          title: string
        }
        Insert: {
          budget_cents: number
          client_id: string
          created_at?: string
          deadline?: string | null
          description: string
          id?: string
          status?: Database["public"]["Enums"]["project_status"]
          title: string
        }
        Update: {
          budget_cents?: number
          client_id?: string
          created_at?: string
          deadline?: string | null
          description?: string
          id?: string
          status?: Database["public"]["Enums"]["project_status"]
          title?: string
        }
        Relationships: []
      }
      proposals: {
        Row: {
          bid_cents: number
          cover_letter: string
          created_at: string
          estimated_days: number
          freelancer_id: string
          id: string
          project_id: string
          status: Database["public"]["Enums"]["proposal_status"]
        }
        Insert: {
          bid_cents: number
          cover_letter: string
          created_at?: string
          estimated_days: number
          freelancer_id: string
          id?: string
          project_id: string
          status?: Database["public"]["Enums"]["proposal_status"]
        }
        Update: {
          bid_cents?: number
          cover_letter?: string
          created_at?: string
          estimated_days?: number
          freelancer_id?: string
          id?: string
          project_id?: string
          status?: Database["public"]["Enums"]["proposal_status"]
        }
        Relationships: [
          {
            foreignKeyName: "proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string | null
          contract_id: string
          created_at: string
          id: string
          rating: number
          reviewee_id: string
          reviewer_id: string
        }
        Insert: {
          comment?: string | null
          contract_id: string
          created_at?: string
          id?: string
          rating: number
          reviewee_id: string
          reviewer_id: string
        }
        Update: {
          comment?: string | null
          contract_id?: string
          created_at?: string
          id?: string
          rating?: number
          reviewee_id?: string
          reviewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_ledger: {
        Row: {
          created_at: string
          delta_cents: number
          id: string
          kind: Database["public"]["Enums"]["ledger_kind"]
          memo: string | null
          related_contract_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          delta_cents: number
          id?: string
          kind: Database["public"]["Enums"]["ledger_kind"]
          memo?: string | null
          related_contract_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          delta_cents?: number
          id?: string
          kind?: Database["public"]["Enums"]["ledger_kind"]
          memo?: string | null
          related_contract_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          available_cents: number
          locked_cents: number
          updated_at: string
          user_id: string
        }
        Insert: {
          available_cents?: number
          locked_cents?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          available_cents?: number
          locked_cents?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _release_contract: {
        Args: { _actor: string; _contract_id: string; _reason: string }
        Returns: {
          amount_cents: number
          approved_at: string | null
          auto_release_at: string | null
          client_id: string
          created_at: string
          disputed_at: string | null
          fee_bps: number
          freelancer_id: string
          id: string
          project_id: string
          proposal_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          submitted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "contracts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accept_proposal: {
        Args: { _proposal_id: string }
        Returns: {
          amount_cents: number
          approved_at: string | null
          auto_release_at: string | null
          client_id: string
          created_at: string
          disputed_at: string | null
          fee_bps: number
          freelancer_id: string
          id: string
          project_id: string
          proposal_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          submitted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "contracts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_resolve_dispute: {
        Args: { _contract_id: string; _reason: string; _release: boolean }
        Returns: {
          amount_cents: number
          approved_at: string | null
          auto_release_at: string | null
          client_id: string
          created_at: string
          disputed_at: string | null
          fee_bps: number
          freelancer_id: string
          id: string
          project_id: string
          proposal_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          submitted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "contracts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_review_deposit: {
        Args: { _approve: boolean; _deposit_id: string; _notes: string }
        Returns: {
          amount_cents: number
          created_at: string
          id: string
          method: Database["public"]["Enums"]["deposit_method"]
          notes: string | null
          receipt_path: string | null
          reference: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["deposit_status"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "deposit_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_review_kyc: {
        Args: { _approve: boolean; _kyc_id: string; _notes: string }
        Returns: {
          id: string
          id_document_path: string
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          selfie_path: string
          status: Database["public"]["Enums"]["kyc_status"]
          submitted_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "kyc_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_work: {
        Args: { _contract_id: string }
        Returns: {
          amount_cents: number
          approved_at: string | null
          auto_release_at: string | null
          client_id: string
          created_at: string
          disputed_at: string | null
          fee_bps: number
          freelancer_id: string
          id: string
          project_id: string
          proposal_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          submitted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "contracts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fund_contract: {
        Args: { _contract_id: string }
        Returns: {
          amount_cents: number
          approved_at: string | null
          auto_release_at: string | null
          client_id: string
          created_at: string
          disputed_at: string | null
          fee_bps: number
          freelancer_id: string
          id: string
          project_id: string
          proposal_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          submitted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "contracts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      open_dispute: {
        Args: { _contract_id: string; _reason: string }
        Returns: {
          amount_cents: number
          approved_at: string | null
          auto_release_at: string | null
          client_id: string
          created_at: string
          disputed_at: string | null
          fee_bps: number
          freelancer_id: string
          id: string
          project_id: string
          proposal_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          submitted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "contracts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_revision: {
        Args: { _contract_id: string; _note: string }
        Returns: undefined
      }
      require_kyc_approved: { Args: { _user_id: string }; Returns: undefined }
      run_auto_releases: { Args: never; Returns: number }
      submit_work: {
        Args: { _contract_id: string }
        Returns: {
          amount_cents: number
          approved_at: string | null
          auto_release_at: string | null
          client_id: string
          created_at: string
          disputed_at: string | null
          fee_bps: number
          freelancer_id: string
          id: string
          project_id: string
          proposal_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          submitted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "contracts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "client" | "freelancer" | "admin"
      contract_status:
        | "pending_funding"
        | "funded_locked"
        | "work_submitted"
        | "approved_released"
        | "disputed"
        | "refunded"
        | "cancelled"
      deposit_method: "vodafone_cash" | "instapay" | "reference" | "card"
      deposit_status: "pending" | "approved" | "rejected"
      escrow_state: "Pending" | "Locked" | "Released" | "Refunded" | "Disputed"
      kyc_status: "pending" | "approved" | "rejected"
      ledger_kind:
        | "deposit"
        | "escrow_lock"
        | "escrow_release"
        | "escrow_refund"
        | "platform_fee"
      notification_type:
        | "new_proposal"
        | "escrow_deposit_confirmed"
        | "revision_requested"
        | "payment_released"
        | "contract_funded"
        | "dispute_opened"
        | "dispute_resolved"
        | "kyc_status_changed"
        | "new_review"
        | "deposit_reviewed"
        | "work_delivered"
      project_status: "open" | "awarded" | "closed" | "cancelled"
      proposal_status: "submitted" | "accepted" | "rejected" | "withdrawn"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["client", "freelancer", "admin"],
      contract_status: [
        "pending_funding",
        "funded_locked",
        "work_submitted",
        "approved_released",
        "disputed",
        "refunded",
        "cancelled",
      ],
      deposit_method: ["vodafone_cash", "instapay", "reference", "card"],
      deposit_status: ["pending", "approved", "rejected"],
      escrow_state: ["Pending", "Locked", "Released", "Refunded", "Disputed"],
      kyc_status: ["pending", "approved", "rejected"],
      ledger_kind: [
        "deposit",
        "escrow_lock",
        "escrow_release",
        "escrow_refund",
        "platform_fee",
      ],
      notification_type: [
        "new_proposal",
        "escrow_deposit_confirmed",
        "revision_requested",
        "payment_released",
        "contract_funded",
        "dispute_opened",
        "dispute_resolved",
        "kyc_status_changed",
        "new_review",
        "deposit_reviewed",
        "work_delivered",
      ],
      project_status: ["open", "awarded", "closed", "cancelled"],
      proposal_status: ["submitted", "accepted", "rejected", "withdrawn"],
    },
  },
} as const
