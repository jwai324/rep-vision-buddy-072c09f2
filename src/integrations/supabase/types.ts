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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_error_log: {
        Row: {
          created_at: string
          error_message: string | null
          error_type: string
          id: string
          request_size_tokens: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          error_type: string
          id?: string
          request_size_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          error_type?: string
          id?: string
          request_size_tokens?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      body_measurements: {
        Row: {
          created_at: string
          date: string
          id: string
          user_id: string
          weight_kg: number
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          user_id: string
          weight_kg: number
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          user_id?: string
          weight_kg?: number
        }
        Relationships: []
      }
      custom_exercises: {
        Row: {
          created_at: string
          difficulty: string
          equipment: string
          exercise_type: string
          id: string
          is_recovery: boolean
          measurement_type: string | null
          movement_pattern: string
          name: string
          primary_body_part: string
          secondary_muscles: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          difficulty?: string
          equipment?: string
          exercise_type?: string
          id?: string
          is_recovery?: boolean
          measurement_type?: string | null
          movement_pattern?: string
          name: string
          primary_body_part?: string
          secondary_muscles?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          difficulty?: string
          equipment?: string
          exercise_type?: string
          id?: string
          is_recovery?: boolean
          measurement_type?: string | null
          movement_pattern?: string
          name?: string
          primary_body_part?: string
          secondary_muscles?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      future_workouts: {
        Row: {
          completed: boolean | null
          created_at: string
          date: string
          id: string
          label: string
          program_id: string
          recovery_activities: Json | null
          template_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean | null
          created_at?: string
          date: string
          id?: string
          label: string
          program_id: string
          recovery_activities?: Json | null
          template_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean | null
          created_at?: string
          date?: string
          id?: string
          label?: string
          program_id?: string
          recovery_activities?: Json | null
          template_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      iap_purchases: {
        Row: {
          created_at: string
          granted_micros: number
          id: string
          original_transaction_id: string | null
          platform: string
          product_id: string
          raw: Json | null
          status: string
          transaction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_micros?: number
          id?: string
          original_transaction_id?: string | null
          platform: string
          product_id: string
          raw?: Json | null
          status?: string
          transaction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_micros?: number
          id?: string
          original_transaction_id?: string | null
          platform?: string
          product_id?: string
          raw?: Json | null
          status?: string
          transaction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          age: number | null
          avatar_url: string | null
          coach_notes: string | null
          created_at: string
          display_name: string | null
          equipment: string[]
          experience_level: string | null
          goal: string | null
          height_cm: number | null
          hybrid_goals: string[]
          id: string
          injuries: string[]
          sex: string | null
          subscription_tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          age?: number | null
          avatar_url?: string | null
          coach_notes?: string | null
          created_at?: string
          display_name?: string | null
          equipment?: string[]
          experience_level?: string | null
          goal?: string | null
          height_cm?: number | null
          hybrid_goals?: string[]
          id?: string
          injuries?: string[]
          sex?: string | null
          subscription_tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          age?: number | null
          avatar_url?: string | null
          coach_notes?: string | null
          created_at?: string
          display_name?: string | null
          equipment?: string[]
          experience_level?: string | null
          goal?: string | null
          height_cm?: number | null
          hybrid_goals?: string[]
          id?: string
          injuries?: string[]
          sex?: string | null
          subscription_tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      token_ledger: {
        Row: {
          balance_after_micros: number
          created_at: string
          delta_micros: number
          id: string
          reason: string
          reference: string | null
          user_id: string
        }
        Insert: {
          balance_after_micros: number
          created_at?: string
          delta_micros: number
          id?: string
          reason: string
          reference?: string | null
          user_id: string
        }
        Update: {
          balance_after_micros?: number
          created_at?: string
          delta_micros?: number
          id?: string
          reason?: string
          reference?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_ai_usage: {
        Row: {
          created_at: string
          date: string
          id: string
          message_count: number
          total_cache_creation_tokens: number
          total_cache_read_tokens: number
          total_cost_micros: number
          total_input_tokens: number
          total_output_tokens: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          message_count?: number
          total_cache_creation_tokens?: number
          total_cache_read_tokens?: number
          total_cost_micros?: number
          total_input_tokens?: number
          total_output_tokens?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          message_count?: number
          total_cache_creation_tokens?: number
          total_cache_read_tokens?: number
          total_cost_micros?: number
          total_input_tokens?: number
          total_output_tokens?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          active_program_id: string | null
          created_at: string
          custom_locations: Json
          default_drop_sets_enabled: boolean
          default_rest_seconds: number
          hide_timers: boolean
          id: string
          sticky_notes: Json
          streak_mode: string
          streak_weekly_target: number
          tutorial_completed: boolean
          updated_at: string
          user_id: string
          weight_unit: string
        }
        Insert: {
          active_program_id?: string | null
          created_at?: string
          custom_locations?: Json
          default_drop_sets_enabled?: boolean
          default_rest_seconds?: number
          hide_timers?: boolean
          id?: string
          sticky_notes?: Json
          streak_mode?: string
          streak_weekly_target?: number
          tutorial_completed?: boolean
          updated_at?: string
          user_id: string
          weight_unit?: string
        }
        Update: {
          active_program_id?: string | null
          created_at?: string
          custom_locations?: Json
          default_drop_sets_enabled?: boolean
          default_rest_seconds?: number
          hide_timers?: boolean
          id?: string
          sticky_notes?: Json
          streak_mode?: string
          streak_weekly_target?: number
          tutorial_completed?: boolean
          updated_at?: string
          user_id?: string
          weight_unit?: string
        }
        Relationships: []
      }
      user_token_balance: {
        Row: {
          created_at: string
          free_period: string
          free_used_micros: number
          id: string
          lifetime_purchased_micros: number
          lifetime_spent_micros: number
          paid_balance_micros: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          free_period?: string
          free_used_micros?: number
          id?: string
          lifetime_purchased_micros?: number
          lifetime_spent_micros?: number
          paid_balance_micros?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          free_period?: string
          free_used_micros?: number
          id?: string
          lifetime_purchased_micros?: number
          lifetime_spent_micros?: number
          paid_balance_micros?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workout_programs: {
        Row: {
          created_at: string
          days: Json
          duration_weeks: number | null
          id: string
          name: string
          schedule: Json | null
          start_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          days?: Json
          duration_weeks?: number | null
          id?: string
          name: string
          schedule?: Json | null
          start_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          days?: Json
          duration_weeks?: number | null
          id?: string
          name?: string
          schedule?: Json | null
          start_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workout_sessions: {
        Row: {
          average_rpe: number | null
          created_at: string
          date: string
          duration: number
          exercises: Json
          id: string
          is_rest_day: boolean | null
          location: string | null
          note: string | null
          recovery_activities: Json | null
          started_at: string | null
          total_reps: number
          total_sets: number
          total_volume: number
          updated_at: string
          user_id: string
        }
        Insert: {
          average_rpe?: number | null
          created_at?: string
          date: string
          duration?: number
          exercises?: Json
          id?: string
          is_rest_day?: boolean | null
          location?: string | null
          note?: string | null
          recovery_activities?: Json | null
          started_at?: string | null
          total_reps?: number
          total_sets?: number
          total_volume?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          average_rpe?: number | null
          created_at?: string
          date?: string
          duration?: number
          exercises?: Json
          id?: string
          is_rest_day?: boolean | null
          location?: string | null
          note?: string | null
          recovery_activities?: Json | null
          started_at?: string | null
          total_reps?: number
          total_sets?: number
          total_volume?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workout_templates: {
        Row: {
          created_at: string
          exercises: Json
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          exercises?: Json
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          exercises?: Json
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      ai_usage_daily_summary: {
        Row: {
          cost_usd: number | null
          date: string | null
          total_cache_creation_tokens: number | null
          total_cache_read_tokens: number | null
          total_calls: number | null
          total_input_tokens: number | null
          total_output_tokens: number | null
          total_users: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      consume_tokens: {
        Args: {
          p_cost_micros: number
          p_reason: string
          p_reference: string
          p_user_id: string
        }
        Returns: {
          free_used_micros: number
          new_balance_micros: number
          paid_balance_micros: number
        }[]
      }
      grant_tokens: {
        Args: {
          p_micros: number
          p_reason: string
          p_reference: string
          p_user_id: string
        }
        Returns: {
          new_balance_micros: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
