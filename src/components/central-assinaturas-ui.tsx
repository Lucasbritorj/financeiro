import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import type { StatusAssinatura } from "@/lib/assinaturas";
import {
  impactoPorCartao,
  proximasCobrancas,
  resumirAssinaturas,
  rotuloPeriodicidade,
} from "@/lib/assinaturas";
import { hojeSaoPaulo } from "@/lib/data";
import { formatarCentavos, formatarData } from "@/lib/money";
import type {
  AssinaturaLinha,
  CartaoOpcao,
  CategoriaOpcao,
  FormAssinatura,
} from "@/components/use-central-assinaturas";

export function ResumoAssinaturas({ assinaturas }: { assinaturas: AssinaturaLinha[] }) {
  const resumo = resumirAssinaturas(assinaturas);
  const cartoes = [
    ["Assinaturas ativas", String(resumo.quantidadeAtivas), undefined],
    ["Custo mensal equivalente", formatarCentavos(resumo.custoMensal), "var(--ouro)"],
    ["Projeção anual", formatarCentavos(resumo.custoAnual), "var(--ouro)"],
  ] as const;

  return (
    <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumo das assinaturas">
      {cartoes.map(([rotulo, valor, cor]) => (
        <article key={rotulo} className="vidro-soberano p-4">
          <p className="text-xs" style={{ color: "var(--grafite)" }}>{rotulo}</p>
          <p className="numero-soberano mt-1 text-2xl" style={{ color: cor }}>{valor}</p>
        </article>
      ))}
    </section>
  );
}

