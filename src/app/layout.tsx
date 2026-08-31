import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { RegistrarServiceWorker } from "@/components/registrar-service-worker";

// Tipografia Ateliê (modelo §2): serifa com caráter no herói/títulos,
// grotesca no corpo, mono tabular nos números.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-inter",
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
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ateliê",
  },
};

export const viewport: Viewport = {
  themeColor: "#161311",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
      className={`${fraunces.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col">
        <RegistrarServiceWorker />
        {children}
      </body>
    </html>
  );
}
