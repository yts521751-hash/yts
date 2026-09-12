"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 欄位標題懸停說明（成交額、淨流等） */
export const COLUMN_TIPS = {
  amt: "當日（或區間）成交金額合計，單位：億元。",
  amt5: "近 5 個交易日成交金額合計，單位：億元。",
  flow: "當日淨資金流＝成交金額×漲跌方向軟訊號×80%＋法人買賣超金額×20%，單位：億元。",
  flow5: "近 5 個交易日淨資金流合計，單位：億元。",
  flow20: "近 20 個交易日淨資金流合計，單位：億元。",
  accel: "近 5 日日均淨流減去近 20 日日均淨流；正值表示資金加速流入。",
  heat: "近 5 日日均成交 ÷ 近 20 日日均成交；大於 1 表示近期量能放大。",
  changePct: "當日股價漲跌幅（%）。",
  priceChange20d: "近 20 個交易日股價漲幅（%）。",
  cp: "綜合資金流與漲幅的相對效率參考分數，愈高表示單位漲幅帶進的資金效益愈好。",
  close: "最近一筆成交價／收盤價。",
} as const;

export function ColumnTip({
  tip,
  children,
  className,
}: {
  tip: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "cursor-help border-b border-dotted border-muted-foreground/50",
              className,
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-left leading-relaxed">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
