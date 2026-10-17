import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { resumoDoMes } from "@/lib/insights";
const mocks = vi.hoisted(() => ({ select: vi.fn(), analisar: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t:string)=>{mocks.from(t);return {select:mocks.select};} }) }));
vi.mock("@/lib/analise", () => ({ analisarFinancas: mocks.analisar }));
import AnalisePage from "@/app/(protegido)/analise/page";

test("a página preserva natureza na consulta e nos cálculos", async () => {
  const linhas = [
    { id: "1", descricao: "Compra", valor_total: 10000, tipo: "DESPESA", data_compra: "2026-10-01", natureza: "CONSUMO", categorias: null },
    { id: "2", descricao: "Quitação", valor_total: 10000, tipo: "DESPESA", data_compra: "2026-10-02", natureza: "LIQUIDACAO_FATURA", categorias: null },
  ];
  let chamadas = 0;
  const builder = { gte: () => builder, gt: () => builder, lt: () => builder, order: () => builder, limit: () => builder,
    abortSignal: async () => ({ data: chamadas++ === 0 ? linhas : [], error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(resolve),
  };
  mocks.select.mockReturnValue(builder);
  mocks.analisar.mockReturnValue([]);
  render(await AnalisePage());
  expect(screen.getByRole("heading", { name: "Análise" })).toBeVisible();
  expect(mocks.select.mock.calls[0][0]).toContain("natureza");
  expect(mocks.from).toHaveBeenCalledWith('vw_movimentos_competencia');
  expect(resumoDoMes(mocks.analisar.mock.calls[0][0], "2026-10").saidas).toBe(10000);
});

test('CA11: mês escolhido navega dentro de Análise',async()=>{
 const q={gte:()=>q,gt:()=>q,lt:()=>q,order:()=>q,limit:()=>q,abortSignal:async()=>({data:[],error:null})};
 mocks.select.mockReturnValue(q);mocks.analisar.mockReturnValue([]);
 render(await AnalisePage({searchParams:Promise.resolve({mes:'2026-09'})}));
 expect(screen.getByRole('link',{name:'Mês anterior'})).toHaveAttribute('href','/analise?mes=2026-08');
});
