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
    body: "風力度分數＝短線乖離（BIAS5／20）與近 20 日波動的「強度」，不是多空分數。跌破均線的急殺，分數也可以高於溫和站上月線——這就是為什麼加權站上月線時，櫃買風度值仍可能較高。右上角均線標籤才是結構：多頭／空頭排列、站上月線、跌破月季線等。分級：強風＝多空排列清楚；陣風＝有推力但未排齊；亂流＝波動高且訊號打架；無風＝乖離小、波動低。櫃買門檻略高，避免常態被判破錶。",
  },
  {
    id: "cache",
    title: "為什麼第一次很慢、之後較快？",
    body: "伺服器採灰度：永遠先讀 active 快取，同步寫進 staging 再切換；首次／冷啟動若沒有真實快取，會暫顯示示範並背景重建。瀏覽器端另做 stale-while-revalidate：首頁、風度、成交排行會先讀本機上次資料立刻上畫面，再背景拉最新。示範資料不會覆寫本機真實快取。",
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
    id: "stock-flow",
    title: "個股金流怎麼看？",
    body: "首頁可切到「個股金流」：挑成交較熱的個股，用與板塊相同的公式算當日／近 5 日淨流（成交×漲跌為主、法人為輔）。也可在板塊明細裡用當日／5 日切換看成分股。",
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
    body: "行情／法人每日排程先寫 staging，驗證後原子切 active，並預熱產業日線與風度。新聞則是每 10 分鐘做同樣的 staging→active。開網頁永遠讀 active；force 更新只觸發背景重建，不卡住畫面。",
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
