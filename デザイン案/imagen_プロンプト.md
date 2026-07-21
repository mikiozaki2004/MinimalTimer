# Imagen 用 UI デザイン生成プロンプト（2パターン）

前提：**現在のフロントのスクリーンショットを参照画像として一緒に渡す**こと。
方針：ライト基調 / 低占有率（小さく浮かぶウィジェット）/ 極細フォント・薄い進捗線・すりガラスの質感を踏襲。

配色の基準（アプリのライトテーマに合わせる）
- 背景：ウォームオフホワイト `#F5F5F0`（半透明すりガラス）
- 文字：ダークスレート `#1E293B`
- アクセント（進捗リング/バー）：カームブルー `#2563EB`
- 走行中ドット：グリーン `#16A34A`

---

## プロンプト① 丸型（現状踏襲・ライト基調リファイン）  ─ aspect ratio 1:1

```
A high-fidelity UI design mockup of a minimalist desktop timer widget, shaped as a single
perfect circle. Use the attached image as the structural and layout reference — keep the
same circular all-in-one composition and thin aesthetic. Light theme: soft frosted-glass
off-white background (#F5F5F0) with subtle translucency and a gentle top sheen, floating in
the corner of a blurred bright desktop. In the center, a large ultra-thin countdown time
"24:12" in dark slate (#1E293B), hairline weight, tabular numerals; just above it a small,
dim current clock "14:30". A very thin 2px circular progress ring around the edge in calm
blue (#2563EB), partially filled with a soft glow. Extremely minimal, generous negative
space, tiny compact footprint. Soft realistic drop shadow, glassmorphism, clean modern
product design, Figma / Dribbble quality, front-on flat view. No window chrome, no title
bar, no menus, no clutter.
```

---

## プロンプト② 縦長長方形（新型・進行中タスクチェックリスト付き）  ─ aspect ratio 3:4（縦）

```
A high-fidelity UI design mockup of a minimalist desktop timer widget, shaped as a slim
vertical rounded rectangle in portrait orientation with a small, compact footprint. Use the
attached current circular design as the style reference for its typography, thin progress
line and frosted-glass feel — but change the shape to vertical and add a task checklist.
Light theme: frosted-glass warm off-white background (#F5F5F0), soft translucency and a
subtle sheen, floating over a blurred bright desktop.
Top zone: a small dim clock "14:30" and below it a large ultra-thin time "24:12" in dark
slate (#1E293B), hairline tabular numerals, with a thin 2px horizontal progress bar in calm
blue (#2563EB) underneath.
Lower zone: a compact vertical checklist of 3–4 active work items. Each row = a small rounded
checkbox + a short task label in dark slate + a small elapsed time on the right. One item is
checked/done with a strikethrough; two items are currently running, marked with a small green
dot (#16A34A). A faint "+ add task" row at the very bottom.
Very minimal, airy, generous spacing, calm. Soft drop shadow, glassmorphism, clean modern
product UI, Figma / Dribbble quality, front-on flat view. No window chrome, no title bar, no
menu bar, no clutter, minimal visible text.
```

---

## ダークテンプレ用の差し替え句（末尾に追記）

```
Dark theme variant instead: deep translucent charcoal background (#0D1117), light text
(#E6EDF3), accent ring / bar in bright blue (#58A6FF), running dots in bright green (#4ADE80),
soft glow around the numerals.
```

---

## 使うときのコツ

- **文字化け対策：** Imagen はテキスト（特に日本語）が崩れやすい。配色・レイアウト・質感の探索用と割り切り、確定文字は後で本実装 or 画像編集で乗せる。プロンプト内は英数字の短い文字列（"24:12" 等）に留める。
- **参照画像の効き具合：** image-to-image / reference が使えるなら influence は弱〜中に。構図は引き継ぎつつ配色を刷新したいため、強すぎると元のダーク配色を引きずる。
- **占有率を下げたい意図の強調：** うまく小さくならない時は `tiny`, `compact`, `lots of empty space`, `floating small widget` を足す。
- **アスペクト比：** ①=1:1、②=3:4 または 2:3（もっと細長くしたいなら 9:16）。
- **バリエーション：** 1回で複数枚出す設定なら、②は「リスト4行」「リスト2行＋余白多め」で振ると占有率の当たりを比較しやすい。
