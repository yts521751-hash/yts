/**
 * 金流公布欄：用當日／3 日／5 日淨流關係，快速標出流入／流出前三名。
 * 四組固定輸出（可為空），避免使用者以為功能壞掉。
 */

export type BulletinRow = {
  id: string;
  name: string;
  dayFlow: number;
  d3Flow: number;
  d5Flow: number;
};

export type BulletinTone = "in" | "out" | "flip-in" | "flip-out";

export type BulletinSection = {
  key: string;
  title: string;
  hint: string;
  tone: BulletinTone;
  items: BulletinRow[];
};

function topN(
  rows: BulletinRow[],
  pred: (r: BulletinRow) => boolean,
  compare: (a: BulletinRow, b: BulletinRow) => number,
  n = 3,
): BulletinRow[] {
  return [...rows].filter(pred).sort(compare).slice(0, n);
}

/** 依當日／3日／5日關係組出公布欄；四組固定回傳 */
export function buildFlowBulletin(rows: BulletinRow[]): BulletinSection[] {
  const list = rows.filter(
    (r) =>
      Number.isFinite(r.dayFlow) &&
      Number.isFinite(r.d3Flow) &&
      Number.isFinite(r.d5Flow),
  );

  return [
    {
      key: "steady-in",
      title: "持續流入",
      hint: "當日、3 日、5 日淨流皆為正——錢持續進場",
      tone: "in",
      items: topN(
        list,
        (r) => r.dayFlow > 0 && r.d3Flow > 0 && r.d5Flow > 0,
        (a, b) => b.dayFlow - a.dayFlow,
      ),
    },
    {
      key: "steady-out",
      title: "持續流出",
      hint: "當日、3 日、5 日淨流皆為負——錢持續出場",
      tone: "out",
      items: topN(
        list,
        (r) => r.dayFlow < 0 && r.d3Flow < 0 && r.d5Flow < 0,
        (a, b) => a.dayFlow - b.dayFlow,
      ),
    },
    {
      key: "flip-in",
      title: "今日轉強",
      hint: "當日轉為淨流入，但近 3 日仍偏流出——短線資金回流",
      tone: "flip-in",
      items: topN(
        list,
        (r) => r.dayFlow > 0 && r.d3Flow <= 0,
        (a, b) => b.dayFlow - a.dayFlow,
      ),
    },
    {
      key: "flip-out",
      title: "今日轉弱",
      hint: "當日轉為淨流出，但近 3 日仍偏流入——短線資金撤退",
      tone: "flip-out",
      items: topN(
        list,
        (r) => r.dayFlow < 0 && r.d3Flow >= 0,
        (a, b) => a.dayFlow - b.dayFlow,
      ),
    },
  ];
}
