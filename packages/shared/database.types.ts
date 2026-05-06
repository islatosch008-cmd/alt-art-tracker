export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      affiliate_clicks: {
        Row: {
          affiliate_url: string
          card_id: string | null
          clicked_at: string | null
          id: string
          network: string
          user_id: string | null
        }
        Insert: {
          affiliate_url: string
          card_id?: string | null
          clicked_at?: string | null
          id?: string
          network: string
          user_id?: string | null
        }
        Update: {
          affiliate_url?: string
          card_id?: string | null
          clicked_at?: string | null
          id?: string
          network?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_clicks_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_clicks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      api_request_log: {
        Row: {
          cost_units: number | null
          endpoint: string
          id: number
          requested_at: string | null
          source: string
          status_code: number | null
        }
        Insert: {
          cost_units?: number | null
          endpoint: string
          id?: number
          requested_at?: string | null
          source: string
          status_code?: number | null
        }
        Update: {
          cost_units?: number | null
          endpoint?: string
          id?: number
          requested_at?: string | null
          source?: string
          status_code?: number | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          event_type: string
          id: number
          ip_address: unknown
          metadata: Json | null
          occurred_at: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          event_type: string
          id?: number
          ip_address?: unknown
          metadata?: Json | null
          occurred_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          event_type?: string
          id?: number
          ip_address?: unknown
          metadata?: Json | null
          occurred_at?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          active: boolean | null
          category: string
          id: string
          logo_url: string | null
          name: string
        }
        Insert: {
          active?: boolean | null
          category: string
          id: string
          logo_url?: string | null
          name: string
        }
        Update: {
          active?: boolean | null
          category?: string
          id?: string
          logo_url?: string | null
          name?: string
        }
        Relationships: []
      }
      cards: {
        Row: {
          baseline_30d_price: number | null
          baseline_30d_volume: number | null
          brand_id: string
          card_number: string | null
          category: string
          created_at: string | null
          current_price: number | null
          ebay_avg_price: number | null
          external_ids: Json | null
          heating_up_score: number | null
          id: string
          image_url: string | null
          is_sealed: boolean | null
          last_price_check_at: string | null
          msrp: number | null
          name: string
          popularity_score: number | null
          rarity: string | null
          set_id: string | null
          tcgplayer_market_price: number | null
          updated_at: string | null
        }
        Insert: {
          baseline_30d_price?: number | null
          baseline_30d_volume?: number | null
          brand_id: string
          card_number?: string | null
          category: string
          created_at?: string | null
          current_price?: number | null
          ebay_avg_price?: number | null
          external_ids?: Json | null
          heating_up_score?: number | null
          id?: string
          image_url?: string | null
          is_sealed?: boolean | null
          last_price_check_at?: string | null
          msrp?: number | null
          name: string
          popularity_score?: number | null
          rarity?: string | null
          set_id?: string | null
          tcgplayer_market_price?: number | null
          updated_at?: string | null
        }
        Update: {
          baseline_30d_price?: number | null
          baseline_30d_volume?: number | null
          brand_id?: string
          card_number?: string | null
          category?: string
          created_at?: string | null
          current_price?: number | null
          ebay_avg_price?: number | null
          external_ids?: Json | null
          heating_up_score?: number | null
          id?: string
          image_url?: string | null
          is_sealed?: boolean | null
          last_price_check_at?: string | null
          msrp?: number | null
          name?: string
          popularity_score?: number | null
          rarity?: string | null
          set_id?: string | null
          tcgplayer_market_price?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cards_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          description: string | null
          enabled: boolean | null
          key: string
          rollout_percentage: number | null
          updated_at: string | null
        }
        Insert: {
          description?: string | null
          enabled?: boolean | null
          key: string
          rollout_percentage?: number | null
          updated_at?: string | null
        }
        Update: {
          description?: string | null
          enabled?: boolean | null
          key?: string
          rollout_percentage?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      heating_up_alerts_sent: {
        Row: {
          card_id: string
          id: number
          sent_at: string | null
          user_id: string
        }
        Insert: {
          card_id: string
          id?: number
          sent_at?: string | null
          user_id: string
        }
        Update: {
          card_id?: string
          id?: number
          sent_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "heating_up_alerts_sent_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heating_up_alerts_sent_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_codes: {
        Row: {
          code: string
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          intended_for: string | null
          uses_remaining: number | null
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          intended_for?: string | null
          uses_remaining?: number | null
        }
        Update: {
          code?: string
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          intended_for?: string | null
          uses_remaining?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invite_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_queue: {
        Row: {
          channel: string
          id: string
          payload: Json
          scheduled_for: string | null
          sent_at: string | null
          status: string | null
          type: string
          user_id: string
        }
        Insert: {
          channel: string
          id?: string
          payload: Json
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          type: string
          user_id: string
        }
        Update: {
          channel?: string
          id?: string
          payload?: Json
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      price_history: {
        Row: {
          card_id: string
          condition: string | null
          id: number
          price: number
          recorded_at: string
          source: string
        }
        Insert: {
          card_id: string
          condition?: string | null
          id?: number
          price: number
          recorded_at?: string
          source: string
        }
        Update: {
          card_id?: string
          condition?: string | null
          id?: number
          price?: number
          recorded_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_history_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      price_history_2026_05: {
        Row: {
          card_id: string
          condition: string | null
          id: number
          price: number
          recorded_at: string
          source: string
        }
        Insert: {
          card_id: string
          condition?: string | null
          id?: number
          price: number
          recorded_at?: string
          source: string
        }
        Update: {
          card_id?: string
          condition?: string | null
          id?: number
          price?: number
          recorded_at?: string
          source?: string
        }
        Relationships: []
      }
      price_history_2026_06: {
        Row: {
          card_id: string
          condition: string | null
          id: number
          price: number
          recorded_at: string
          source: string
        }
        Insert: {
          card_id: string
          condition?: string | null
          id?: number
          price: number
          recorded_at?: string
          source: string
        }
        Update: {
          card_id?: string
          condition?: string | null
          id?: number
          price?: number
          recorded_at?: string
          source?: string
        }
        Relationships: []
      }
      price_history_2026_07: {
        Row: {
          card_id: string
          condition: string | null
          id: number
          price: number
          recorded_at: string
          source: string
        }
        Insert: {
          card_id: string
          condition?: string | null
          id?: number
          price: number
          recorded_at?: string
          source: string
        }
        Update: {
          card_id?: string
          condition?: string | null
          id?: number
          price?: number
          recorded_at?: string
          source?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          age_verified: boolean | null
          created_at: string | null
          display_name: string | null
          id: string
          invite_code_used: string | null
          invited_by: string | null
          is_pro: boolean | null
          phone_number: string | null
          phone_verified_at: string | null
          pro_expires_at: string | null
          role: string | null
          username: string | null
        }
        Insert: {
          age_verified?: boolean | null
          created_at?: string | null
          display_name?: string | null
          id: string
          invite_code_used?: string | null
          invited_by?: string | null
          is_pro?: boolean | null
          phone_number?: string | null
          phone_verified_at?: string | null
          pro_expires_at?: string | null
          role?: string | null
          username?: string | null
        }
        Update: {
          age_verified?: boolean | null
          created_at?: string | null
          display_name?: string | null
          id?: string
          invite_code_used?: string | null
          invited_by?: string | null
          is_pro?: boolean | null
          phone_number?: string | null
          phone_verified_at?: string | null
          pro_expires_at?: string | null
          role?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          max_per_window: number
          requests_in_window: number | null
          source: string
          window_started_at: string | null
        }
        Insert: {
          max_per_window: number
          requests_in_window?: number | null
          source: string
          window_started_at?: string | null
        }
        Update: {
          max_per_window?: number
          requests_in_window?: number | null
          source?: string
          window_started_at?: string | null
        }
        Relationships: []
      }
      reddit_mentions: {
        Row: {
          card_id: string | null
          id: number
          mention_count: number
          recorded_at: string | null
          subreddit: string
        }
        Insert: {
          card_id?: string | null
          id?: number
          mention_count: number
          recorded_at?: string | null
          subreddit: string
        }
        Update: {
          card_id?: string | null
          id?: number
          mention_count?: number
          recorded_at?: string | null
          subreddit?: string
        }
        Relationships: [
          {
            foreignKeyName: "reddit_mentions_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      release_alerts_sent: {
        Row: {
          alert_type: string
          id: number
          sent_at: string | null
          set_id: string
          user_id: string
        }
        Insert: {
          alert_type: string
          id?: number
          sent_at?: string | null
          set_id: string
          user_id: string
        }
        Update: {
          alert_type?: string
          id?: number
          sent_at?: string | null
          set_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_alerts_sent_set_id_fkey"
            columns: ["set_id"]
            isOneToOne: false
            referencedRelation: "sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_alerts_sent_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      score_history: {
        Row: {
          calculated_at: string | null
          card_id: string
          components: Json
          heating_up_score: number | null
          id: number
          popularity_score: number | null
        }
        Insert: {
          calculated_at?: string | null
          card_id: string
          components: Json
          heating_up_score?: number | null
          id?: number
          popularity_score?: number | null
        }
        Update: {
          calculated_at?: string | null
          card_id?: string
          components?: Json
          heating_up_score?: number | null
          id?: number
          popularity_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "score_history_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      sets: {
        Row: {
          box_type: string | null
          brand_id: string
          confidence: string | null
          created_at: string | null
          external_ids: Json | null
          id: string
          last_synced_at: string | null
          locked_fields: string[]
          msrp_box: number | null
          msrp_card: number | null
          msrp_pack: number | null
          name: string
          pre_order_opens_at: string | null
          release_date: string | null
          source: string
          source_id: string | null
          sport: string | null
        }
        Insert: {
          box_type?: string | null
          brand_id: string
          confidence?: string | null
          created_at?: string | null
          external_ids?: Json | null
          id?: string
          last_synced_at?: string | null
          locked_fields?: string[]
          msrp_box?: number | null
          msrp_card?: number | null
          msrp_pack?: number | null
          name: string
          pre_order_opens_at?: string | null
          release_date?: string | null
          source?: string
          source_id?: string | null
          sport?: string | null
        }
        Update: {
          box_type?: string | null
          brand_id?: string
          confidence?: string | null
          created_at?: string | null
          external_ids?: Json | null
          id?: string
          last_synced_at?: string | null
          locked_fields?: string[]
          msrp_box?: number | null
          msrp_card?: number | null
          msrp_pack?: number | null
          name?: string
          pre_order_opens_at?: string | null
          release_date?: string | null
          source?: string
          source_id?: string | null
          sport?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      tcgcsv_category_map: {
        Row: {
          brand_id: string
          category_id: number
          category_name: string
          resolved_at: string
        }
        Insert: {
          brand_id: string
          category_id: number
          category_name: string
          resolved_at?: string
        }
        Update: {
          brand_id?: string
          category_id?: number
          category_name?: string
          resolved_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tcgcsv_category_map_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          alert_channels: string[] | null
          alert_frequency: string | null
          brands: string[] | null
          categories: string[] | null
          drop_alerts_enabled: boolean | null
          heating_up_alerts_enabled: boolean | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          release_alert_days: number[] | null
          release_alerts_enabled: boolean | null
          sms_enabled: boolean | null
          timezone: string | null
          trending_alerts_enabled: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          alert_channels?: string[] | null
          alert_frequency?: string | null
          brands?: string[] | null
          categories?: string[] | null
          drop_alerts_enabled?: boolean | null
          heating_up_alerts_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          release_alert_days?: number[] | null
          release_alerts_enabled?: boolean | null
          sms_enabled?: boolean | null
          timezone?: string | null
          trending_alerts_enabled?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          alert_channels?: string[] | null
          alert_frequency?: string | null
          brands?: string[] | null
          categories?: string[] | null
          drop_alerts_enabled?: boolean | null
          heating_up_alerts_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          release_alert_days?: number[] | null
          release_alerts_enabled?: boolean | null
          sms_enabled?: boolean | null
          timezone?: string | null
          trending_alerts_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          created_at: string | null
          device_name: string | null
          id: string
          ip_address: unknown
          last_active_at: string | null
          refresh_token_hash: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          device_name?: string | null
          id?: string
          ip_address?: unknown
          last_active_at?: string | null
          refresh_token_hash?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          device_name?: string | null
          id?: string
          ip_address?: unknown
          last_active_at?: string | null
          refresh_token_hash?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      volume_history: {
        Row: {
          card_id: string
          id: number
          recorded_at: string
          sales_count: number
          source: string
        }
        Insert: {
          card_id: string
          id?: number
          recorded_at?: string
          sales_count: number
          source: string
        }
        Update: {
          card_id?: string
          id?: number
          recorded_at?: string
          sales_count?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "volume_history_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      volume_history_2026_05: {
        Row: {
          card_id: string
          id: number
          recorded_at: string
          sales_count: number
          source: string
        }
        Insert: {
          card_id: string
          id?: number
          recorded_at?: string
          sales_count: number
          source: string
        }
        Update: {
          card_id?: string
          id?: number
          recorded_at?: string
          sales_count?: number
          source?: string
        }
        Relationships: []
      }
      volume_history_2026_06: {
        Row: {
          card_id: string
          id: number
          recorded_at: string
          sales_count: number
          source: string
        }
        Insert: {
          card_id: string
          id?: number
          recorded_at?: string
          sales_count: number
          source: string
        }
        Update: {
          card_id?: string
          id?: number
          recorded_at?: string
          sales_count?: number
          source?: string
        }
        Relationships: []
      }
      volume_history_2026_07: {
        Row: {
          card_id: string
          id: number
          recorded_at: string
          sales_count: number
          source: string
        }
        Insert: {
          card_id: string
          id?: number
          recorded_at?: string
          sales_count: number
          source: string
        }
        Update: {
          card_id?: string
          id?: number
          recorded_at?: string
          sales_count?: number
          source?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      invoke_function: { Args: { body?: Json; fname: string }; Returns: number }
      maintain_monthly_partitions: {
        Args: never
        Returns: {
          parent: string
          partition_name: string
          range_from: string
          range_to: string
        }[]
      }
      recompute_30d_baselines: { Args: never; Returns: number }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

