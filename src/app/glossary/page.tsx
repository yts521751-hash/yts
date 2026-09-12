import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const TERMS = [
  {
    id: "turnover",
    title: "成交金額是什麼？",
    body: "當日所有成交的總金額（股數 × 成交價加總）。金潮把題材板塊內成分股的成交金額加總，用來排「哪個板塊最熱」。這跟法人買賣超是兩件事。",
  },
  {
    id: "heat",
    title: "熱度／加速度",
    body: "熱度＝近 5 日日均成交 ÷ 近 20 日日均成交。大於 1 代表最近比過去更熱鬧。加速度＝近 5 日日均 − 近 20 日日均，看熱度是在往上還是往下。",
  },
  {
    id: "states",
    title: "放量／偏熱／偏冷／縮量",
    body: "放量＝近 5 日成交明顯高於近 20 日均量；偏熱＝仍高於均量但未大幅放大；偏冷＝略低於均量；縮量＝明顯低於均量。用來快速分組成交熱度，不是漲跌預測。",
  },
  {
    id: "ranking",
    title: "成交金額排行榜怎麼看？",
    body: "每一列＝一個題材板塊。可依當日成交、近 5／20 日成交、熱度、加速度、漲幅或 CP 值排序。點列可展開成分股成交明細。",
  },
  {
    id: "cp",
    title: "CP 值",
    body: "近 20 日成交金額大、但股價漲幅仍相對溫和的板塊。解讀成「換手熱絡、價格尚未完全反應」的觀察清單，不是保證上漲。",
  },
  {
    id: "spike",
    title: "大跌日異常放量",
    body: "大盤跌逾 1%、板塊自己也跌、但當日成交遠高於近 20 日均量。用來回答「恐慌日市場注意力落在哪裡」，幫你縮小注意範圍。",
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
          籌碼名詞白話小百科
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          專有名詞用白話講一次。金潮不預測行情，只幫你把板塊成交熱度攤開看清楚。
        </p>
        <div className="mt-8 space-y-4">
          {TERMS.map((t) => (
            <article
              key={t.id}
              id={t.id}
              className="rounded-2xl border border-border/60 bg-[var(--panel)]/80 p-4 backdrop-blur-sm"
            >
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">{t.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t.body}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
