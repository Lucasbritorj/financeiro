// Tipos do schema Supabase (espelham supabase/migrations).
// Regenerar com: npx supabase gen types typescript --project-id <id>
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TabelaLeitura<T> = { Row: T; Insert: never; Update: never; Relationships: [] };
export type Database = {
  public: {
    Tables: {
      preferencias_reserva: TabelaLeitura<{user_id:string;dados:Json;updated_at:string}>;
      contas_bancarias: TabelaLeitura<{id:string;user_id:string;nome:string;saldo_inicial:number;data_inicial:string;fechado_ate:string|null;saldo_fechado:number|null;created_at:string;pluggy_account_id:string|null;pluggy_item_id:string|null}>;
      movimentos_conta: TabelaLeitura<{id:string;user_id:string;conta_id:string;data:string;valor:number;descricao:string;transacao_id:string|null;transferencia_id:string|null;created_at:string}>;
      linhas_extrato_conta: TabelaLeitura<{id:string;user_id:string;conta_id:string;data:string;valor:number;descricao:string;movimento_id:string|null;ignorada:boolean;ambigua:boolean;origem:string}>;
      orcamentos_mensais: TabelaLeitura<{id:string;user_id:string;categoria_id:string;mes:string;limite:number|null;updated_at:string}>;
      planos_parcelamento: TabelaLeitura<{id:string;user_id:string;cartao_id:string;descricao:string;competencia_base:string;parcela_base:number;parcelas_total:number;valor_previsto:number;created_at:string}>;
      cobrancas_importadas: TabelaLeitura<{id:string;user_id:string;lote_id:string;cartao_id:string;competencia:string;transacao_id:string;plano_id:string|null;parcela_numero:number|null;assinatura_id:string|null;data:string;descricao:string;valor:number;fingerprint:string;id_externo:string|null}>;
      lotes_fatura: TabelaLeitura<{id:string;user_id:string;cartao_id:string;competencia:string;arquivo_sha256:string|null;conteudo_hash:string;origem:string;resultado:Json;created_at:string;desfeita_em:string|null}>;
      cartoes_credito: {
        Row: {
          id: string;
          user_id: string;
          nome: string;
          limite_total: number;
          dia_fechamento: number;
          dia_vencimento: number;
          created_at: string;
          updated_at: string;
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
          updated_at?: string;
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
          updated_at?: string;
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
          updated_at: string;
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
          updated_at?: string;
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
          updated_at?: string;
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
          observacao: string | null;
          chave_receita: string | null;
          hash_receita: string | null;
          id: string;
          user_id: string;
          descricao: string;
          valor_total: number;
          tipo: string;
          forma_pagamento: string;
          cartao_id: string | null;
          categoria_id: string | null;
          data_compra: string;
          data_vencimento: string | null;
          num_parcelas: number;
          id_externo: string | null;
          fingerprint: string | null;
          source: string | null;
          natureza: "CONSUMO" | "LIQUIDACAO_FATURA";
          fatura_liquidada_id: string | null;
          created_at: string;
          updated_at: string;
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
          categoria_id?: string | null;
          data_compra: string;
          data_vencimento?: string | null;
          num_parcelas?: number;
          id_externo?: string | null;
          fingerprint?: string | null;
          source?: string | null;
          natureza?: "CONSUMO" | "LIQUIDACAO_FATURA";
          fatura_liquidada_id?: string | null;
          created_at?: string;
          updated_at?: string;
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
          categoria_id?: string | null;
          data_compra?: string;
          data_vencimento?: string | null;
          num_parcelas?: number;
          id_externo?: string | null;
          fingerprint?: string | null;
          source?: string | null;
          natureza?: "CONSUMO" | "LIQUIDACAO_FATURA";
          fatura_liquidada_id?: string | null;
          created_at?: string;
          updated_at?: string;
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
          {
            foreignKeyName: "transacoes_origem_categoria_id_fkey";
            columns: ["categoria_id"];
            isOneToOne: false;
            referencedRelation: "categorias";
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
          data_pagamento: string | null;
          created_at: string;
          updated_at: string;
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
          data_pagamento?: string | null;
          created_at?: string;
          updated_at?: string;
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
          data_pagamento?: string | null;
          created_at?: string;
          updated_at?: string;
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
      categorias: {
        Row: {
          id: string;
          user_id: string;
          nome: string;
          cor: string | null;
          icone: string | null;
          tipo: string;
          categoria_pai: string | null;
          orcamento_mensal: number | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          nome: string;
          cor?: string | null;
          icone?: string | null;
          tipo?: string;
          categoria_pai?: string | null;
          orcamento_mensal?: number | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          nome?: string;
          cor?: string | null;
          icone?: string | null;
          tipo?: string;
          categoria_pai?: string | null;
          orcamento_mensal?: number | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      regras_categorizacao: {
        Row: {
          id: string;
          user_id: string;
          padrao: string;
          categoria_id: string;
          prioridade: number;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          padrao: string;
          categoria_id: string;
          prioridade?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          padrao?: string;
          categoria_id?: string;
          prioridade?: number;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "regras_categorizacao_categoria_id_fkey";
            columns: ["categoria_id"];
            isOneToOne: false;
            referencedRelation: "categorias";
            referencedColumns: ["id"];
          },
        ];
      };
      importacoes: {
        Row: {
          id: string;
          user_id: string;
          origem: string;
          status: string;
          arquivo_sha256: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          origem?: string;
          status?: string;
          arquivo_sha256?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          origem?: string;
          status?: string;
          arquivo_sha256?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      importacao_linhas: {
        Row: {
          id: string;
          importacao_id: string;
          user_id: string;
          data: string;
          valor: number;
          descricao: string;
          categoria_sugerida: string | null;
          duplicada: boolean;
          ignorar: boolean;
          id_externo: string | null;
          fingerprint: string | null;
          classificacao: "NOVO" | "DUPLICADO" | "AMBIGUO";
          natureza_detectada: "CONSUMO" | "LIQUIDACAO_FATURA";
          fatura_liquidada_id: string | null;
          liquidacao_sugerida: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          importacao_id: string;
          user_id: string;
          data: string;
          valor: number;
          descricao: string;
          categoria_sugerida?: string | null;
          duplicada?: boolean;
          ignorar?: boolean;
          id_externo?: string | null;
          fingerprint?: string | null;
          classificacao?: "NOVO" | "DUPLICADO" | "AMBIGUO";
          natureza_detectada?: "CONSUMO" | "LIQUIDACAO_FATURA";
          fatura_liquidada_id?: string | null;
          liquidacao_sugerida?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          importacao_id?: string;
          user_id?: string;
          data?: string;
          valor?: number;
          descricao?: string;
          categoria_sugerida?: string | null;
          duplicada?: boolean;
          ignorar?: boolean;
          id_externo?: string | null;
          fingerprint?: string | null;
          classificacao?: "NOVO" | "DUPLICADO" | "AMBIGUO";
          natureza_detectada?: "CONSUMO" | "LIQUIDACAO_FATURA";
          fatura_liquidada_id?: string | null;
          liquidacao_sugerida?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "importacao_linhas_importacao_id_fkey";
            columns: ["importacao_id"];
            isOneToOne: false;
            referencedRelation: "importacoes";
            referencedColumns: ["id"];
          },
        ];
      };
      recorrencias: {
        Row: {
          id: string;
          user_id: string;
          descricao: string;
          valor: number;
          tipo: string;
          forma_pagamento: string | null;
          categoria_id: string | null;
          dia_do_mes: number;
          proxima_data: string;
          ativa: boolean;
          finalidade: string;
          periodicidade: string | null;
          cartao_id: string | null;
          cancelada_em: string | null;
          status: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          descricao: string;
          valor: number;
          tipo: string;
          forma_pagamento: string | null;
          categoria_id?: string | null;
          dia_do_mes: number;
          proxima_data: string;
          ativa?: boolean;
          finalidade?: string;
          periodicidade?: string | null;
          cartao_id?: string | null;
          cancelada_em?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          descricao?: string;
          valor?: number;
          forma_pagamento?: string | null;
          categoria_id?: string | null;
          dia_do_mes?: number;
          proxima_data?: string;
          ativa?: boolean;
          finalidade?: string;
          periodicidade?: string | null;
          cartao_id?: string | null;
          cancelada_em?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "recorrencias_categoria_id_fkey";
            columns: ["categoria_id"];
            isOneToOne: false;
            referencedRelation: "categorias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recorrencias_cartao_id_fkey";
            columns: ["cartao_id"];
            isOneToOne: false;
            referencedRelation: "cartoes_credito";
            referencedColumns: ["id"];
          },
        ];
      };
      cofrinhos: {
        Row: {
          id: string;
          user_id: string;
          nome: string;
          icone: string | null;
          cor: string | null;
          valor_alvo: number;
          data_alvo: string | null;
          horizonte: string;
          saldo_atual: number;
          arquivado: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          nome: string;
          icone?: string | null;
          cor?: string | null;
          valor_alvo: number;
          data_alvo?: string | null;
          horizonte: string;
          saldo_atual?: number;
          arquivado?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          nome?: string;
          icone?: string | null;
          cor?: string | null;
          valor_alvo?: number;
          data_alvo?: string | null;
          horizonte?: string;
          saldo_atual?: number;
          arquivado?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      movimentacoes_cofrinho: {
        Row: {
          id: string;
          user_id: string;
          cofrinho_id: string;
          valor: number;
          tipo: string;
          data: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          cofrinho_id: string;
          valor: number;
          tipo: string;
          data?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          cofrinho_id?: string;
          valor?: number;
          tipo?: string;
          data?: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "movimentacoes_cofrinho_cofrinho_id_fkey";
            columns: ["cofrinho_id"];
            isOneToOne: false;
            referencedRelation: "cofrinhos";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      vw_historico_importacoes: {Row:{id:string;lote_id:string;user_id:string;tipo:'FATURA'|'EXTRATO';origem:string;competencia:string|null;cartao_id:string|null;created_at:string;desfeita_em:string|null;quantidade:number|null};Relationships:[]};
      vw_parcelas_planejamento: {Row:{id:string;user_id:string;cartao_id:string;competencia:string;valor:number};Relationships:[]};
      vw_cobrancas_assinaturas: {Row:{id:string;user_id:string;cartao_id:string;competencia:string;valor:number;assinatura_id:string;data:string};Relationships:[]};
      vw_movimentos_competencia: {Row:{id:string;user_id:string;descricao:string;valor_total:number;tipo:string;data_compra:string;natureza:'CONSUMO'|'LIQUIDACAO_FATURA';categorias:Json|null};Relationships:[]};
      vw_previsoes_parcelamento: {Row:{id:string;user_id:string;plano_id:string;cartao_id:string;descricao:string;numero:number;competencia:string;valor:number};Relationships:[]};
      vw_faturas_consolidadas: {
        Row: {
          id: string;
          user_id: string;
          cartao_id: string;
          competencia: string;
          ano_referencia: number;
          mes_referencia: number;
          status: string;
          data_vencimento: string;
          valor_total_fatura: number;
        };
        Relationships: [];
      };
      vw_carteira: {
        Row: {
          entradas: number;
          saidas_avista: number;
          faturas_pagas: number;
          saldo_caixa: number;
          boletos_pagos: number;
        };
        Relationships: [];
      };
      vw_contas_a_pagar: {
        Row: {
          tipo: string;
          origem_id: string;
          transacao_id: string | null;
          descricao: string;
          competencia: string;
          data_vencimento: string;
          status: string;
          valor: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      consultar_eventos_caixa:{Args:{p_hoje:string};Returns:Json};
      consultar_previa_regra:{Args:{p_transacao_id:string;p_categoria_id:string;p_padrao:string;p_prioridade:number};Returns:Json};
      salvar_regra_pessoal:{Args:{p_chave:string;p_transacao_id:string;p_categoria_id:string;p_padrao:string;p_prioridade:number;p_versao:string};Returns:Json};
      criar_receitas_previstas:{Args:{p_chave:string;p_descricao:string;p_forma:string;p_inicio:string;p_partes:Json;p_categoria_id:string|null};Returns:Json};
      consultar_receitas_previstas:{Args:{p_mes:string};Returns:Json};
      confirmar_receitas_previstas:{Args:{p_chave:string;p_ids:string[];p_data:string;p_valor:number;p_observacao:string|null};Returns:Json};
      marcar_receita_nao_recebida:{Args:{p_id:string;p_pular:boolean;p_motivo:string|null};Returns:Json};
      desfazer_receita_prevista:{Args:{p_transacao_id:string};Returns:Json};
      registrar_receita:{Args:{p_chave:string;p_descricao:string;p_valor:number;p_forma:string;p_data:string;p_observacao:string|null;p_categoria_id:string|null};Returns:Json};
      salvar_preferencias_reserva:{Args:{p_dados:Json};Returns:Json};
      vincular_conta_pluggy:{Args:{p_conta_id:string;p_account_id:string;p_item_id:string};Returns:Json};
      vincular_conta_pluggy_servidor:{Args:{p_user_id:string;p_conta_id:string;p_account_id:string;p_item_id:string};Returns:Json};
      criar_conta_bancaria:{Args:{p_nome:string;p_saldo_inicial:number;p_data_inicial:string};Returns:Json};
      transferir_entre_contas:{Args:{p_origem:string;p_destino:string;p_valor:number;p_data:string;p_chave:string};Returns:Json};
      importar_extrato_conta:{Args:{p_conta_id:string;p_origem:string;p_linhas:Json};Returns:Json};
      conciliar_linha_conta:{Args:{p_linha_id:string;p_acao:string;p_transacao_id?:string|null;p_movimento_id?:string|null;p_categoria_id?:string|null;p_fatura_id?:string|null};Returns:Json};
      desfazer_conciliacao_conta:{Args:{p_linha_id:string};Returns:Json};
      fechar_conciliacao_conta:{Args:{p_conta_id:string;p_ate:string;p_saldo_informado:number};Returns:Json};
      reabrir_conciliacao_conta:{Args:{p_conta_id:string;p_motivo:string};Returns:Json};
      consultar_conta_bancaria:{Args:{p_conta_id:string;p_de:string;p_ate:string};Returns:Json};
      salvar_orcamento_mensal: {Args:{p_categoria_id:string;p_mes:string;p_limite:number|null};Returns:Json};
      consultar_orcamentos_mensais: {Args:{p_mes:string};Returns:Json};
      consultar_reversao_importacao: {Args:{p_tipo:string;p_id:string};Returns:Json};
      desfazer_importacao: {Args:{p_tipo:string;p_id:string;p_token:string};Returns:Json};
      confirmar_fatura_importada: {Args:{p_chave:string;p_sha:string|null;p_cartao_id:string;p_competencia:string;p_origem:string;p_linhas:Json;p_total?:number|null;p_conferido?:boolean};Returns:Json};
      editar_previsao_parcelamento: {Args:{p_plano_id:string;p_valor:number};Returns:Json};
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
      processar_pagamento_fatura: {
        Args: {
          p_fatura_id: string;
          p_data_pagamento?: string;
        };
        Returns: Json;
      };
      criar_boleto: {
        Args: {
          p_descricao: string;
          p_valor: number;
          p_data_vencimento: string;
          p_data_competencia?: string | null;
          p_categoria_id?: string | null;
        };
        Returns: Json;
      };
      pagar_boleto: {
        Args: {
          p_transacao_id: string;
          p_data_pagamento?: string;
        };
        Returns: Json;
      };
      editar_boleto: {
        Args: {
          p_transacao_id: string;
          p_descricao?: string | null;
          p_valor?: number | null;
          p_data_vencimento?: string | null;
          p_data_competencia?: string | null;
          p_categoria_id?: string | null;
          p_alterar_categoria?: boolean;
        };
        Returns: Json;
      };
      estornar_pagamento_fatura: {
        Args: { p_fatura_id: string };
        Returns: Json;
      };
      estornar_boleto: {
        Args: { p_transacao_id: string };
        Returns: Json;
      };
      duplicar_boleto: {
        Args: {
          p_transacao_id: string;
          p_meses?: number;
        };
        Returns: Json;
      };
      criar_cartao: {
        Args: {
          p_nome: string;
          p_limite_total: number;
          p_dia_fechamento: number;
          p_dia_vencimento: number;
        };
        Returns: Json;
      };
      excluir_transacao: {
        Args: { p_transacao_id: string };
        Returns: Json;
      };
      excluir_cartao: {
        Args: { p_cartao_id: string };
        Returns: Json;
      };
      editar_cartao: {
        Args: { p_cartao_id: string; p_nome: string; p_limite_total: number; p_dia_fechamento: number; p_dia_vencimento: number };
        Returns: Json;
      };
      editar_cofrinho: {
        Args: { p_cofrinho_id: string; p_nome: string; p_valor_alvo: number; p_horizonte: string; p_data_alvo: string | null };
        Returns: Json;
      };
      editar_recorrencia: {
        Args: { p_recorrencia_id: string; p_descricao: string; p_valor: number; p_tipo: string; p_forma_pagamento: string; p_dia_do_mes: number; p_categoria_id: string | null };
        Returns: Json;
      };
      editar_transacao: {
        Args: {
          p_transacao_id: string;
          p_descricao?: string | null;
          p_valor_total?: number | null;
          p_data_compra?: string | null;
        };
        Returns: Json;
      };
      substituir_transacao: {
        Args: {
          p_transacao_id: string;
          p_descricao: string;
          p_valor_total: number;
          p_tipo: string;
          p_forma_pagamento: string;
          p_cartao_id?: string | null;
          p_data_compra?: string | null;
          p_num_parcelas?: number;
          p_categoria_id?: string | null;
        };
        Returns: Json;
      };
      criar_categoria: {
        Args: {
          p_nome: string;
          p_cor?: string | null;
          p_icone?: string | null;
          p_tipo?: string;
          p_categoria_pai?: string | null;
          p_orcamento_mensal?: number | null;
        };
        Returns: Json;
      };
      editar_categoria: {
        Args: {
          p_categoria_id: string;
          p_nome?: string | null;
          p_cor?: string | null;
          p_icone?: string | null;
          p_orcamento_mensal?: number | null;
          p_limpar_orcamento?: boolean;
        };
        Returns: Json;
      };
      excluir_categoria: {
        Args: { p_categoria_id: string };
        Returns: Json;
      };
      criar_regra_categorizacao: {
        Args: {
          p_padrao: string;
          p_categoria_id: string;
          p_prioridade?: number;
        };
        Returns: Json;
      };
      excluir_regra_categorizacao: {
        Args: { p_regra_id: string };
        Returns: Json;
      };
      definir_categoria_transacao: {
        Args: {
          p_transacao_id: string;
          p_categoria_id: string | null;
          p_criar_regra?: boolean;
          p_padrao?: string | null;
        };
        Returns: Json;
      };
      seed_categorias_padrao: {
        Args: Record<string, never>;
        Returns: Json;
      };
      criar_importacao: {
        Args: { p_origem: string; p_linhas: Json; p_arquivo_sha256?: string | null };
        Returns: Json;
      };
      atualizar_linha_importacao: {
        Args: {
          p_linha_id: string;
          p_ignorar?: boolean | null;
          p_categoria_id?: string | null;
          p_limpar_categoria?: boolean;
        };
        Returns: Json;
      };
      confirmar_importacao: {
        Args: { p_importacao_id: string };
        Returns: Json;
      };
      descartar_importacao: {
        Args: { p_importacao_id: string };
        Returns: Json;
      };
      criar_recorrencia: {
        Args: {
          p_descricao: string;
          p_valor: number;
          p_tipo: string;
          p_forma_pagamento: string;
          p_dia_do_mes: number;
          p_categoria_id?: string | null;
          p_iniciar_em?: string | null;
        };
        Returns: Json;
      };
      criar_assinatura: {
        Args: {
          p_nome: string;
          p_valor: number;
          p_periodicidade: string;
          p_proxima_cobranca: string;
          p_categoria_id?: string | null;
          p_cartao_id?: string | null;
        };
        Returns: Json;
      };
      editar_assinatura: {
        Args: {
          p_assinatura_id: string;
          p_nome: string;
          p_valor: number;
          p_periodicidade: string;
          p_proxima_cobranca: string;
          p_categoria_id?: string | null;
          p_cartao_id?: string | null;
        };
        Returns: Json;
      };
      alterar_status_assinatura: {
        Args: { p_assinatura_id: string; p_status: string };
        Returns: Json;
      };
      alternar_recorrencia: {
        Args: { p_recorrencia_id: string; p_ativa: boolean };
        Returns: Json;
      };
      excluir_recorrencia: {
        Args: { p_recorrencia_id: string };
        Returns: Json;
      };
      aplicar_recorrencias: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      criar_cofrinho: {
        Args: {
          p_nome: string;
          p_valor_alvo: number;
          p_horizonte: string;
          p_data_alvo?: string | null;
          p_icone?: string | null;
          p_cor?: string | null;
        };
        Returns: Json;
      };
      aportar_cofrinho: {
        Args: { p_cofrinho_id: string; p_valor: number; p_data?: string | null };
        Returns: Json;
      };
      resgatar_cofrinho: {
        Args: { p_cofrinho_id: string; p_valor: number; p_data?: string | null };
        Returns: Json;
      };
      arquivar_cofrinho: {
        Args: { p_cofrinho_id: string; p_arquivado?: boolean };
        Returns: Json;
      };
      excluir_cofrinho: {
        Args: { p_cofrinho_id: string; p_resgatar_saldo?: boolean };
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
export type Categoria = Database["public"]["Tables"]["categorias"]["Row"];
export type RegraCategorizacao = Database["public"]["Tables"]["regras_categorizacao"]["Row"];
export type Importacao = Database["public"]["Tables"]["importacoes"]["Row"];
export type ImportacaoLinha = Database["public"]["Tables"]["importacao_linhas"]["Row"];
export type Cofrinho = Database["public"]["Tables"]["cofrinhos"]["Row"];
export type Recorrencia = Database["public"]["Tables"]["recorrencias"]["Row"];
export type MovimentacaoCofrinhoRow = Database["public"]["Tables"]["movimentacoes_cofrinho"]["Row"];
