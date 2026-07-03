// Tipos do schema Supabase (espelham supabase/migrations).
// Regenerar com: npx supabase gen types typescript --project-id <id>
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      cartoes_credito: {
        Row: {
          id: string;
          user_id: string;
          nome: string;
          limite_total: number;
          dia_fechamento: number;
          dia_vencimento: number;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          nome: string;
          limite_total: number;
          dia_fechamento: number;
          dia_vencimento: number;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          nome?: string;
          limite_total?: number;
          dia_fechamento?: number;
          dia_vencimento?: number;
          created_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      faturas: {
        Row: {
          id: string;
          user_id: string;
          cartao_id: string;
          competencia: string;
          data_vencimento: string;
          status: string;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          cartao_id: string;
          competencia: string;
          data_vencimento: string;
          status?: string;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          cartao_id?: string;
          competencia?: string;
          data_vencimento?: string;
          status?: string;
          created_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "faturas_cartao_id_fkey";
            columns: ["cartao_id"];
            isOneToOne: false;
            referencedRelation: "cartoes_credito";
            referencedColumns: ["id"];
          },
        ];
      };
      transacoes_origem: {
        Row: {
          id: string;
          user_id: string;
          descricao: string;
          valor_total: number;
          tipo: string;
          forma_pagamento: string;
          cartao_id: string | null;
          data_compra: string;
          num_parcelas: number;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          descricao: string;
          valor_total: number;
          tipo: string;
          forma_pagamento: string;
          cartao_id?: string | null;
          data_compra: string;
          num_parcelas?: number;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          descricao?: string;
          valor_total?: number;
          tipo?: string;
          forma_pagamento?: string;
          cartao_id?: string | null;
          data_compra?: string;
          num_parcelas?: number;
          created_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "transacoes_origem_cartao_id_fkey";
            columns: ["cartao_id"];
            isOneToOne: false;
            referencedRelation: "cartoes_credito";
            referencedColumns: ["id"];
          },
        ];
      };
      parcelas: {
        Row: {
          id: string;
          user_id: string;
          transacao_id: string;
          fatura_id: string | null;
          numero: number;
          valor: number;
          data_competencia: string;
          status: string;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          transacao_id: string;
          fatura_id?: string | null;
          numero: number;
          valor: number;
          data_competencia: string;
          status?: string;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          transacao_id?: string;
          fatura_id?: string | null;
          numero?: number;
          valor?: number;
          data_competencia?: string;
          status?: string;
          created_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "parcelas_transacao_id_fkey";
            columns: ["transacao_id"];
            isOneToOne: false;
            referencedRelation: "transacoes_origem";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "parcelas_fatura_id_fkey";
            columns: ["fatura_id"];
            isOneToOne: false;
            referencedRelation: "faturas";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      processar_transacao_completa: {
        Args: {
          p_descricao: string;
          p_valor_total: number;
          p_tipo: string;
          p_forma_pagamento: string;
          p_cartao_id?: string | null;
          p_data_compra?: string | null;
          p_num_parcelas?: number;
        };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type CartaoCredito = Database["public"]["Tables"]["cartoes_credito"]["Row"];
export type Fatura = Database["public"]["Tables"]["faturas"]["Row"];
export type TransacaoOrigem = Database["public"]["Tables"]["transacoes_origem"]["Row"];
export type Parcela = Database["public"]["Tables"]["parcelas"]["Row"];
