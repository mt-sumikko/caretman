# docs

Code(このリポジトリ)へ移行する前、チャットでのプロトタイピング段階で作成された初期資料。企画の経緯・検討過程の記録として保管している。実装の現状は最新のソースコードとルートの[README.md](../README.md)を参照。

- [`spec.md`](./spec.md) — 仕様書。概要・実装方針(手続き型アニメーション/rough.js+静的テクスチャマスク)・条件別モーション一覧・未決定事項・Codeへの引き継ぎメモなど
- [`input-event-checklist.md`](./input-event-checklist.md) — テキストエディタで起こり得る入力イベントの網羅性チェック表
- [`prototype-editor.html`](./prototype-editor.html) — 移行前の単一HTMLプロトタイプ(実際にcontenteditableでキャレット追従する版)
- [`prototype-decision-render.html`](./prototype-decision-render.html) — 線の質感(rough.js + 静的テクスチャマスク)の比較検証ツール。「決定版レンダリング」として実エディタに統合済み

## モーション図鑑

- [`motion-filmstrips/`](./motion-filmstrips/) — 各モーションのコマ送り画像(1モーション=1枚)。motion-review.htmlの「モーション図鑑」を書き出したスナップショットなので、最新の動きはmotion-review.html側で確認する(ページを開くたびに実際のモーションの計算から描き直している)

## favicon

- [`favicon/`](./favicon/) — favicon(キャレットのフリのポーズ)の元データ。`caretman-icon.svg`が透過の元絵、`-rounded`はブラウザのタブ用(背景色#FAF8F3の角丸)、`-square`はiPhoneのホーム画面用(角丸はiOSが付ける)。実際に使っている`favicon.ico`(16/32/48px)と`apple-touch-icon.png`(180px)は`public/`に置いてある
