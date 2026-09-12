import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const TERMS = [
  {
    id: "sectors",
    title: "板塊是怎麼分類的？為什麼個股看起來偏少？",
    body: "金潮的板塊不是證交所官方產業分類代碼，而是「題材／供應鏈角色」人工清單：把同一催化事件或同一產業鏈常一起被點名的股票放在一組（例如 AI 伺服器組裝、液冷、先進封裝）。成分以流動性與代表性為主，一檔股票也可跨多個相關板塊。目標是可讀的核心觀察名單，不是把該產業全部上市櫃公司列完；因此單板塊通常約 8～12 檔，而不是上百檔。",
  },
  {
    id: "fear",
    title: "情緒／恐慌指標怎麼算？",
    body: "目前是簡化版「大盤溫度計」，只看加權指數當日漲跌幅分檔：≤−2%＝恐慌（88）、≤−1%＝偏恐慌（72）、＜−0.3%＝偏謹慎（58）、＜0.5%＝中性（48）、＜1.5%＝偏樂觀（35）、再以上＝偏熱絡（22）。它不是 VIX、也不是選擇權 put/call，分數愈高代表當日盤面愈偏恐慌。後續若要加成交量或波動率，會另開欄位，避免把不同概念混在同一個分數裡。",
  },
  {
    id: "flow",
    title: "資金流怎麼算？",
    body: "主訊號（權重 80%）＝成交金額 × softSign(漲跌幅)。輔訊號（權重 20%）＝三大法人買賣超股數 × 收盤價（換成億元）。兩者加權後得到當日淨流；沒抓到法人日資料時，當日退回純成交×漲跌，避免數字被無故縮水。",
  },
  {
    id: "in-out",
    title: "流入／流出怎麼拆？",
    body: "成交側：softSign 為正的部分叫流入、為負的絕對值叫流出。法人側：買超進流入、賣超進出流。最後各乘上 80%／20% 再相加；淨流＝流入 − 流出。板塊數字是成分股加總。",
  },
  {
    id: "states",
    title: "漲潮／輪動／觀望／退潮",
    body: "看近 5 日淨流的正負，再比「近 5 日日均流 − 近 20 日日均流」加速度。漲潮＝流入且加速；輪動＝流入但減速；觀望＝流出但減速；退潮＝流出加速。",
  },
  {
    id: "kline",
    title: "產業日線 K 線是什麼？",
    body: "把板塊成分股當日開高低收依成交金額加權合成報酬，串成指數型日線（基準 100），並疊 MA5／10／20／60。下方還有每日流入／流出柱。頁面只讀本機快取；MA60 需要至少 60 根日 K，背景同步會補齊歷史行情。",
  },
  {
    id: "turnover",
    title: "成交金額排行",
    body: "與資金流無關的單純排行：把當日上市＋上櫃個股依成交金額（億元）由高到低排列，用來快速看「錢堆在哪」。",
  },
  {
    id: "news",
    title: "熱議新聞怎麼更新？",
    body: "伺服器每 10 分鐘抓一次 Google 新聞 RSS（台股／半導體／AI 伺服器等關鍵字），先寫入 staging 再切到 active，屬於新聞專用的灰度部署。你開新聞頁永遠讀 active，不會卡在抓 RSS。",
  },
  {
    id: "gray",
    title: "灰度同步是什麼？",
    body: "行情／法人每日排程先寫 staging，驗證後原子切 active，並預熱產業日線。新聞則是每 10 分鐘做同樣的 staging→active。開網頁永遠讀 active。",
  },
  {
    id: "cp",
    title: "CP 值排行",
    body: "近 20 日成交金額大、股價漲幅仍相對溫和，並略偏好淨流入的板塊。解讀成「換手熱絡、價格尚未完全反應」的觀察清單，不是保證上漲。",
  },
];

export default function GlossaryPage() {
  return (
    <div className="relative min-h-full flex-1">
      <div className="tide-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          回排行榜
        </Link>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          金潮名詞白話小百科
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          專有名詞用白話講一次。金潮不預測行情，只把成交、漲跌與法人攤開成資金流給你看。
        </p>
        <div className="mt-8 space-y-4">
          {TERMS.map((t) => (
            <article
              key={t.id}
              id={t.id}
              className="rounded-2xl border border-border/60 bg-[var(--panel)]/80 p-4 backdrop-blur-sm"
            >
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
                {t.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.body}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
