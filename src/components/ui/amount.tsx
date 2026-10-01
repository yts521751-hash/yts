import { cn } from "@/lib/utils";

/**
 * 金額顯示：把單位（億／億美元）降一階，數值才是視覺主角。
 * 傳入 formatYi／formatMarketYiSigned 等既有格式字串，語意與單位完全不變。
 */
export function Amount({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const idx = text.indexOf(" ");
  if (idx < 0) {
    return <span className={cn("num", className)}>{text}</span>;
  }
  return (
    <span className={cn("num whitespace-nowrap", className)}>
      {text.slice(0, idx)}
      <span className="unit">{text.slice(idx + 1)}</span>
    </span>
  );
}
