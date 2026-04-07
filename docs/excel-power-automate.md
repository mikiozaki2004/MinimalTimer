# MinimalTimer - Excel 連携手順

MinimalTimer の記録を、OneDrive または SharePoint 上の 1 つの Excel ファイルへ追記するための手順です。

このリポジトリには、記録用テンプレートとして `docs/MinimalTimer_WorkLogs.xlsx` も用意しています。
このファイルを OneDrive または SharePoint に配置して使えます。

## 事前準備

1. `docs/MinimalTimer_WorkLogs.xlsx` を OneDrive または SharePoint に配置します。
2. 自分で新規作成する場合は、`作業記録` というシートを作成します。
3. 自分で新規作成する場合は、1 行目に次の見出しを入力します。

| 日付 | タスク | 詳細 | 開始 | 終了 | 時間(分) | 休憩 |
| --- | --- | --- | --- | --- | --- | --- |

4. 自分で新規作成する場合は、見出し行を含む範囲を選択し、Excel の「テーブルとして書式設定」でテーブル化します。
5. 自分で新規作成する場合は、テーブル名を `WorkLogs` に変更します。

## Power Automate フロー

1. Power Automate でクラウド フローを作成します。
2. トリガーに「HTTP 要求の受信時」を選びます。
3. トリガーの「要求本文の JSON スキーマ」は空のままで保存してかまいません。
4. 次のアクションに「JSON の解析」を追加します。
5. 「コンテンツ」に `triggerBody()` を指定します。
6. 「スキーマ」に次の JSON スキーマを貼り付けます。

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "date": { "type": "string" },
      "task": { "type": "string" },
      "detail": { "type": "string" },
      "startTime": { "type": "string" },
      "endTime": { "type": "string" },
      "durationMin": { "type": "number" },
      "isBreak": { "type": "boolean" }
    },
    "required": ["date", "task", "detail", "startTime", "endTime", "durationMin", "isBreak"]
  }
}
```

7. 「Apply to each」を追加し、入力に「JSON の解析」の本文を指定します。
8. ループの中に Excel Online の「表に行を追加」を追加します。
9. 場所、ドキュメント ライブラリ、ファイル、テーブル `WorkLogs` を選びます。
10. 各列に次の値を割り当てます。

| Excel 列 | Power Automate の値 |
| --- | --- |
| 日付 | `date` |
| タスク | `task` |
| 詳細 | `detail` |
| 開始 | `startTime` |
| 終了 | `endTime` |
| 時間(分) | `durationMin` |
| 休憩 | 式 `if(items('Apply_to_each')?['isBreak'], '休憩', '')` |

11. フローを保存し、生成された HTTP POST URL をコピーします。
12. MinimalTimer の記録ボタンを右クリックし、「Excel / Sheets 連携」に URL を貼り付けて保存します。

## 送信されるデータ

MinimalTimer は、タイマー完了時も「過去の記録を送信」時も配列 JSON を送信します。

```json
[
  {
    "date": "2026/04/07",
    "task": "資料作成",
    "detail": "見積もり",
    "startTime": "10:00",
    "endTime": "10:25",
    "durationMin": 25,
    "isBreak": false
  }
]
```

既存の Google Sheets 連携も同じ URL 設定欄を使えます。
