import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PainelUpload } from "@/components/importador-csv/painel-upload";

// Primeiro teste de componente do projeto. PainelUpload é o alvo certo para
// abrir a trilha: é apresentação pura — recebe tudo por prop e não fala com
// Supabase — e saiu do refactor de importador-csv.tsx sem cobertura de render.

function montar(props: Partial<Parameters<typeof PainelUpload>[0]> = {}) {
  const onArquivo = vi.fn();
  const onPreset = vi.fn();
  render(
    <PainelUpload
      preset="nubank"
      onPreset={onPreset}
      onArquivo={onArquivo}
      pendente={false}
      erro={null}
      aviso={null}
      {...props}
    />,
  );
  return { onArquivo, onPreset };
}

test("mostra o seletor de banco e o campo de arquivo", () => {
  montar();
  expect(screen.getByLabelText(/Banco \/ formato/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Arquivo do extrato/)).toBeInTheDocument();
});

test("escolher um arquivo chama onArquivo com o File", async () => {
  const user = userEvent.setup();
  const { onArquivo } = montar();
  const arquivo = new File(["data,valor\n"], "extrato.csv", { type: "text/csv" });

  await user.upload(screen.getByLabelText(/Arquivo do extrato/), arquivo);

  expect(onArquivo).toHaveBeenCalledTimes(1);
  expect(onArquivo.mock.calls[0][0].name).toBe("extrato.csv");
});

test("o input é limpo depois da escolha, para reenviar o mesmo arquivo", async () => {
  // Sem isto, escolher o mesmo arquivo duas vezes não dispara change na
  // segunda — o comportamento que o refactor moveu para cá.
  const user = userEvent.setup();
  const { onArquivo } = montar();
  const input = screen.getByLabelText(/Arquivo do extrato/) as HTMLInputElement;
  const arquivo = new File(["x"], "extrato.csv", { type: "text/csv" });

  await user.upload(input, arquivo);

  expect(input.value).toBe("");
  expect(onArquivo).toHaveBeenCalledTimes(1);
});

test("trocar o preset avisa o chamador com o id do banco", async () => {
  const user = userEvent.setup();
  const { onPreset } = montar();
  await user.selectOptions(screen.getByLabelText(/Banco \/ formato/), "inter");
  expect(onPreset).toHaveBeenCalledWith("inter");
});

test("pendente desabilita o campo e anuncia o processamento", () => {
  montar({ pendente: true });
  expect(screen.getByLabelText(/Arquivo do extrato/)).toBeDisabled();
  expect(screen.getByText(/Processando/)).toBeInTheDocument();
});

test("erro e aviso aparecem quando o container passa os dois", () => {
  montar({ erro: "Arquivo grande demais", aviso: "Este arquivo já foi importado" });
  expect(screen.getByText("Arquivo grande demais")).toBeInTheDocument();
  expect(screen.getByText("Este arquivo já foi importado")).toBeInTheDocument();
});

test("sem erro, aviso ou pendência, nada extra é anunciado", () => {
  montar();
  expect(screen.queryByText(/Processando/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Arquivo do extrato/)).toBeEnabled();
});
