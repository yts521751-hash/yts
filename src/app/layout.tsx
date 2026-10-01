import type { Metadata } from "next";
import { Noto_Sans_TC, IBM_Plex_Sans, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MobileNav } from "@/components/mobile-nav";
import "./globals.css";

const notoSans = Noto_Sans_TC({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlex = IBM_Plex_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#10161f" },
  ],
};

export const metadata: Metadata = {
  title: "金流看板｜台股板塊資金流",
  description:
    "台股板塊資金流與成交排行：強勢／輪動／觀望／出場四態、產業日線與均線掃描、成交 Top50 與價值選股。",
};

/** paint 前套用字級／深淺色，避免進子頁才套造成閃動 */
const APPEARANCE_BOOTSTRAP = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("jinchao_text");d.dataset.textsize=(t==="md"||t==="lg")?t:"sm";var m=localStorage.getItem("jinchao_theme");var dark=m==="dark"||(m!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);d.classList.toggle("dark",dark);d.style.colorScheme=dark?"dark":"light";}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant"
      data-textsize="sm"
      className={`${notoSans.variable} ${ibmPlex.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <TooltipProvider>
          <div className="flex min-h-full flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </div>
          <MobileNav />
        </TooltipProvider>
      </body>
    </html>
  );
}
