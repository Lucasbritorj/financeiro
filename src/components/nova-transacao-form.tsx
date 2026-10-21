"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { paraCentavos } from "@/lib/money";
import { mensagemDeErro } from "@/lib/erros";
import { MAX_PARCELAS_UI } from "@/lib/constantes";
import { mensagemPosTransacao } from "@/lib/nova-transacao";
import { hojeSaoPaulo } from "@/lib/data";
import { useToast } from "@/components/feedback";
import { validarReceita } from '@/lib/receita-caixa';

type CartaoOpcao = { id: string; nome: string };
type CategoriaOpcao = { id: string; nome: string; tipo: string };

export default function NovaTransacaoForm({
  cartoes,
  categorias = [],
}: {
  cartoes: CartaoOpcao[];
  categorias?: CategoriaOpcao[];
}) {
  const router = useRouter();
  const notificar = useToast();
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [tipo, setTipo] = useState("DESPESA");
  const [forma, setForma] = useState("CREDITO");
  const [cartaoId, setCartaoId] = useState(cartoes[0]?.id ?? "");
  const [categoriaId, setCategoriaId] = useState("");
  const [dataCompra, setDataCompra] = useState(hojeSaoPaulo);
  const [vencimento, setVencimento] = useState("");
  const [numParcelas, setNumParcelas] = useState("1");
  const [pendente, setPendente] = useState(false);
  const [observacao, setObservacao] = useState('');
  const chaveReceita = useRef<string|null>(null);

  const ehReceita = tipo === 'RECEITA';
  const ehCredito = !ehReceita && forma === "CREDITO";
  const ehBoleto = !ehReceita && forma === "BOLETO";
  // Boleto é sempre DESPESA (conta a pagar). Categoria vazia => trigger de
  // autocategorização (0008) decide pela regra.
  const tipoEfetivo = ehBoleto ? "DESPESA" : tipo;
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipoEfetivo);

  // Trocar para boleto força despesa; trocar de volta preserva a escolha.
  function trocarForma(nova: string) {
    setForma(nova);
    if (nova === "BOLETO") setTipo("DESPESA");
  }

  function trocarTipo(novo:string) {
    setTipo(novo);setCategoriaId('');setNumParcelas('1');setVencimento('');
    if(novo==='RECEITA'&&!['PIX','TRANSFERENCIA','DINHEIRO'].includes(forma))setForma('PIX');
    if(novo==='DESPESA'&&forma==='TRANSFERENCIA')setForma('PIX');
  }

  async function receber(centavos:number) {
    chaveReceita.current??=crypto.randomUUID();
    try {
      validarReceita(forma,centavos,dataCompra,observacao);
      const {error}=await createClient().rpc('registrar_receita',{
        p_chave:chaveReceita.current,p_descricao:descricao.trim(),p_valor:centavos,
        p_forma:forma,p_data:dataCompra,p_observacao:observacao.trim()||null,p_categoria_id:categoriaId||null,
      }).abortSignal(AbortSignal.timeout(15000));
      if(error)throw error;
      notificar('Receita registrada como entrada no caixa.','sucesso');
      chaveReceita.current=null;setDescricao('');setValor('');setObservacao('');setCategoriaId('');router.refresh();
    }catch(error){notificar(mensagemDeErro(error),'erro');}finally{setPendente(false);}
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();

    const centavos = paraCentavos(valor);
    if (!Number.isFinite(centavos)) {
      notificar("Valor inválido.", "erro");
      return;
    }
    if (ehCredito && !cartaoId) {
      notificar("Cadastre e selecione um cartão para lançar no crédito.", "erro");
      return;
    }
    if (ehBoleto && !vencimento) {
      notificar("Informe a data de vencimento do boleto.", "erro");
      return;
    }

    setPendente(true);
    if(ehReceita){await receber(centavos);return;}
    const supabase = createClient();

    // ===== Boleto: conta a pagar com vencimento (RPC dedicada) =====
    if (ehBoleto) {
      const { data, error } = await supabase.rpc("criar_boleto", {
        p_descricao: descricao.trim(),
        p_valor: centavos,
        p_data_vencimento: vencimento,
        // Competência = mês de referência do gasto; default no servidor = mês
        // do vencimento. Aqui usamos a data escolhida (campo "competência").
        p_data_competencia: dataCompra || null,
        p_categoria_id: categoriaId || null,
      });
      setPendente(false);
      if (error) {
        notificar(mensagemDeErro(error), "erro");
        return;
      }
      void data;
      notificar("Boleto registrado em Contas a pagar.", "sucesso");
      setDescricao("");
      setValor("");
      setVencimento("");
      setCategoriaId("");
      router.refresh();
      return;
    }

    // ===== Transação comum: motor RPC atômico =====
    const { data, error } = await supabase.rpc("processar_transacao_completa", {
      p_descricao: descricao.trim(),
      p_valor_total: centavos,
      p_tipo: tipo,
      p_forma_pagamento: forma,
      p_cartao_id: ehCredito ? cartaoId : null,
      p_data_compra: dataCompra,
      p_num_parcelas: ehCredito ? Number(numParcelas) : 1,
    });

    if (error) {
      setPendente(false);
      notificar(mensagemDeErro(error), "erro");
      return;
    }
    const resultado = data as { transacao_id?: string; parcelas_criadas?: number } | null;

    // Categoria escolhida à mão prevalece sobre a autocategorização por
    // regra (trigger 0008); vazio = deixa a regra decidir. Passo separado
    // para não tocar na assinatura da RPC crítica de escrita.
    let erroCategoria: { message: string; hint?: string | null } | null = null;
    if (categoriaId && resultado?.transacao_id) {
      const resp = await supabase.rpc("definir_categoria_transacao", {
        p_transacao_id: resultado.transacao_id,
        p_categoria_id: categoriaId,
      });
      erroCategoria = resp.error;
    }
    setPendente(false);

    const pos = mensagemPosTransacao(resultado?.parcelas_criadas, erroCategoria);
    notificar(pos.texto, pos.tipo);
    setDescricao("");
    setValor("");
    setNumParcelas("1");
    setCategoriaId("");
    router.refresh();
  }

  return (
    <form aria-label="Nova transação" onSubmit={enviar} className="vidro-soberano min-w-0 p-4" style={{borderTop:`3px solid var(${ehReceita?'--verde':'--telha'})`}}>
      <h2 className="mb-3 font-medium">Nova transação</h2>
      <fieldset disabled={pendente} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">Tipo
          <select value={tipo} onChange={e=>trocarTipo(e.target.value)} className="campo-soberano" disabled={pendente}>
            <option value="DESPESA">Despesa</option><option value="RECEITA">Receita</option>
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          Descrição
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            required
            maxLength={500}
            className="campo-soberano"
            placeholder={ehReceita?'Ex.: Salário, serviço recebido':ehBoleto ? "Ex.: Conta de luz" : "Ex.: Mercado"}
          />
        </label>
        <label className="text-sm">
          Valor (R$)
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            required
            inputMode="decimal"
            className="campo-soberano"
            placeholder="100,00"
          />
        </label>
        <label className="text-sm">
          {ehReceita?'Data do recebimento':ehBoleto ? "Competência (mês de referência)" : "Data da compra"}
          <input
            type="date"
            value={dataCompra}
            onChange={(e) => setDataCompra(e.target.value)}
            required
            className="campo-soberano"
          />
        </label>
        <label className="text-sm">
          {ehReceita?'Forma de recebimento':'Forma de pagamento'}
          <select
            value={forma}
            onChange={(e) => trocarForma(e.target.value)}
            className="campo-soberano"
          >
            {!ehReceita&&<option value="CREDITO">Crédito</option>}
            {!ehReceita&&<option value="DEBITO">Débito</option>}
            <option value="PIX">Pix</option>
            {ehReceita&&<option value="TRANSFERENCIA">Transferência</option>}
            <option value="DINHEIRO">Dinheiro</option>
            {!ehReceita&&<option value="BOLETO">Boleto / conta a pagar</option>}
          </select>
        </label>
        {ehBoleto ? (
          <label className="text-sm">
            Vencimento
            <input
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              required
              className="campo-soberano"
            />
          </label>
        ) : null}
        {ehReceita&&<label className="text-sm sm:col-span-2">Observação (opcional)
          <textarea className="campo-soberano" value={observacao} onChange={e=>setObservacao(e.target.value)} maxLength={2000} rows={2}/>
        </label>}
        {categorias.length > 0 && (
          <label className="text-sm">
            Categoria
            <select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              className="campo-soberano"
            >
              <option value="">Automática (por regra)</option>
              {categoriasDoTipo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        {ehCredito && (
          <>
            <label className="text-sm">
              Cartão
              <select
                value={cartaoId}
                onChange={(e) => setCartaoId(e.target.value)}
                className="campo-soberano"
              >
                {cartoes.length === 0 && <option value="">Nenhum cartão cadastrado</option>}
                {cartoes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Parcelas
              <input
                type="number"
                min={1}
                max={MAX_PARCELAS_UI}
                value={numParcelas}
                onChange={(e) => setNumParcelas(e.target.value)}
                required
                className="campo-soberano"
              />
            </label>
          </>
        )}
      </fieldset>
      {ehReceita&&<p className="mt-3 text-sm">Receita aumenta o caixa geral. Transferências entre suas próprias contas devem ser registradas em Contas bancárias, pois não são renda nova.</p>}
      {ehReceita&&<a className="mt-3 inline-block text-sm underline" href="#receitas-recorrentes">Programar receita recorrente, como salário</a>}
      {ehBoleto && (
        <p className="mt-2 text-xs" style={{ color: "var(--grafite)" }}>
          Boleto é uma conta a pagar (luz, água, gás…): entra como despesa da
          competência agora e só sai da carteira quando você marcar como paga,
          em <strong>Contas a pagar</strong>. A <strong>competência</strong> é o
          mês de referência do gasto (a luz de julho é julho, mesmo que vença em
          agosto) — ajuste se o vencimento for de outro mês.
        </p>
      )}
      <button
        type="submit"
        disabled={pendente}
        className="botao-soberano mt-3 text-sm"
        style={ehReceita?{background:'var(--verde)'}:undefined}
      >
        {pendente ? "Processando..." : ehReceita?'Registrar receita':ehBoleto ? "Registrar boleto" : "Registrar"}
      </button>
    </form>
  );
}
