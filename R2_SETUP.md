# Cloudflare R2 快取外掛（逐步設定）

程式端已接好：有設定下列環境變數時，寫入 `.cache` 會同步上傳到 R2；開機會從 R2 還原，**redeploy 後不必整包重同步**。

你需要在 Cloudflare 建好 Bucket 與 API Token，再把金鑰貼到本機／Render／Fly 環境變數。**金鑰只能你自己建立**（我無法登入你的 Cloudflare）。

免費額度通常夠用（每月 10GB 儲存、每月百萬級 Class A／B 操作）；看板快取多為 JSON，體積很小。

---

## 一、在 Cloudflare 建立 R2 Bucket

1. 開啟 [Cloudflare Dashboard](https://dash.cloudflare.com/) 並登入
2. 左側選 **R2 Object Storage**（若尚未開通，依畫面啟用 R2）
3. 按 **Create bucket**
   - **Bucket name：** 例如 `jinliu-cache`（全域唯一，可自訂）
   - **Location：** 預設 Automatic 即可
4. 建立完成後記下 bucket 名稱

---

## 二、取得 Account ID

1. 仍在 R2 總覽頁右上／右側會顯示 **Account ID**（一串 32 字元 hex）
2. 複製起來 → 之後填 `R2_ACCOUNT_ID`

也可：Dashboard 任一頁右欄 **Account ID**。

---

## 三、建立 API Token（S3 相容金鑰）

1. R2 總覽 → **Manage R2 API Tokens**（或 **Account API Tokens** 裡與 R2 相關的入口）
2. **Create API token**
   - **Token name：** 例如 `jinliu-board`
   - **Permissions：** **Object Read & Write**（需要讀＋寫）
   - **Specify bucket：** 選剛建的 `jinliu-cache`（或 Apply to all buckets）
   - **TTL：** 可留空白（不過期）或自訂
3. 建立後會顯示一次：
   - **Access Key ID** → `R2_ACCESS_KEY_ID`
   - **Secret Access Key** → `R2_SECRET_ACCESS_KEY`
4. **立刻複製並存好**；關掉後 Secret 不會再顯示

Endpoint 預設為：

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

一般不必手動設 `R2_ENDPOINT`（程式會用 Account ID 組出來）。

---

## 四、環境變數一覽

| 變數 | 必填 | 說明 |
|------|------|------|
| `R2_ACCOUNT_ID` | ✅ | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | ✅ | R2 API Token 的 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | ✅ | R2 API Token 的 Secret |
| `R2_BUCKET` | ✅ | Bucket 名稱，例如 `jinliu-cache` |
| `R2_PREFIX` | 可選 | 物件前綴，預設 `jinliu-cache`（同一 bucket 可多專案共用） |
| `R2_ENDPOINT` | 可選 | 預設 `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |

本機：複製 `.env.example` → `.env.local`，填上上列變數後重啟 `npm run dev`／`npm run start`。

---

## 五、接到 Render（建議）

1. [Render Dashboard](https://dashboard.render.com/) → 你的 Web Service
2. **Environment** → **Add Environment Variable**，逐一加上：
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET`
   - （可選）`R2_PREFIX=jinliu-cache`
3. Save → 等重新 Deploy
4. 看 **Logs**：
   - 應有 `[cache] dir=... r2=on`
   - 若 bucket 已有舊快取：`[r2] hydrate done: downloaded=…`
   - 寫入時失敗會打 `[r2] upload failed …`（本機仍會寫入，不影響服務）

**Free 方案也能用 R2**（不需付費 Disk）。有 Disk 時可同時掛 `CACHE_DIR=/data/cache`：本機碟當熱快取、R2 當跨 deploy 備份。

確認 API：

```text
GET https://你的服務.onrender.com/api/flow
```

回傳 `deploy` 裡：

- `r2Enabled` 應為 `true`
- `cachePersistent` 應為 `true`

---

## 六、接到 Fly.io

```bash
fly secrets set \
  R2_ACCOUNT_ID=你的帳號ID \
  R2_ACCESS_KEY_ID=你的Key \
  R2_SECRET_ACCESS_KEY=你的Secret \
  R2_BUCKET=jinliu-cache
```

可選：`R2_PREFIX=jinliu-cache`。設完會自動重啟。

---

## 七、行為說明（程式已做完）

| 時機 | 行為 |
|------|------|
| 寫快取 | 先寫本機 `CACHE_DIR`／`.cache`，再非同步上傳同名物件到 R2（含日檔、日終大包、K 線、風度、均線、價值選股、成交排行、基本面等網站功能所需檔） |
| 讀快取 | 本機有檔直接用；沒有則從 R2 下載寫回本機再回傳 |
| 開機 | `hydrateCacheFromR2`：列出 prefix 下物件，缺檔才下載（略過已存在） |
| 手動「同步資料」／18:00 cron | **增量缺口**：以本機（通常已自 R2 hydrate）最新 `quotes-*` 為水位，只抓水位→目標交易日的缺日；已有日檔略過。日終衍生快照若 `daily-close-meta` 已對齊且 artifacts 齊則略過重算 |
| 未設定 R2 | 完全不連線，行為與以前相同（仍做本機缺口同步） |

物件 Key 形如：`jinliu-cache/flow-active.json`、`jinliu-cache/quotes-20260327.json`、`jinliu-cache/value-picks-latest.json` …

---

## 八、首次搬家（本機已有 `.cache`）

若本機已跑過日終大包、想一次推上 R2：

1. 填好 `.env.local` 的 R2 變數
2. 啟動服務後，正常同步／寫入會陸續上傳；或在 Node REPL／暫時腳本呼叫：

```ts
import { getCacheDir } from "./src/lib/tw-market";
import { uploadLocalCacheDirToR2 } from "./src/lib/r2-cache";
await uploadLocalCacheDirToR2(getCacheDir());
```

之後雲端開機 hydrate 即可還原。

---

## 九、常見問題

- **`r2=off`：** 四個必填變數有缺或拼錯；改完要重啟行程。
- **hydrate 0、upload failed：** 檢查 Token 權限是否含該 bucket、Account ID／Bucket 名稱是否正確。
- **`write EPROTO`／`ssl/tls alert handshake failure`／`SSL alert number 40`：**
  - 多半是連到錯誤 hostname（虛擬主機式 `bucket.<account>.r2…` 不在 R2 憑證範圍）。程式已強制 **path-style**（`https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>/…`）。
  - 請在 Render 核對：`R2_ACCOUNT_ID` 為 Dashboard 32 字元 hex（不要用 Zone ID）；`R2_ENDPOINT` 若有設，必須是 `https://<同一 ACCOUNT_ID>.r2.cloudflarestorage.com`（**不要**含 bucket 名、不要 `http://`）。
  - 用本機／任何機器測：`curl -Iv "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com/"` — 若這裡也握手失敗，是 Cloudflare 該 account endpoint 憑證尚未就緒（偶發，等或開 ticket），不是 Render deploy 壞掉。
- **Secret 洩漏：** 到 R2 API Tokens 撤銷舊 token，建新的並更新環境變數。
- **不要把金鑰 commit 進 git**；只放環境變數／`.env.local`（已 gitignore）。
