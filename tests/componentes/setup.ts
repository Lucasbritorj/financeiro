// Matchers de DOM (toBeInTheDocument, toBeDisabled…) para o expect do Vitest.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sem globals, o cleanup automático da Testing Library não é registrado:
// sem isto, cada render vaza no DOM do teste seguinte.
afterEach(cleanup);

// jsdom não implementa <dialog>: showModal/close não existem, e sem eles
// qualquer componente que abra um diálogo nativo estoura no teste. O polyfill
// reproduz só o observável — o atributo `open` e o evento `close` — que é o
// que os testes consultam. Foco preso e backdrop ficam de fora: jsdom não tem
// layout, então isso é território de teste em navegador de verdade.
const dialogo = window.HTMLDialogElement?.prototype;
if (dialogo && !dialogo.showModal) {
  dialogo.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  dialogo.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}
