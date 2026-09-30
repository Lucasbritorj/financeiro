"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Links de navegação com sublinhado dourado no item ativo. Client component
// só por causa do usePathname; o resto do layout permanece no servidor.
export default function NavLinks({
  itens,
  variante = "principal",
}: {
  itens: { href: string; rotulo: string }[];
  variante?: "principal" | "secundaria";
}) {
  const pathname = usePathname();
  return (
    <>
      {itens.map((item) => {
        const ativo = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            data-ativo={ativo}
            aria-current={ativo ? "page" : undefined}
            className={`nav-link ${variante === "secundaria" ? "text-xs" : "text-sm"}`}
          >
            {item.rotulo}
          </Link>
        );
      })}
    </>
  );
}
