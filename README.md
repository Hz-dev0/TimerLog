# 時間紀錄 APP — 設定說明

## Firebase 設定步驟

### 1. 建立 Firebase 專案
1. 前往 https://console.firebase.google.com
2. 新增專案，名稱隨意（如 `timer-log`）
3. 不需要 Google Analytics

### 2. 啟用 Authentication
1. 左側選單 → Build → Authentication → Get started
2. Sign-in method → 啟用 **Anonymous**（匿名登入）

### 3. 建立 Firestore
1. 左側選單 → Build → Firestore Database → Create database
2. 選 **production mode**（之後設定規則）
3. 地區選離你近的（如 `asia-east1` 台灣）

### 4. Firestore 安全規則
左側 Firestore → Rules，貼上以下內容：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/events/{eventId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 5. 填入設定到 app.js
1. Firebase Console → 齒輪 → Project settings → Your apps
2. 點 `</>` 新增 Web app
3. 複製 firebaseConfig 物件的內容
4. 貼到 `app.js` 頂端的 `firebaseConfig` 變數中

---

## 資料結構

Firestore 路徑：`/users/{uid}/events/{docId}`

每筆文件欄位：
- `date`：字串，格式 `YYYY-MM-DD`
- `name`：字串，事件名稱（可為空）
- `min`：數字，分鐘數
- `ts`：Timestamp，新增時間（用來排序）

---

## 部署（可選）
可以直接用 Firebase Hosting：

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# Public directory: .（就是這個資料夾）
# Single-page app: No
firebase deploy
```

或直接把 index.html / style.css / app.js 三個檔案丟到任何靜態主機。
