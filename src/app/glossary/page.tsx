import Link from "next/link";
import { ArrowLeft } from "lucide-react";

const TERMS = [
  {
    id: "institutions",
    title: "三大法人是什麼？",
    body: "外資、投信、自營商合稱三大法人。他們資金大、進出常帶動短線情緒。金潮把這三家每天買賣超加總，看錢往哪個板塊流。",
  },
  {
    id: "net",
    title: "買賣超是什麼？",
    body: "買進金額減賣出金額。正的＝當天法人整體偏買；負的＝偏賣。近 5 日／近 20 日是把這些日淨額累加起來看趨勢。",
  },
  {
    id: "states",
    title: "漲潮／輪動／觀望／退潮",
    body: "漲潮＝流入且加速；輪動＝還在流入但放緩；觀望＝流出但放緩；退潮＝加速流出。名字取自潮汐——錢像海水，一波一波在板塊間移動。",
  },
  {
    id: "bubble",
    title: "泡泡圖怎麼看？",
    body: "每顆泡泡＝一個板塊。左右＝近 5 日流入／流出；上下＝比近 20 日平均更偏買／偏賣；大小＝近 20 日金額規模。右上＝流入而且還在加速。",
  },
  {
    id: "cp",
    title: "CP 值排行",
    body: "資金大量流入、但近 20 日漲幅仍相對溫和的板塊。解讀成「主力可能已佈局、股價還沒完全反應」的觀察清單，不是保證上漲。",
  },
  {
    id: "contrarian",
    title: "大跌日逆勢買超",
    body: "大盤跌逾 1%、板塊自己也跌、法人卻異常大買。用來回答「恐慌日法人的錢往哪裡去」，幫你縮小注意範圍。",
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
          回泡泡圖
        </Link>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          籌碼名詞白話小百科
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          專有名詞用白話講一次。金潮不預測行情，只幫你把法人資金攤開看清楚。
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
