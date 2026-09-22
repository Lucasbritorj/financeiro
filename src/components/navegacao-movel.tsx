"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; rotulo: string };

export default function NavegacaoMovel({ itens }: { itens: Item[] }) {
  const pathname = usePathname();
  return (
    <details className="md:hidden">
      <summary className="botao-fantasma cursor-pointer text-sm">Menu</summary>
      <div className="absolute left-0 right-0 top-full border-b p-4 shadow-lg" style={{ background: "var(--pergaminho)", borderColor: "var(--borda)" }}>
        <ul className="mx-auto grid max-w-5xl gap-1" aria-label="Navegação principal">
          {itens.map((item) => {
            const ativo = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={ativo ? "page" : undefined} className="block rounded px-3 py-2 text-sm" data-ativo={ativo}>
                  {item.rotulo}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}