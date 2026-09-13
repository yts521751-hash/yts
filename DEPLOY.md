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

## 六、注意

- 公開後任何人可開看板；僅供研究參考，請保留免責聲明。
- TWSE／TPEx／第三方 API 有頻率限制；單一長駐實例即可，勿水平擴太多副本。
- Quick Tunnel 網址會變且會隨 Agent 結束失效；正式對外請用 Render／Fly。
