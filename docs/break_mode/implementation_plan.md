# 休憩モード機能

カウントダウン/カウントアップタイマーに「休憩モード」を追加する。休憩中はタスク名が自動的に「休憩」になり、記録時に `isBreak: true` フラグが付与される。記録画面では作業時間と休憩時間を分けて表示する。

## 提案する変更

---

### メインUI（index.html / main.js / style.css）

#### [MODIFY] [index.html](file:///c:/dev/MinimalTimer/src/index.html)
- コントロールボタン群に「休憩」ボタン（☕アイコン）を追加

#### [MODIFY] [main.js](file:///c:/dev/MinimalTimer/src/main.js)
- `st` に `breakMode: false` を追加
- 休憩ボタンクリックで:
  - 実行中なら `logSession()` で作業セッションを記録
  - `st.breakMode = true` に切替
  - タイマーリセット＆デフォルト5分のカウントダウン開始
  - タスク名表示を「☕ 休憩」に変更、リングの色を変更（CSS class）
- 休憩解除（再度ボタンか、Play/Reset/Mode操作）で:
  - `st.breakMode = false` に戻す
  - タスク名を元に戻す
- `logSession()` に `isBreak: st.breakMode` を追加

#### [MODIFY] [style.css](file:///c:/dev/MinimalTimer/src/style.css)
- `.circle.break-mode` で休憩中のビジュアル変更（リング色を緑系に）
- 休憩ボタンのスタイル

---

### 記録画面（records.js / records.html / records.css）

#### [MODIFY] [records.js](file:///c:/dev/MinimalTimer/src/records.js)
- `getFiltered()` / `getAggregated()` で休憩ログ（`isBreak === true`）を除外
- 休憩合計時間を別途計算
- フッタに「作業: Xh Ym / 休憩: Xh Ym」の形式で表示

#### [MODIFY] [records.html](file:///c:/dev/MinimalTimer/src/records.html)
- フッタに休憩時間の表示欄を追加

#### [MODIFY] [records.css](file:///c:/dev/MinimalTimer/src/records.css)
- 休憩時間表示のスタイル

## 確認方法

### 手動確認
1. `npx tauri dev` でアプリ起動
2. ☕ボタンをクリック → タスク名が「☕ 休憩」に変わり、リングの色が変わることを確認
3. 5分カウントダウンが開始されることを確認
4. リセットや再生ボタンで休憩モードが解除されることを確認
5. 記録画面を開き、作業と休憩が分かれて表示されていることを確認
