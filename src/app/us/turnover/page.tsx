"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatPct, formatUsTurnoverYi, signedClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UsStockName } from "@/components/us-stock-name";
import { COLUMN_TIPS, ColumnTip } from "@/components/column-tip";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/ui/panel";
import { ActionButton } from "@/components/ui/action-button";
import { Amount } from "@/components/ui/amount";
import { RankSlot } from "@/components/ui/chip";
import { ErrorState, LoadingState } from "@/components/ui/states";

type Row = {
  rank: number;
  code: string;
  name: string;
  nameEn?: string;
  nameZh?: string;
  dayAmt: number;
  changePct: number;
  close: number;
  volume?: number;
  volumeSource?: string;
};

export default function UsTurnoverPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [date, setDate] = useState("");
  const [basis, setBasis] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/us/turnover?limit=50${force ? "&force=1" : ""}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!json.ok || !json.rows?.length) {
        throw new Error(json.error || "尚無美股成交排行，請先同步");
      }
      setRows(json.rows);
      setDate(json.date || "");
      setBasis(json.amountBasis || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <AppShell
      market="us"
      width="default"
      back={{ href: "/us", label: "回美股資金流" }}
      eyebrow="US TURNOVER TOP 50"
      title="美股成交排行"
      description={
        basis ||
        "成值 ＝ 收盤價 × Nasdaq 成交股數 ÷ 1e8（單位：億美元；失敗時回退 Yahoo volume）。"
      }
      meta={date ? `資料日 ${date} · 日終快照` : "日終快照"}
      actions={
        <ActionButton
          onClick={() => void load(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw
            className={cn("size-3.5", (loading || refreshing) && "animate-spin")}
            aria-hidden
          />
          重新整理
        </ActionButton>
      }
    >
      <Panel className="overflow-hidden">
        {loading && !rows.length ? (
          <LoadingState label="載入美股成交排行…" />
        ) : error && !rows.length ? (
          <ErrorState
            description={error}
            action={
              <ActionButton size="sm" onClick={() => void load(true)}>
                再試一次
              </ActionButton>
            }
          />
        ) : (
          <>
            {/* 手機：堆疊列，避免橫向表格 */}
            <ul className="divide-y divide-line sm:hidden">
              {rows.map((r) => (
                <li
                  key={r.code}
                  className="flex min-h-[4.25rem] items-center gap-3 px-3 py-3"
                >
                  <RankSlot rank={r.rank} emphasis />
                  <div className="min-w-0 flex-1">
                    <p className="num text-[0.9375rem] font-semibold">{r.code}</p>
                    <UsStockName
                      code={r.code}
                      nameEn={r.nameEn}
                      nameZh={r.nameZh}
                      name={r.name}
                      variant="compact"
                      emphasize={false}
                      className="mt-0.5 block text-xs text-muted-foreground"
                    />
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                      <span>
                        漲跌{" "}
                        <span
                          className={cn("num font-medium", signedClass(r.changePct))}
                        >
                          {formatPct(r.changePct)}
                        </span>
                      </span>
                      <span>
                        收盤{" "}
                        <span className="num text-foreground/80">
                          {r.close.toFixed(2)}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="t-kicker">成值</p>
                    <Amount
                      text={formatUsTurnoverYi(r.dayAmt)}
                      className="text-[0.9375rem] font-semibold"
                    />
                  </div>
                </li>
              ))}
            </ul>

            {/* 桌面：表格（與台股成交排行一致） */}
            <div className="scroll-x hidden sm:block">
              <table className="data-table min-w-[640px]">
                <thead>
                  <tr>
                    <th className="w-10 text-right">#</th>
                    <th>代號</th>
                    <th>名稱</th>
                    <th className="cell-num">
                      <ColumnTip tip={COLUMN_TIPS.amt}>成值</ColumnTip>
                    </th>
                    <th className="cell-num">
                      <ColumnTip tip={COLUMN_TIPS.changePct}>漲跌</ColumnTip>
                    </th>
                    <th className="cell-num">
                      <ColumnTip tip={COLUMN_TIPS.close}>收盤</ColumnTip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code}>
                      <td className="num text-right text-muted-foreground">
                        {r.rank}
                      </td>
                      <td className="num font-medium">{r.code}</td>
                      <td>
                        <UsStockName
                          code={r.code}
                          nameEn={r.nameEn}
                          nameZh={r.nameZh}
                          name={r.name}
                          variant="stack"
                        />
                      </td>
                      <td className="cell-num font-semibold">
                        <Amount text={formatUsTurnoverYi(r.dayAmt)} />
                      </td>
                      <td className={cn("cell-num", signedClass(r.changePct))}>
                        {formatPct(r.changePct)}
                      </td>
                      <td className="cell-num text-muted-foreground">
                        {r.close.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </AppShell>
  );
}
