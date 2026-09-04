// Matchers de DOM (toBeInTheDocument, toBeDisabled…) para o expect do Vitest.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sem globals, o cleanup automático da Testing Library não é registrado:
// sem isto, cada render vaza no DOM do teste seguinte.
afterEach(cleanup);
