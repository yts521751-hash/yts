import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const TERMS = [
  {
    id: "flow",
    title: "資金流怎麼算？",
    body: "主訊號（權重 80%）＝成交金額 × softSign(漲跌幅)：成交告訴你「關注規模」，漲跌告訴你「偏多偏空」。輔訊號（權重 20%）＝三大法人買賣超股數 × 收盤價（換成億元）。兩者加權後得到當日淨流；沒抓到法人日資料時，當日退回純成交×漲跌，避免數字被無故縮水。",
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
    title: "產業 K 線是什麼？",
    body: "把板塊成分股當日的開高低收，依成交金額加權合成報酬，再串成指數型 K 線（基準 100），概念接近三竹股市的族群／類股圖。同一畫面下方還有每日流入／流出柱。頁面只讀本機快取，不會在瀏覽器端卡住去抓證交所。",
  },
  {
    id: "gray",
    title: "灰度同步是什麼？",
    body: "每日排程先把新資料（行情＋法人）寫進 staging，驗證完成後再原子切換成 active，並預熱各產業 K 線快取。你開網頁永遠讀 active，不會卡在「等證交所抓完才出畫面」。",
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
