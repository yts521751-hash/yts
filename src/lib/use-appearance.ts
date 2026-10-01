"use client";

import { useCallback, useEffect, useState } from "react";

export type TextSize = "sm" | "md" | "lg";

export const TEXT_SIZE_KEY = "jinchao_text";
export const THEME_KEY = "jinchao_theme";

function readTextSize(): TextSize {
  if (typeof document === "undefined") return "sm";
  const current = document.documentElement.dataset.textsize;
  return current === "md" || current === "lg" ? current : "sm";
}

/**
 * 字級與深淺色：全站共用（原本只有首頁管得到，進子頁就失效）。
 * 首次套用由 layout 的 inline script 在 paint 前完成，這裡只負責同步與切換。
 */
export function useAppearance() {
  const [textSize, setTextSizeState] = useState<TextSize>("sm");
  const [dark, setDarkState] = useState(false);

  useEffect(() => {
    setTextSizeState(readTextSize());
    setDarkState(document.documentElement.classList.contains("dark"));
  }, []);

  const setTextSize = useCallback((next: TextSize) => {
    setTextSizeState(next);
    document.documentElement.dataset.textsize = next;
    try {
      localStorage.setItem(TEXT_SIZE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleDark = useCallback(() => {
    setDarkState((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem(THEME_KEY, next ? "dark" : "light");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { textSize, setTextSize, dark, toggleDark };
}
