"use client";

import { cn } from "@/lib/utils";
import { resolveUsDisplayNames } from "@/lib/us-company-names";

type Props = {
  code: string;
  /** 英文全名（優先） */
  nameEn?: string | null;
  /** 中文短名（優先） */
  nameZh?: string | null;
  /** 合併顯示名或 Yahoo 英文名（回退） */
  name?: string | null;
  className?: string;
  /**
   * stack：英文主列＋中文次列（手機卡片）
   * compact：單列截斷 EN（ZH）（桌面／窄欄）
   */
  variant?: "stack" | "compact";
  /** 主列是否加粗（預設 true） */
  emphasize?: boolean;
};

function parseCombinedName(name: string): { en: string; zh: string } {
  const m = name.match(/^(.+?)（([^）]+)）\s*$/);
  if (m) return { en: m[1].trim(), zh: m[2].trim() };
  return { en: name.trim(), zh: "" };
}

/** 美股中英名稱：截斷可掃、title 顯示全名 */
export function UsStockName({
  code,
  nameEn,
  nameZh,
  name,
  className,
  variant = "stack",
  emphasize = true,
}: Props) {
  let en = (nameEn || "").trim();
  let zh = (nameZh || "").trim();

  if (!en || !zh) {
    if (name) {
      const parsed = parseCombinedName(name);
      en = en || parsed.en;
      zh = zh || parsed.zh;
    }
  }

  if (!en || !zh) {
    const resolved = resolveUsDisplayNames({
      code,
      yahooName: en || name || undefined,
    });
    en = en || resolved.nameEn;
    zh = zh || resolved.nameZh;
  }

  const enShow = en || code;
  const showZh = Boolean(zh && zh !== enShow);
  const full = showZh ? `${enShow}（${zh}）` : enShow;

  if (variant === "compact") {
    return (
      <span className={cn("min-w-0 truncate", className)} title={full}>
        <span className={cn(emphasize && "font-medium")}>{enShow}</span>
        {showZh ? (
          <span className="text-muted-foreground">（{zh}）</span>
        ) : null}
      </span>
    );
  }

  return (
    <div className={cn("min-w-0", className)} title={full}>
      <p
        className={cn(
          "truncate leading-snug",
          emphasize ? "font-medium" : "font-normal",
        )}
      >
        {enShow}
      </p>
      {showZh ? (
        <p className="truncate text-[11px] leading-snug text-muted-foreground">
          {zh}
        </p>
      ) : null}
    </div>
  );
}