export function ProximasCobrancas({
  assinaturas,
  cartoes,
}: {
  assinaturas: AssinaturaLinha[];
  cartoes: CartaoOpcao[];
}) {
  const hoje = hojeSaoPaulo();
  const proximas = proximasCobrancas(assinaturas).filter(
    (assinatura) => assinatura.proxima_data >= hoje,
  );
  const nomeCartao = (id: string | null) =>
    id ? (cartoes.find((cartao) => cartao.id === id)?.nome ?? "Cartão removido") : "Sem cartão";

  return (
    <section className="vidro-soberano grid gap-3 p-4" aria-labelledby="proximas-cobrancas">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="proximas-cobrancas" className="font-medium">Próximas cobranças</h2>
        <span className="text-xs" style={{ color: "var(--grafite)" }}>somente contratos ativos</span>
      </header>
      {proximas.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--grafite)" }}>
          Nenhuma cobrança futura agendada.
        </p>
      ) : (
        <ol className="grid gap-2 sm:grid-cols-2">
          {proximas.map((assinatura) => (
            <li key={assinatura.id} className="rounded border p-3" style={{ borderColor: "var(--borda)" }}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{assinatura.descricao}</span>
                <span className="numero-soberano">{formatarCentavos(assinatura.valor)}</span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--grafite)" }}>
                {formatarData(assinatura.proxima_data)} · {nomeCartao(assinatura.cartao_id)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ImpactoPorCartao({ assinaturas, cartoes }: {
  assinaturas: AssinaturaLinha[];
  cartoes: CartaoOpcao[];
}) {
  const grupos = impactoPorCartao(assinaturas, cartoes);
  return (
    <section className="vidro-soberano grid gap-4 p-4" aria-labelledby="impacto-por-cartao">
      <h2 id="impacto-por-cartao" className="font-medium">Impacto por Cartão</h2>
      {grupos.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--grafite)" }}>
          Nenhuma assinatura ativa.
        </p>
      ) : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {grupos.map((grupo) => (
            <article
              key={grupo.cartaoId ?? "sem-cartao"}
              className="grid min-w-0 gap-3 rounded border p-3"
              style={{ borderColor: "var(--borda)" }}
            >
              <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                <h3 className="min-w-0 break-words font-medium">{grupo.nomeCartao}</h3>
                <span className="text-xs" style={{ color: "var(--grafite)" }}>
                  {grupo.quantidadeAtivas} {grupo.quantidadeAtivas === 1 ? "ativa" : "ativas"}
                </span>
              </header>
              <dl className="grid min-w-0 gap-2 sm:grid-cols-3">
                <div className="min-w-0">
                  <dt className="text-xs" style={{ color: "var(--grafite)" }}>
                    Custo mensal equivalente
                  </dt>
                  <dd className="numero-soberano break-words" style={{ color: "var(--ouro)" }}>
                    {formatarCentavos(grupo.custoMensal)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs" style={{ color: "var(--grafite)" }}>
                    Projeção anual
                  </dt>
                  <dd className="numero-soberano break-words" style={{ color: "var(--ouro)" }}>
                    {formatarCentavos(grupo.custoAnual)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs" style={{ color: "var(--grafite)" }}>Participação</dt>
                  <dd className="numero-soberano" style={{ color: "var(--ouro)" }}>
                    {(grupo.participacaoPercentual / 10).toLocaleString("pt-BR", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}%
                  </dd>
                </div>
              </dl>
              <div className="min-w-0">
                <h4 className="text-xs font-medium" style={{ color: "var(--grafite)" }}>Maiores impactos anuais</h4>
                <ol className="mt-2 grid min-w-0 gap-1">
                  {grupo.principaisAssinaturas.map((assinatura, indice) => (
                    <li
                      key={`${assinatura.descricao}-${indice}`}
                      className="grid min-w-0 gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3"
                    >
                      <span className="min-w-0 break-words">{assinatura.descricao}</span>
                      <span className="numero-soberano" style={{ color: "var(--giz)" }}>
                        {formatarCentavos(assinatura.custoAnual)} / ano
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ListaAssinaturas({
  assinaturas,
  categorias,
  cartoes,
  abrirEdicao,
  alterarStatus,
}: {
  assinaturas: AssinaturaLinha[];
  categorias: CategoriaOpcao[];
  cartoes: CartaoOpcao[];
  abrirEdicao: (assinatura: AssinaturaLinha) => void;
  alterarStatus: (assinatura: AssinaturaLinha, status: StatusAssinatura) => Promise<void>;
}) {
  const hoje = hojeSaoPaulo();
  const nomeCategoria = (id: string | null) =>
    id ? (categorias.find((categoria) => categoria.id === id)?.nome ?? "Categoria removida") : "Sem categoria";
  const nomeCartao = (id: string | null) =>
    id ? (cartoes.find((cartao) => cartao.id === id)?.nome ?? "Cartão removido") : "Sem cartão";

  return (
    <ul className="grid gap-3">
      {assinaturas.map((assinatura) => (
        <li key={assinatura.id} className="rounded border p-3" style={{ borderColor: "var(--borda)" }}>
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{assinatura.descricao}</span>
                <span className="selo text-xs">{assinatura.status.toLowerCase()}</span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--grafite)" }}>
                {rotuloPeriodicidade(assinatura.periodicidade)} ·{" "}
                {assinatura.proxima_data < hoje
                  ? "agenda pendente no motor"
                  : `próxima em ${formatarData(assinatura.proxima_data)}`}
                {" "}· {nomeCategoria(assinatura.categoria_id)}
                {" "}· {nomeCartao(assinatura.cartao_id)}
              </p>
            </div>
            <span className="numero-soberano" style={{ color: "var(--giz)" }}>
              {formatarCentavos(assinatura.valor)}
            </span>
            {assinatura.status !== "CANCELADA" && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="botao-fantasma text-xs" onClick={() => abrirEdicao(assinatura)}>
                  Editar {assinatura.descricao}
                </button>
                <button
                  type="button"
                  className="botao-fantasma text-xs"
                  onClick={() => void alterarStatus(assinatura, assinatura.status === "ATIVA" ? "PAUSADA" : "ATIVA")}
                >
                  {assinatura.status === "ATIVA" ? "Pausar" : "Reativar"} {assinatura.descricao}
                </button>
                <button
                  type="button"
                  className="botao-fantasma botao-perigo text-xs"
                  onClick={() => void alterarStatus(assinatura, "CANCELADA")}
                >
                  Cancelar {assinatura.descricao}
                </button>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function FormularioAssinatura({
  form,
  setForm,
  categorias,
  cartoes,
  editandoId,
  pendente,
  salvar,
  fechar,
}: {
  form: FormAssinatura;
  setForm: Dispatch<SetStateAction<FormAssinatura>>;
  categorias: CategoriaOpcao[];
  cartoes: CartaoOpcao[];
  editandoId: string | null;
  pendente: boolean;
  salvar: FormEventHandler;
  fechar: () => void;
}) {
  const alterar = (campo: keyof FormAssinatura, valor: string) =>
    setForm((atual) => ({ ...atual, [campo]: valor }));

  return (
    <form onSubmit={salvar} className="grid gap-3 border-t pt-4" style={{ borderColor: "var(--borda)" }}>
      <h3 className="font-medium">{editandoId ? "Editar assinatura" : "Nova assinatura"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Serviço ou assinatura
          <input value={form.nome} onChange={(e) => alterar("nome", e.target.value)} required className="campo-soberano" placeholder="Ex.: Streaming" />
        </label>
        <label className="text-sm">
          Valor por cobrança (R$)
          <input value={form.valor} onChange={(e) => alterar("valor", e.target.value)} required inputMode="decimal" className="campo-soberano" placeholder="49,90" />
        </label>
        <label className="text-sm">
          Periodicidade
          <select value={form.periodicidade} onChange={(e) => alterar("periodicidade", e.target.value)} className="campo-soberano">
            <option value="MENSAL">Mensal</option>
            <option value="TRIMESTRAL">Trimestral</option>
            <option value="SEMESTRAL">Semestral</option>
            <option value="ANUAL">Anual</option>
          </select>
        </label>
        <label className="text-sm">
          Próxima cobrança
          <input type="date" value={form.proximaCobranca} onChange={(e) => alterar("proximaCobranca", e.target.value)} required className="campo-soberano" />
        </label>
        <label className="text-sm">
          Categoria
          <select value={form.categoriaId} onChange={(e) => alterar("categoriaId", e.target.value)} className="campo-soberano">
            <option value="">Sem categoria</option>
            {categorias.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.nome}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Cartão
          <select value={form.cartaoId} onChange={(e) => alterar("cartaoId", e.target.value)} className="campo-soberano">
            <option value="">Sem cartão</option>
            {cartoes.map((cartao) => <option key={cartao.id} value={cartao.id}>{cartao.nome}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs" style={{ color: "var(--grafite)" }}>
        Com cartão, a despesa real continua vindo da fatura. Sem cartão, a
        Central apenas projeta o custo e não cria lançamento automático.
      </p>
      <div className="flex gap-3">
        <button type="submit" disabled={pendente} className="botao-soberano text-sm">
          {pendente ? "Salvando..." : editandoId ? "Salvar alterações" : "Cadastrar assinatura"}
        </button>
        <button type="button" className="botao-fantasma text-sm" onClick={fechar}>Fechar</button>
      </div>
    </form>
  );
}

type GerenciadorProps = {
  assinaturas: AssinaturaLinha[] | null;
  formAberto: boolean;
  editandoId: string | null;
  pendente: boolean;
  form: FormAssinatura;
  setForm: Dispatch<SetStateAction<FormAssinatura>>;
  abrirNovo: () => void;
  abrirEdicao: (assinatura: AssinaturaLinha) => void;
  fecharForm: () => void;
  salvar: FormEventHandler;
  alterarStatus: (assinatura: AssinaturaLinha, status: StatusAssinatura) => Promise<void>;
  categorias: CategoriaOpcao[];
  cartoes: CartaoOpcao[];
};

export function GerenciadorAssinaturas(props: GerenciadorProps) {
  return (
    <section className="vidro-soberano grid gap-4 p-4" aria-labelledby="gerenciar-assinaturas">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="gerenciar-assinaturas" className="font-medium">Assinaturas</h2>
          <p className="text-xs" style={{ color: "var(--grafite)" }}>
            O cancelamento aqui não envia solicitação ao fornecedor.
          </p>
        </div>
        {!props.formAberto && (
          <button type="button" className="botao-soberano text-sm" onClick={props.abrirNovo}>
            Nova assinatura
          </button>
        )}
      </header>
      {props.assinaturas === null && <p className="text-sm">Carregando...</p>}
      {props.assinaturas?.length === 0 && !props.formAberto && (
        <p className="text-sm">Nenhuma assinatura cadastrada.</p>
      )}
      {props.assinaturas && props.assinaturas.length > 0 && (
        <ListaAssinaturas {...props} assinaturas={props.assinaturas} />
      )}
      {props.formAberto && (
        <FormularioAssinatura {...props} fechar={props.fecharForm} />
      )}
    </section>
  );
}
