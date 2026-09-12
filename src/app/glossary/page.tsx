import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const TERMS = [
  {
    id: "sectors",
    title: "板塊怎麼分類？",
    body: "現在分三層：1) 官方產業——依證交所／櫃買 ISIN 產業別（接近三竹產業類型），再取當日成交較熱的代表性個股；2) 題材板塊——人工維護的供應鏈／催化題材；3) 新興自動——從熱議新聞＋成交熱門股自動聚合成概念板塊。可在首頁切換「官方產業／題材／新興自動」。",
  },
  {
    id: "wind",
    title: "風度儀表板是什麼？",
    body: "分別觀察上市（加權）與上櫃（櫃買合成）風度。用收盤相對 MA5／MA20／MA60 的乖離，搭配近 20 日波動，分成強風、陣風、亂流、無風，方便一眼判斷盤勢是趨勢明確、忽強忽弱、還是平靜。",
  },
  {
    id: "fear",
    title: "波動情緒指標怎麼算？",
    body: "參考 VIX 類波動，而不是當天漲跌。優先讀取 CBOE VIX，並輔以台股加權近約 20 日實現波動（年化）；兩者皆有時以約 0.55／0.45 混合。分數愈高代表市場預期波動／恐慌愈高（例如低波動約 22、常態約 48、偏恐慌約 72、極度恐慌約 85+）。",
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
    title: "強勢／輪動／觀望／出場",
    body: "看近 5 日淨流的正負，再比「近 5 日日均流 − 近 20 日日均流」加速度。強勢＝流入且加速；輪動＝流入但減速；觀望＝流出但減速；出場＝流出加速。",
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
    body: "伺服器每 10 分鐘抓一次 Google 新聞 RSS，聚焦成交 Top50 相關個股，並優先排入標題含「熱門族群」的稿件；先寫 staging 再切 active。你開新聞頁永遠讀 active。",
  },
  {
    id: "gray",
    title: "灰度同步是什麼？",
    body: "行情／法人每日排程先寫 staging，驗證後原子切 active，並預熱產業日線。新聞則是每 10 分鐘做同樣的 staging→active。開網頁永遠讀 active。",
  },
];

export default function GlossaryPage() {
  return (
    <div className="relative min-h-full flex-1">
      <div className="studio-atmosphere pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          回排行榜
        </Link>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          金流看板名詞白話小百科
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          專有名詞用白話講一次。金流看板不預測行情，只把成交、漲跌與法人攤開成資金流給你看。資料來源：臺灣證券交易所、證券櫃檯買賣中心公開資料。
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
