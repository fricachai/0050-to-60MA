# Stock_K-chat

這是一個可直接部署到 GitHub Pages 的靜態股票觀察面板。

本地使用時，不要直接雙擊 `index.html`，請先在專案目錄啟動靜態伺服器：

```powershell
python -m http.server 8000
```

然後開啟 `http://localhost:8000/`。

## GitHub Pages 部署

這個 repo 已加入 GitHub Pages workflow。

在 GitHub 倉庫中請確認：

1. 進入 `Settings` -> `Pages`
2. `Source` 選擇 `GitHub Actions`
3. push 到 `main` 後，GitHub Actions 會自動部署

部署完成後，網址通常會是：

`https://fricachai.github.io/0050-to-60MA/`

## 買點提醒信

- 系統會針對 `0050` 與 `2330` 檢查兩種買點：
- `貼近 SMA60 轉強`
- `跌破 / 貫穿 SMA60 後收復轉強`
- 只有在 `MACD` 或 `KD` 同步出現低檔轉強時，才會標示買點並觸發提醒。
- 郵件收件者固定為 `fricachai@gmail.com`，前端不提供輸入其他信箱。
- GitHub Actions workflow `Buy Signal Alert` 已建立，但要真的發信，需在 repo `Settings -> Secrets and variables -> Actions` 設定：
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `ALERT_FROM_EMAIL`

## 功能

- 左側顯示深色 K 線主圖、Supertrend、買賣訊號標籤、CCI 線與持倉浮動獲利區。
- 右側提供股票觀察清單，可只輸入股票代號，自動抓取股票名稱。
- 會向 TWSE 官方端點抓取最近數月的日 K 資料並更新圖表。
- 支援匯入觀察清單 CSV。
- 支援匯入 K 線 CSV，點選右側股票後切換左側圖表。
- 內建示範資料，可先直接看到完整畫面。

## CSV 格式

觀察清單：

```csv
code,name
2330,台積電
2317,鴻海
```

也可只放代號：

```csv
code
2330
2317
```

K 線資料：

```csv
code,name,date,open,high,low,close,volume
2330,台積電,2026-04-01T09:00:00,912,918,906,916,12543
2330,台積電,2026-04-01T13:00:00,916,921,910,919,10211
```

## 備註

- 目前版本使用前端本地運算，已將你提供的 Pine Script 核心判斷轉寫成 JavaScript。
- 自動抓取目前接的是 TWSE 官方日成交資料，因此圖表是日 K，不是 4 小時 K。
- 若要接即時資料、4H K 或上櫃股票來源，可以在這個基礎上再往下串接。
