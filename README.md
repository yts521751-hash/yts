# 金潮 JinChao

台股板塊金流觀測——「成交×漲跌（80%）＋法人買賣超（20%）」換算流入／流出，並提供產業日線、成交排行與熱議新聞。

## 功能

- **資金流排行榜**：當日淨流、近 5／20 日流、加速度、量能熱度、CP
- **四態**：漲潮／輪動／觀望／退潮（淨流方向 × 加速度）
- **產業日線**：成分股成交金額加權合成＋MA5／10／20／60＋流入／流出柱
- **當日成交金額排行**：全市場個股純成交金額排序（`/turnover`）
- **熱議新聞**：Google 新聞 RSS，每 10 分鐘灰度更新（`/news`）
- **灰度同步**：背景寫 staging → 原子切 active
- **白話小百科**、字級、淺／深色

## 板塊怎麼分類？

人工維護的「題材／供應鏈」名單（非證交所官方產業代碼），每板塊約 8～12 檔代表性個股，可跨板塊。詳見小百科。

## 情緒／恐慌指標

依加權指數當日漲跌幅分檔的簡化溫度計（非 VIX）。詳見小百科。

## 資金流公式

```
softSign(漲跌%) ≈ tanh(漲跌% / 2.5)
價量流（億）＝ 成交金額（億）× softSign(漲跌%)
法人流（億）＝ 三大法人買賣超股數 × 收盤價 / 1e8
單日資金流 ＝ 0.8 × 價量流 ＋ 0.2 × 法人流
```

## 資料來源

- 行情／法人 → `.cache/quotes-*.json`、`insti-*.json`
- 資金流 active → `.cache/flow-active.json`
- 新聞 active → `.cache/news-active.json`（每 10 分鐘 staging→active）
- 產業日線 → `.cache/kline-*.json`

API：

- `GET /api/flow`（`?force=1` 背景重建）
- `GET /api/sector/[id]?days=80`
- `GET /api/turnover?limit=100`
- `GET /api/news`（`?force=1` 觸發新聞灰度更新）

## 自動同步

- 行情／法人：週一至週五台北 18:00／18:30／19:00
- 新聞：每 10 分鐘（`NEWS_CRON` 可覆寫，預設 `*/10 * * * *`）

```bash
SYNC_CRON="0 18 * * 1-5;0 19 * * 1-5"
SYNC_TZ="Asia/Taipei"
SYNC_DISABLED=1
NEWS_CRON="*/10 * * * *"
```

## 本機執行

```bash
npm install
npm run build && npm run start
# 或開發：npm run dev
```

開啟 [http://127.0.0.1:43127](http://127.0.0.1:43127)。

## 技術

Next.js（App Router）+ TypeScript + Tailwind + shadcn/ui + node-cron

## 免責

僅供研究參考，不構成投資建議。
