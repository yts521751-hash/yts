# 金流看板

台股板塊資金流觀測——把成交、漲跌與法人買賣超攤成流入／流出，並提供產業日線、成交排行與熱議新聞。

## 功能

- **資金流排行榜**：板塊／個股可切換當日、3 日、5 日成交額與淨流；公布欄四組固定顯示（持續流入／流出、今日轉強／轉弱，無標的也保留空狀態）
- **個股欄位**：最近月營收 YoY（證交所／櫃買公開月營收）、EPS 成長率（全市場法人報告共識：各家外資預估 EPS 平均；失敗時回退 Yahoo／近四季財報年增）
- **四態**：強勢／輪動／觀望／出場
- **板塊明細成分股**：可切換當日／3 日／5 日看個股成交與淨流
- **產業日線**：成分股成交金額加權合成＋均線＋流入／流出柱
- **成交金額排行 Top 50**：盤中約每 **3 秒** 重抓證交所／櫃買公開行情並刷新表格（`/turnover`）；休市仍輪詢時間戳，週一開盤自動切即時
- **風度儀表**：上市（證交所 FMTQIK）／上櫃（櫃買 tradingIndex）；分數是乖離＋波動「強度」而非多空，均線結構另以標籤顯示（`/wind`）
- **產業均線掃描**：找出站上五日／十日線的官方產業指數（`/ma`）；篩選含「兩線之上」
- **熱議新聞**：成交 Top 50 相關，並優先「熱門族群」標題；約每 **5 分鐘** 同步（`/news`）
- **波動情緒**：參考 CBOE VIX 與台股近約 20 日實現波動（非當日漲跌）
- **定時／灰度（日終大包）**：週一至週五 **18:00／18:30／19:00** 一次向證交所／櫃買拉齊網站會用的盤後資料（資金流、近約 **60 個交易日**報價／法人、產業 K 線、個股資金流、風度、均線掃描、收盤成交排行），寫入 `.cache` 快照；之後各頁開頁**只讀快照**，不再為了載入去打交易所
- **產業日線深度**：報價歷史預設拉到約 **60 根**（夠算 MA5／MA10；縮短同步時間）
- **盤中即時例外**：只有 **成交金額排行**（`/turnover`）盤中約每 3 秒重抓；其餘頁面等 18:00 大包更新
- **08:50** 開盤前輕量暖機；**新聞**另約每 5 分鐘同步（非證交所 EOD）
- **本機快取**：瀏覽器也先畫上次資料再背景核對，減少冷啟動空白
- **持久快照（`CACHE_DIR`）**：正式環境請掛磁碟到 `/data/cache`，與程式發佈分離；重發佈後歷史日檔仍在，每天同步只補缺日／當日
- 字級、淺／深色

## 資料來源

臺灣證券交易所、證券櫃檯買賣中心公開資料（非寫死）。API 會標 `dataProvenance: twse+tpex-public`；僅在完全沒有快取時才回示範資料並標 `isDemo: true`。

### 日終大包與讀取路徑

| 資料 | 18:00 大包寫入 | 開頁讀取 |
|------|----------------|----------|
| 板塊資金流 | `flow-active.json`（灰度自 staging） | `/`、`/api/flow` |
| 日報價／法人 | `quotes-*.json`、`insti-*.json` | 供 K 線／個股／排行重算 |
| 產業 K 線 | `kline-*.json` | `/sectors/[id]`、均線掃描 |
| 個股資金流 | `flow-stocks-latest.json` | `/api/stocks` |
| 風度 | `wind-gauge-*.json` | `/wind`、`/api/wind` |
| 均線掃描 | `ma-screener-active.json` | `/ma`、`/api/ma-screener` |
| 收盤成交排行 | turnover 快取 | `/turnover`（休市） |
| 盤中成交排行 | — | `/api/turnover?live=1` **唯一即時** |
| 大包索引 | `daily-close-meta.json` | deploy 狀態／除錯 |

編排程式：`src/lib/daily-close-package.ts`（排程 `runSync` 呼叫）。
## 本機執行

```bash
npm install
npm run build && npm run start
# 或開發：npm run dev
```

預設綁定 `0.0.0.0:43127`（雲端會讀 `PORT`）。本機開啟 [http://127.0.0.1:43127](http://127.0.0.1:43127)。

## 公開發布／持續迭代

需要長駐 Node（排程＋快取）。已附：

- `render.yaml` → Render Blueprint，連 GitHub 後 **push `main` 自動重發**
- `Dockerfile` + `fly.toml` → Fly.io；可選 GitHub Secret `FLY_API_TOKEN` 自動部署
- `.github/workflows/ci.yml` → 每次推送驗證 `npm run build`

步驟與注意事項見 [DEPLOY.md](./DEPLOY.md)。

## API

- `GET /api/flow`（`?force=1` 背景重建）
- `GET /api/stocks?limit=50`（`&force=1` 重算個股金流）
- `GET /api/sector/[id]?days=80`
- `GET /api/turnover?limit=50`（`&live=1` 盤中重抓；約 3 秒 TTL）
- `GET /api/wind`（`?force=1` 觸發背景重建）
- `GET /api/news`（`?force=1` 觸發新聞更新）
- `GET /api/ma-screener`（`?force=1` 缺 K 線時補建）

## 技術

Next.js（App Router）+ TypeScript + Tailwind + shadcn/ui + node-cron

## 免責

僅供研究參考，不構成投資建議。
