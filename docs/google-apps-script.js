/**
 * MinimalTimer - Google Sheets 連携スクリプト
 *
 * セットアップ手順:
 * 1. Google スプレッドシートを新規作成する
 * 2. メニュー「拡張機能」→「Apps Script」を開く
 * 3. このファイルの内容をすべて貼り付けて保存（Ctrl+S）
 * 4. メニュー「デプロイ」→「新しいデプロイ」を選択
 *    - 種類: ウェブアプリ
 *    - 次のユーザーとして実行: 自分
 *    - アクセスできるユーザー: 全員
 * 5. 「デプロイ」をクリックし、表示された「ウェブアプリの URL」をコピー
 * 6. MinimalTimer の記録ボタンを右クリック →「Excel / Sheets 連携」に URL を貼り付けて保存
 *
 * データ形式（シート「作業記録」に追記されます）:
 * | 日付 | タスク | 詳細 | 開始 | 終了 | 時間(分) | 休憩 |
 */

function doPost(e) {
  var payload = JSON.parse(e.postData.contents);
  var rows = Array.isArray(payload) ? payload : [payload];

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('作業記録');

  if (!sheet) {
    sheet = ss.insertSheet('作業記録');
    var header = ['日付', 'タスク', '詳細', '開始', '終了', '時間(分)', '休憩'];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  rows.forEach(function(data) {
    sheet.appendRow([
      data.date,
      data.task,
      data.detail,
      data.startTime,
      data.endTime,
      data.durationMin,
      data.isBreak ? '休憩' : ''
    ]);
  });

  return ContentService.createTextOutput(JSON.stringify({ count: rows.length }));
}
