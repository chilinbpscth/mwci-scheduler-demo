## Render demo（免登入）

### 原版系統（參考）

原本單檔前端版本（v6.41）同接手筆記已放入：

- `reference/開發者指南.md`
- `reference/原版系統_v6.41.html`（目前只保留檔頭與說明；如需可再加入完整原檔）

### 本地運行

```bash
cd demo-render
npm install
npm run dev
```

開 `http://localhost:3000/`

### Render 部署（Blueprint）

- 將 `demo-render/` 推上 GitHub（或放做 repo root）。
- Render 內揀「Blueprint」，指向 repo，會自動讀 `render.yaml`。
- **Build Command**：`npm install`
- **Start Command**：`npm start`
- **Environment**（可選）：
  - `DATA_PATH=/var/data/data.json`（如你用 Render Disk）
  - `DB_PATH=/var/data/app.sqlite`（SQLite 持久化；建議用）

### Demo 功能

- 老師端：`/`
  - 選老師（免登入）
  - 看到日期 x 班別矩陣
  - 點「鎖位/解除」
  - 點「生成」只補未鎖定位
  - 下載 Excel：`/api/export.xlsx`

- 管理端：`/admin.html`
  - 直接改 state JSON（demo 用）

