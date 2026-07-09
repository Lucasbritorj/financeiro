import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Tipografia Ateliê (modelo §2): serifa com caráter no herói/títulos,
// grotesca no corpo, mono tabular nos números.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Ateliê — seu dinheiro, com clareza",
  description: "Assistente financeiro pessoal: categorias, insights e planejamento",
};

// Aplica o tema salvo ANTES do paint (sem flash). Escuro é o padrão.
const SCRIPT_TEMA = `try{var t=localStorage.getItem('atelie-tema');if(t==='claro')document.documentElement.setAttribute('data-tema','claro');}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${fraunces.variable} ${hanken.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
