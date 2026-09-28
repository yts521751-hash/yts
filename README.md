# 金流看板

台股板塊資金流觀測——把成交、漲跌與法人買賣超攤成流入／流出，並提供產業日線、成交排行與價值選股。

## 功能

- **資金流排行榜**：板塊／個股可切換當日、3 日、5 日成交額與淨流；公布欄四組固定顯示（持續流入／流出、今日轉強／轉弱，無標的也保留空狀態）
- **個股欄位**：最近月營收 YoY（證交所／櫃買公開月營收）、EPS 成長率（全市場法人報告共識：各家外資預估 EPS **中位數**；失敗時回退 Yahoo／近四季財報年增）
- **四態**：強勢／輪動／觀望／出場
- **板塊明細成分股**：顯示股價，並可切換當日／3 日／5 日看個股成交與淨流
- **產業日線**：成分股成交金額加權合成＋均線＋流入／流出柱
- **成交金額排行 Top 50**：上市＋上櫃**普通股**（已排除 ETF）；金額採**一般成交**口徑（證交所總成交 − 盤後定價 − 零股 − 鉅額，對齊 Yahoo／媒體）；**每日收盤後**隨日終大包更新（`/turnover`），不做盤中即時輪詢
- **風度儀表**：上市（證交所 FMTQIK）／上櫃（櫃買 tradingIndex）；分數是乖離＋波動「強度」而非多空，均線結構另以標籤顯示（`/wind`）
- **產業均線掃描**：找出站上五日／十日線的官方產業指數（`/ma`）；篩選含「兩線之上」
- **價值選股**：明年 EPS YoY（法人中位數）&gt; 50%，前瞻本益比（股價÷明年 EPS）&lt; 35，且當日一般成交 ≥ 10 億（`/value`）
- **波動情緒**：參考 CBOE VIX 與台股近約 20 日實現波動（非當日漲跌）
- **定時／灰度（日終大包）**：週一至週五 **18:00／18:30／19:00** 採**增量缺口同步**——只向證交所／櫃買補「水位之後」缺的交易日，已有 `quotes-*`／`insti-*` 略過；若日終大包已對齊最新交易日且 artifacts 齊則略過衍生重算。手動「同步資料」同邏輯。
- **產業日線深度**：報價歷史預設約 **60 根**（夠算 MA5／MA10）
- **08:50** 開盤前輕量暖機；各頁（含成交排行）以日終大包快照為主
- **本機快取**：瀏覽器也先畫上次資料再背景核對，減少冷啟動空白
- **持久快照**：本機寫 `.cache`／`CACHE_DIR`；可接 **Cloudflare R2**（網站功能所需快取皆 write-through／hydrate），redeploy 後自動還原，步驟見 [R2_SETUP.md](./R2_SETUP.md)；亦可掛磁碟到 `/data/cache`
- 字級、淺／深色

## 資料來源

臺灣證券交易所、證券櫃檯買賣中心公開資料（非寫死）。API 會標 `dataProvenance: twse+tpex-public`；僅在完全沒有快取時才回示範資料並標 `isDemo: true`。

### 日終大包與讀取路徑（皆經 R2 write-through／hydrate）

| 資料 | 快取檔 | 開頁讀取 |
|------|--------|----------|
| 板塊資金流 | `flow-active.json`（及 staging／last-close） | `/`、`/api/flow` |
| 日報價／法人 | `quotes-*.json`、`insti-*.json` | K 線／個股／排行 |
| 一般成交排除 | `turnover-exclude-*.json` | 成交排行口徑 |
| 產業 K 線 | `kline-*.json` | `/sectors/[id]`、均線掃描 |
| 個股資金流 | `flow-stocks-latest.json` | `/api/stocks` |
| 風度 | `wind-gauge-*.json`、指數序列 | `/wind`、`/api/wind` |
| 均線掃描 | `ma-screener-active.json` | `/ma`、`/api/ma-screener` |
| 價值選股 | `value-picks-latest.json` | `/value`、`/api/value` |
| 成交排行 | `turnover-ranking-latest.json` | `/turnover`、`/api/turnover` |
| 基本面 | `fundamentals-*.json` | 個股／價值選股 |
| 產業／主題 | `industry-map.json`、`auto-themes.json` | 板塊宇宙 |
| 大包索引 | `daily-close-meta.json` | deploy／同步短路 |

編排程式：`src/lib/daily-close-package.ts`；缺口邏輯：`src/lib/gap-sync.ts`／`fillTradingDayGaps`。
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

步驟與注意事項見 [DEPLOY.md](./DEPLOY.md)。R2 外掛快取逐步設定見 [R2_SETUP.md](./R2_SETUP.md)。

## API

- `GET /api/flow`（`?force=1` 背景重建）
- `GET /api/stocks?limit=50`（`&force=1` 重算個股金流）
- `GET /api/sector/[id]?days=80`
- `GET /api/turnover?limit=50`（`&force=1` 重算一般成交排行；日終快照）
- `GET /api/wind`（`?force=1` 觸發背景重建）
- `GET /api/value`（`?force=1` 重算價值選股）
- `GET /api/ma-screener`（`?force=1` 缺 K 線時補建）

## 技術

Next.js（App Router）+ TypeScript + Tailwind + shadcn/ui + node-cron

## 免責

僅供研究參考，不構成投資建議。
