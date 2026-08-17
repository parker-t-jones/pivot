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
      flag_events: {
        Row: {
          delivered_at: string | null
          event_type: string
          fired_at: string
          game_id: string
          id: string
          priority_score: number
          reasons: Json
          triggering_play_id: string | null
          user_action: string | null
          user_id: string
        }
        Insert: {
          delivered_at?: string | null
          event_type: string
          fired_at: string
          game_id: string
          id?: string
          priority_score: number
          reasons: Json
          triggering_play_id?: string | null
          user_action?: string | null
          user_id: string
        }
        Update: {
          delivered_at?: string | null
          event_type?: string
          fired_at?: string
          game_id?: string
          id?: string
          priority_score?: number
          reasons?: Json
          triggering_play_id?: string | null
          user_action?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flag_events_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flag_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      game_broadcasts: {
        Row: {
          deep_link_url: string
          game_id: string
          id: string
          requires_subscription: boolean
          service: string
        }
        Insert: {
          deep_link_url: string
          game_id: string
          id?: string
          requires_subscription: boolean
          service: string
        }
        Update: {
          deep_link_url?: string
          game_id?: string
          id?: string
          requires_subscription?: boolean
          service?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_broadcasts_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          away_team_id: string
          home_team_id: string
          id: string
          scheduled_start: string
          season_year: number
          season_type: string
          sportradar_id: string | null
          status: string
          venue: string | null
          week: number
        }
        Insert: {
          away_team_id: string
          home_team_id: string
          id?: string
          scheduled_start: string
          season_year: number
          season_type: string
          sportradar_id?: string | null
          status: string
          venue?: string | null
          week: number
        }
        Update: {
          away_team_id?: string
          home_team_id?: string
          id?: string
          scheduled_start?: string
          season_year?: number
          season_type?: string
          sportradar_id?: string | null
          status?: string
          venue?: string | null
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "games_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          created_at: string
          external_league_id: string | null
          external_owner_id: string | null
          external_roster_id: string | null
          fallback_roster: Json | null
          id: string
          last_synced_at: string | null
          lineup_source: string | null
          name: string
          platform: string
          season_year: number
          sport: string
          user_id: string
        }
        Insert: {
          created_at?: string
          external_league_id?: string | null
          external_owner_id?: string | null
          external_roster_id?: string | null
          fallback_roster?: Json | null
          id?: string
          last_synced_at?: string | null
          lineup_source?: string | null
          name: string
          platform: string
          season_year: number
          sport?: string
          user_id: string
        }
        Update: {
          created_at?: string
          external_league_id?: string | null
          external_owner_id?: string | null
          external_roster_id?: string | null
          fallback_roster?: Json | null
          id?: string
          last_synced_at?: string | null
          lineup_source?: string | null
          name?: string
          platform?: string
          season_year?: number
          sport?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leagues_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lineup_slots: {
        Row: {
          created_at: string
          id: string
          is_star: boolean
          league_id: string
          player_id: string
          position_in_lineup: string
          slot_type: string
          week: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_star?: boolean
          league_id: string
          player_id: string
          position_in_lineup: string
          slot_type: string
          week: number
        }
        Update: {
          created_at?: string
          id?: string
          is_star?: boolean
          league_id?: string
          player_id?: string
          position_in_lineup?: string
          slot_type?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "lineup_slots_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineup_slots_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          active: boolean
          first_name: string
          id: string
          jersey_number: number | null
          last_name: string
          position: string
          sleeper_id: string | null
          sportradar_id: string | null
          team_id: string
        }
        Insert: {
          active?: boolean
          first_name: string
          id?: string
          jersey_number?: number | null
          last_name: string
          position: string
          sleeper_id?: string | null
          sportradar_id?: string | null
          team_id: string
        }
        Update: {
          active?: boolean
          first_name?: string
          id?: string
          jersey_number?: number | null
          last_name?: string
          position?: string
          sleeper_id?: string | null
          sportradar_id?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          abbreviation: string
          city: string
          conference: string
          division: string
          id: string
          name: string
          primary_color: string
          secondary_color: string
          sportradar_id: string | null
        }
        Insert: {
          abbreviation: string
          city: string
          conference: string
          division: string
          id?: string
          name: string
          primary_color: string
          secondary_color: string
          sportradar_id?: string | null
        }
        Update: {
          abbreviation?: string
          city?: string
          conference?: string
          division?: string
          id?: string
          name?: string
          primary_color?: string
          secondary_color?: string
          sportradar_id?: string | null
        }
        Relationships: []
      }
      user_app_presence: {
        Row: {
          detected_at: string
          has_subscription: boolean
          id: string
          service: string
          user_id: string
        }
        Insert: {
          detected_at?: string
          has_subscription: boolean
          id?: string
          service: string
          user_id: string
        }
        Update: {
          detected_at?: string
          has_subscription?: boolean
          id?: string
          service?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_app_presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          expo_push_token: string | null
          id: string
          preferences: Json
          subscription_tier: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          expo_push_token?: string | null
          id: string
          preferences?: Json
          subscription_tier?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          expo_push_token?: string | null
          id?: string
          preferences?: Json
          subscription_tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      viewing_sessions: {
        Row: {
          device_info: Json
          last_updated_at: string
          primary_game_id: string | null
          primary_priority_score: number | null
          primary_source: string | null
          started_at: string
          thumbnail_game_ids: string[]
          user_id: string
        }
        Insert: {
          device_info?: Json
          last_updated_at?: string
          primary_game_id?: string | null
          primary_priority_score?: number | null
          primary_source?: string | null
          started_at?: string
          thumbnail_game_ids?: string[]
          user_id: string
        }
        Update: {
          device_info?: Json
          last_updated_at?: string
          primary_game_id?: string | null
          primary_priority_score?: number | null
          primary_source?: string | null
          started_at?: string
          thumbnail_game_ids?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "viewing_sessions_primary_game_id_fkey"
            columns: ["primary_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "viewing_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_valid_flag_event_type: { Args: { t: string }; Returns: boolean }
      is_valid_flag_user_action: { Args: { a: string }; Returns: boolean }
      is_valid_league_platform: { Args: { p: string }; Returns: boolean }
      is_valid_slot_type: { Args: { s: string }; Returns: boolean }
      is_valid_streaming_service: { Args: { s: string }; Returns: boolean }
      is_valid_viewing_session_source: { Args: { s: string }; Returns: boolean }
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

