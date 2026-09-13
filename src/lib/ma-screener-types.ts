/** Client／Server 共用型別（勿放 server-only） */

export type MaScreenerRow = {
  id: string;
  name: string;
  close: number;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  bias5: number | null;
  bias10: number | null;
  bias20: number | null;
  above5: boolean;
  above10: boolean;
  above20: boolean;
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
    ma20: number;
    all3: number;
    total: number;
  };
};
