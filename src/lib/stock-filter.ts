/**
 * 台股普通股篩選：排除 ETF／ETN／權證等，避免成交排行被 0050 等指數型商品佔滿。
 */

const ETF_NAME_RE =
  /ETF|ETN|指數股票型|槓桿|反向|期貨信託|債券ETF|受益憑證|指數型證券/;

/** 四碼普通股（含 KY）；排除 00xx ETF 與名稱明顯為指數型商品者 */
export function isCommonStock(code: string, name?: string): boolean {
  const c = String(code ?? "").trim();
  if (!/^\d{4}$/.test(c)) return false;
  // 00xx：元大台灣50、富邦台50 等 ETF／指數型
  if (c.startsWith("00")) return false;
  if (name && ETF_NAME_RE.test(name)) return false;
  return true;
}
