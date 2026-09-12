# 金潮 JinChao

台股板塊金流觀測——用「成交金額 × 股價漲跌幅」換算流入／流出，並提供產業合成 K 線。

## 功能

- **資金流排行榜**：當日淨流、近 5／20 日流、加速度、量能熱度、CP
- **四態**：漲潮／輪動／觀望／退潮（淨流方向 × 加速度）
- **產業合成 K 線**：成分股成交金額加權融合（類似三竹族群圖）＋流入／流出柱
- **灰度同步**：背景寫 staging → 原子切 active，開網頁不需等待抓檔
- **白話小百科**、字級、淺／深色

## 資金流公式

```
softSign(漲跌%) ≈ tanh(漲跌% / 2.5)
單日資金流（億）＝ 成交金額（億）× softSign(漲跌%)
流入＝正的部分；流出＝負的絕對值；淨流＝流入 − 流出
```

板塊數字為成分股加總。狀態由近 5 日淨流正負與「5 日均流 − 20 日均流」決定。

## 資料來源

- 上市／上櫃：證交所、櫃買「每日收盤行情」（成交金額、開高低收、漲跌）
- 日行情快取於 `.cache/quotes-YYYYMMDD.json`
- 對外服務檔：`.cache/flow-active.json`（灰度切換自 `flow-staging.json`）

API：

- `GET /api/flow` — 讀 active（`?force=1` 觸發背景重建，不阻塞）
- `GET /api/sector/[id]?days=40` — 產業 K 線與流入流出序列

## 自動同步

預設週一至週五台北時間 18:00／18:30／19:00 灰度同步。

```bash
SYNC_CRON="0 18 * * 1-5;0 19 * * 1-5"
SYNC_TZ="Asia/Taipei"
SYNC_DISABLED=1   # 關閉
```

## 本機執行

```bash
npm install
npm run build && npm run start
# 或開發：npm run dev
```

開啟 [http://127.0.0.1:43127](http://127.0.0.1:43127)。

建議用 `start` 常駐，排程與灰度同步才穩定；首次若無 active 會回示範資料並背景暖機。

## 技術

Next.js（App Router）+ TypeScript + Tailwind + shadcn/ui + node-cron

## 免責

僅供研究參考，不構成投資建議。
