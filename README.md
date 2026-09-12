# 金潮 JinChao

台股板塊金流觀測——成交×漲跌與法人買賣超換算流入／流出，並提供產業日線、成交排行與熱議新聞。

## 功能

- **資金流排行榜**：當日淨流、近 5／20 日流、加速度、量能熱度、CP
- **四態**：漲潮／輪動／觀望／退潮
- **產業日線**：成分股成交金額加權合成＋均線＋流入／流出柱
- **成交金額排行 Top 50**：盤中約每 30 秒刷新（`/turnover`）
- **熱議新聞**：只顯示成交 Top 50 相關個股新聞（`/news`）
- **灰度同步**：背景寫 staging → 原子切 active
- 字級、淺／深色

## 本機執行

```bash
npm install
npm run build && npm run start
# 或開發：npm run dev
```

開啟 [http://127.0.0.1:43127](http://127.0.0.1:43127)。

## API

- `GET /api/flow`（`?force=1` 背景重建）
- `GET /api/sector/[id]?days=80`
- `GET /api/turnover?limit=50`（`&live=1` 盤中重抓）
- `GET /api/news`（`?force=1` 觸發新聞更新）

## 技術

Next.js（App Router）+ TypeScript + Tailwind + shadcn/ui + node-cron

## 免責

僅供研究參考，不構成投資建議。
