import { formatarCentavos, formatarCentavosAcessivel } from "@/lib/money";

/**
 * Valor monetário acessível. Mostra "R$ 1.234,56" com numeral tabular
 * (não "treme" ao atualizar) e expõe uma leitura explícita ao leitor de tela
 * via aria-label ("1.234 reais e 56 centavos"), evitando que o símbolo BRL
 * seja soletrado de forma ambígua. Fonte única: src/lib/money.ts.
 */
export function Dinheiro({
  centavos,
  className,
}: {
  centavos: number;
  className?: string;
}) {
  return (
    <span
      className={className}
      aria-label={formatarCentavosAcessivel(centavos)}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {formatarCentavos(centavos)}
    </span>
  );
}
