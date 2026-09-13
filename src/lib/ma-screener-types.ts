/** Client／Server 共用型別（勿放 server-only） */

export type MaScreenerRow = {
  id: string;
  name: string;
  close: number;
  ma5: number | null;
  ma10: number | null;
  /** 保留欄位（圖表／相容舊快取）；產業掃描不再用月線篩選 */
  ma20: number | null;
  bias5: number | null;
  bias10: number | null;
  bias20: number | null;
  above5: boolean;
  above10: boolean;
  above20: boolean;
  /** 兩線之上：同時站上 MA5／MA10 */
  aboveAll: boolean;
  aboveCount: number;
  /** 近 5 日成交金額合計（億） */
  amt5: number;
  /** 近 5 日淨流入合計（億） */
  flow5: number;
  asOf: string | null;
  bars: number;
};

export type MaScreenerPayload = {
  rows: MaScreenerRow[];
  builtAt: string;
  asOf: string | null;
  source: "cache" | "mixed";
  counts: {
    ma5: number;
    ma10: number;
    /** @deprecated 掃描已移除月線；相容舊快取時可能仍有值 */
    ma20: number;
    /** 兩線之上（MA5＋MA10） */
    all2: number;
    total: number;
  };
};
