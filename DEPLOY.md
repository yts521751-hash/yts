# 公開發布與持續迭代

本服務需要**長駐 Node 行程**（盤後排程、`.cache` 快取），請用 Render／Fly 這類 Web Service，不要用純靜態站或純 Serverless。

## 現況

- 本機／Cloud Agent 可暫時用 Cloudflare Quick Tunnel 對外（僅此環境存活期間有效）。
- 長期公開網址：把程式推到 GitHub，再接 Render（建議先做）或 Fly。

## 一、先建立 GitHub 倉庫

若還在 Cursor 暫存專案：點介面上的 **Create repo**，建立真實 GitHub 倉庫並推送 `main`。

之後每次功能調整：

```bash
git add -A && git commit -m "…" && git push origin main
```

## 二、建議：Render 一鍵託管（自動重發）

1. 開啟 [Render Blueprints](https://dashboard.render.com/blueprints)
2. 連線剛建立的 GitHub 倉庫，選擇 repo 根目錄的 `render.yaml`
3. 建立服務（建議至少 Starter，避免 Free 休眠導致排程中斷）
4. 完成後會得到 `https://….onrender.com`

之後 **push `main` → Render 自動 build／deploy**，無需再手動操作。

本機驗證 build：

```bash
npm ci && npm run build && npm run start
```

## 三、備選：Fly.io（長駐＋GitHub Actions）

```bash
# 本機已安裝 flyctl、已 fly auth login
fly launch --no-deploy   # 第一次可改 app 名稱；已有 fly.toml 可略過
fly deploy
```

持續迭代：

1. GitHub → Settings → Secrets and variables → Actions
2. 新增 `FLY_API_TOKEN`（`fly tokens create deploy` 產生）
3. push `main` 後，`.github/workflows/deploy-fly.yml` 會自動 `fly deploy`

未設定 token 時該 workflow 會略過，不影響 CI。

## 四、CI

`.github/workflows/ci.yml`：每次 PR／push `main` 跑 `npm ci && npm run build`，擋掉壞掉的發布。

## 五、環境變數（可選）

見 `.env.example`：`SYNC_DISABLED`、`SYNC_TZ`、`SYNC_CRON`。雲端後台加同名環境變數即可，不必把密鑰寫進 repo。

## 六、快取與重發佈（重要）

所有日終快照、報價日檔（`quotes-*.json`）、產業 K、進度等都寫在 **`CACHE_DIR`**，**不要跟程式碼／映像綁在一起**。

| 環境 | 建議 |
|------|------|
| 本機 | 可不設 → 預設專案內 `.cache`（已 gitignore） |
| Fly | `fly volumes create jinliu_cache --region nrt --size 1`，`fly.toml` 已掛 `/data/cache`，`CACHE_DIR=/data/cache` |
| Render | 見下方「Render 掛 Disk」；需 **Starter** 以上 |

行為：

- **已有的歷史日檔不會因重發佈被清掉**（只要掛了持久碟）。
- 日終／背景同步會**跳過已存在的交易日**，只補缺日與當日，不必每天重抓整段歷史。
- 開機 log 會印 `[cache] dir=...`，可確認是否指到磁碟。

未掛持久碟時，每次 deploy 仍會從空快取冷啟動（資料會短暫不完整，直到大包跑完）。

### Render 掛 Disk（逐步）

**前提：** Web Service 方案至少是 **Starter**（Free 不能掛持久碟，且會休眠）。

#### A. 還沒建服務：用 Blueprint（最省事）

1. 開啟 [Render Blueprints](https://dashboard.render.com/blueprints)
2. Connect 你的 GitHub repo，選根目錄的 `render.yaml`
3. 確認方案是 **Starter**（yaml 已寫 `plan: starter`）
4. 建立服務——yaml 已包含：
   - Disk 名稱 `jinliu-cache`
   - 掛載路徑 `/data/cache`
   - 容量 `2GB`
   - 環境變數 `CACHE_DIR=/data/cache`
5. 等第一次 Deploy 變綠燈

#### B. 服務已經存在：在 Dashboard 手動加 Disk

1. 開啟 [Render Dashboard](https://dashboard.render.com/) → 點你的 Web Service（例如 `jinliu-board`）
2. 左側 **Settings**
3. 若目前是 **Free**：先到 **Plan** 升成 **Starter**（或以上）並套用
4. 同一頁找 **Disk**（有的介面在 **Disks**）→ **Add Disk**
   - **Name：** `jinliu-cache`（任意，好認即可）
   - **Mount Path：** 必須是 `/data/cache`（不要用別的路徑）
   - **Size：** `1` 或 `2` GB 即可
5. **Save** 後 Render 會重新部署一次
6. 再到 **Environment**，新增／確認：
   - Key：`CACHE_DIR`
   - Value：`/data/cache`
7. Save → 等 Deploy 完成

#### C. 確認有掛成功

1. 打開網站：`https://你的服務.onrender.com/api/flow`
2. 看回傳的 `deploy` 欄位：
   - `cacheDir` 應為 `/data/cache`
   - `cachePersistent` 應為 `true`
   - `quoteDays` 理想接近 `60`（第一次會較少）
3. 或看 Render → **Logs**：應有 `[cache] dir=/data/cache`
4. 若 `quoteDays` 很少：回首頁按一次「補齊／更新歷史資料」，等進度跑完（可能要一段時間）

之後 push 程式重發佈，**Disk 裡的歷史日檔會留下**，不必每次重抓全部歷史。

## 七、注意

- 公開後任何人可開看板；僅供研究參考，請保留免責聲明。
- TWSE／TPEx／第三方 API 有頻率限制；單一長駐實例即可，勿水平擴太多副本（多副本需共享同一 `CACHE_DIR`／物件儲存）。
- Quick Tunnel 網址會變且會隨 Agent 結束失效；正式對外請用 Render／Fly。
