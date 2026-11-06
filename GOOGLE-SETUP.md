# 改用 Google 試算表 + Google Drive：設定步驟

## 架構

```
管理者（你）的「總表」試算表 + Apps Script（網站後端）
  └ teachers 工作表：老師代碼、email、題庫位置
王老師的 Google Drive：Lamby 題庫（試算表，分享給管理者）＋ Lamby 圖片（資料夾）
李老師的 Google Drive：Lamby 題庫 ＋ Lamby 圖片
…
```

- 每位老師的題目和圖片都在**老師自己的 Google Drive**，老師是擁有者
- 老師用 **Google 帳號登入**後台，只有 `teachers` 名單裡的帳號能使用
- 學生的 QR Code 網址帶有老師代碼，例如 `index.html?c=wang&id=3`
- 舊的 QR Code（網址沒有 `c=`）會讀管理者自己的題庫（代碼 `main`），不用重印
- 不再需要 GitHub 發布金鑰

管理者第一次設定約 30 分鐘；之後每加一位老師只要 1 分鐘。

---

## 管理者：第一次設定

### 步驟 1：建立總表與 Apps Script

1. 到 [Google 試算表](https://sheets.google.com) 建立空白試算表，命名為「Lamby 總表」。
2. 選單 **擴充功能 → Apps Script**。
3. 刪掉編輯器裡原本的內容，把本專案的 `apps-script/Code.gs` 全部貼上，按 💾 儲存。
   （如果儲存時出現語法錯誤，請把錯誤訊息截圖給開發者）
4. 上方函式選單選 **`setup`** → **執行**。
   - 第一次執行會要求授權：選你的帳號 →「Google 尚未驗證這個應用程式」→ **進階** → **前往（不安全）** → **允許**。
     這是你自己的程式，Google 沒有審查過，可以放心。
   - 完成後會出現 `teachers` 工作表，第一列是你自己（代碼 `main`）。

### 步驟 2：建立 Google 登入用的 OAuth 用戶端 ID

1. 打開 [Google Cloud Console](https://console.cloud.google.com/) → 左上角 **建立新專案**（名稱例如 `Lamby`）。
2. 搜尋 **Google Drive API** → **啟用**。
3. 搜尋並進入 **Google Auth Platform**（或「API 和服務 → OAuth 同意畫面」）→ **開始使用**：
   - 應用程式名稱：`Lamby 老師後台`；使用者支援 email：你的 Gmail
   - 目標對象：**外部**
   - 聯絡資訊：你的 Gmail → 完成
4. **資料存取（Data Access）** → **新增或移除範圍** → 勾選 `.../auth/drive.file`（查看及管理本應用程式建立的檔案）→ 儲存。
   這是「非敏感」範圍，不需要送 Google 審查。
5. **目標對象（Audience）** → 保持「**測試中**」，**不要**按發布。在 **測試使用者（Test users）** → **Add users**，填入你和每位老師的 Gmail（最多 100 人）。
   - 不在這份名單的帳號，Google 會直接擋下，無法登入。
   - 測試模式下，Drive 授權約 **7 天**會失效，老師按「儲存到雲端」時會自動跳出授權視窗，再按一次允許即可。
   - 第一次授權會看到「Google 尚未驗證這個應用程式」，按 **進階 → 前往（不安全）** 繼續。
   - 之後如果想免去每週重新授權，可以隨時回到這裡按「發布應用程式」。只用 email 和 `drive.file` 這兩個非敏感範圍，不用送審，也不影響已設定好的老師。
6. **用戶端（Clients）** → **建立用戶端**：
   - 應用程式類型：**網頁應用程式**
   - 已授權的 JavaScript 來源：`https://qq928672.github.io`
   - 「已授權的重新導向 URI」不用填
7. 複製 **用戶端 ID**（`xxxx.apps.googleusercontent.com`）。

### 步驟 3：部署 Apps Script

1. 回到 Apps Script，把 `Code.gs` 最上面的 `CLIENT_ID` 改成剛剛的用戶端 ID，儲存。
2. 右上角 **部署 → 新增部署作業** → 齒輪選 **網頁應用程式**：
   - 執行身分：**我**
   - 誰可以存取：**所有人**
   （修改題目時，程式會檢查 Google 登入和老師名單；學生只能讀題目）
3. 按 **部署**，複製 **網頁應用程式網址**（結尾是 `/exec`）。

> ⚠️ 之後如果修改了 `Code.gs`，要到 **部署 → 管理部署作業 → ✏️ 編輯 → 版本選「新版本」→ 部署**，新程式才會生效（網址不變）。

### 步驟 4：設定網站

編輯 `config.js`，填入兩個值後上傳到 GitHub：

```js
window.LAMBY_CONFIG = {
  API_URL: "https://script.google.com/macros/s/.../exec",
  GOOGLE_CLIENT_ID: "xxxx.apps.googleusercontent.com"
};
```

這兩個值都不是密碼，放在公開網站上沒關係。

### 步驟 5：建立你自己的題庫，並搬移現有題目

1. 打開 `https://qq928672.github.io/AR_game/admin.html` → 用 Google 登入。
2. 按 **📁 建立我的題庫** → Google 詢問 Drive 權限時按 **允許**。
3. 按後台上方的 **📥 匯入舊題目**。它會把網站上現有的 `questions.json` 題目和 `images/` 圖片，由你的瀏覽器搬進你的題庫和 Drive，並自動儲存。
4. 確認題目都在。（匯入會取代目前所有題目，所以請在新增題目之前先做。）

### 步驟 6：確認 Apps Script 的權限已鎖定（建議）

目的：讓這支程式**不具備**任何 Google Drive 檔案權限，只能處理試算表。

1. 在 Apps Script 左側 **專案設定（齒輪）** → 勾選 **「在編輯器中顯示『appsscript.json』資訊清單檔案」**。
2. 回到編輯器，打開 `appsscript.json`，內容換成本專案 `apps-script/appsscript.json` 的內容（它用 `oauthScopes` 把權限限定為：試算表、連外驗證登入、讀取你的 email）。
3. 儲存後，重新 **部署 → 管理部署作業 → ✏️ 編輯 → 新版本 → 部署**，再執行一次 `setup`，授權畫面應該**不再出現**「Google 雲端硬碟」。
4. 隨時可以到 <https://myaccount.google.com/permissions>，找到這個 Apps Script 專案，看它實際被授予的權限，也能在這裡撤銷。

權限分工：

| 誰 | 能碰什麼 |
|---|---|
| 老師的瀏覽器 | 只有老師自己的「Lamby 圖片」資料夾和「Lamby 題庫」（`drive.file`，Google 保證只能碰網站自己建立的檔案） |
| Apps Script | 只有試算表（無法再細分到「只有 Lamby 題庫」，Google 沒有這個選項；程式只會開 `teachers` 裡記錄、且擁有者驗證過的那幾份）。**完全沒有 Drive 檔案權限** |

---

## 加入一位老師

**管理者：** 要做兩件事：

1. 到 Google Cloud Console → Google Auth Platform → **目標對象** → **測試使用者** → **Add users**，加入老師的 Gmail。
2. 在總表的 `teachers` 工作表新增一列（只要填前 4 欄）：

| code | email | name | enabled |
|---|---|---|---|
| wang | wang.teacher@gmail.com | 王老師 | TRUE |

- `code`：老師代碼，會出現在學生的 QR Code 網址裡，請用**英文小寫或數字**，不要重複
- 要暫停某位老師：把 `enabled` 改成 `FALSE`
- 後面的 `sheetId`、`folderId`、`linkedAt` 會在老師建立題庫時自動填入，不要手動修改

**老師：**
1. 打開後台網址 → 用 Google 登入
2. 按 **📁 建立我的題庫** → 允許 Drive 權限
3. 開始新增題目，按 **🖨 列印 QR Code** 印出自己的 QR Code

---

## 測試清單

1. 新增一題、上傳一張圖片，按 **💾 儲存到雲端** → 老師自己 Drive 裡的「Lamby 題庫」和「Lamby 圖片」都有更新
2. 用不在名單內的帳號登入 → 顯示「沒有使用權限」
3. 用手機掃新印的 QR Code → 讀到這位老師的題目和圖片（約 1 分鐘內更新）
4. 掃舊的 QR Code → 讀到管理者（main）的題目

全部正常後，可以到 GitHub 撤銷原本的發布金鑰：
<https://github.com/settings/personal-access-tokens>

---

## 常見問題

- **登入時顯示「存取遭拒」或「應用程式未完成 Google 驗證流程」**：這位老師的 Gmail 還沒加進 Google Cloud 的「測試使用者」名單，請管理者加入後再登入。
- **儲存圖片時又跳出授權視窗**：測試模式下 Drive 授權約 7 天失效，重新按一次允許即可。
- **登入按鈕沒出現、或顯示 origin 錯誤**：確認 OAuth 用戶端的「已授權的 JavaScript 來源」是 `https://qq928672.github.io`（結尾不要有 `/`）。直接雙擊打開電腦上的 HTML 檔（`file://`）無法登入。
- **按「建立我的題庫」沒反應**：Google 授權視窗可能被瀏覽器擋住了，請允許這個網站開啟彈出視窗後再按一次。如果上一次建立到一半失敗，Drive 裡可能會多出一份空的「Lamby 題庫」或「Lamby 圖片」，可以直接刪掉。
- **「打不開你的題庫試算表」**：老師把「Lamby 題庫」刪掉了，或取消了對管理者的分享。請重新分享給管理者（編輯者）。如果檔案已經刪除，請管理者清空該老師那一列的 `sheetId`、`folderId`，老師再重新建立題庫。
- **「題目在你載入之後被修改過」**：同一位老師在別的裝置儲存過，或直接改了試算表。為了不蓋掉那些修改，請按「重新載入」後再改一次。
- **可以直接在試算表改題目嗎？** 可以，學生端約 1 分鐘內更新。但改題號、刪題目時，建議用後台操作，線索裡的題號才會自動跟著改。
- **老師離職，題目怎麼辦？** 題庫和圖片都在老師自己的 Drive 裡，老師可以帶走。管理者把他那一列的 `enabled` 改成 `FALSE`，他就不能再登入後台；學生也讀不到他的題目。
- **刪掉題目或換圖片後，舊圖片怎麼辦？** 程式**不會刪除**任何圖片。儲存後，沒有任何題目在用、且上傳超過一小時的圖片，會被**移到**「Lamby 圖片」裡的「_回收區」子資料夾（檔案 ID 和分享設定不變，舊連結照常能開）。想找回來，把檔案從「_回收區」拖回上一層即可；確定不要了可以自己在 Drive 刪除「_回收區」。
  - 自動整理只在 Drive 授權還有效時進行；也可以隨時按後台上方的 **🧹 整理圖片**。
  - 有未儲存的修改時，不會整理，避免誤移還在用的圖片。
  - 用「📥 匯入舊題目」搬進來的舊圖片，也是網站自己上傳的，所以同樣會被整理。
