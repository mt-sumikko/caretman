# docs

**現在の実装仕様について：**
実装の最新情報はルートの[README.md](../README.md)と以下のドキュメントを参照してください。

- [`motion.md`](./motion.md) — 棒人間のモーション定義。各状態の発生条件（キャレット目線）と表現方法

**企画段階の参考資料（アーカイブ）：**
チャットでのプロトタイピング段階で作成された資料。企画の経緯・検討過程の記録として保管しています。

- [`prototype/spec.md`](./prototype/spec.md) — 初期企画書（参考資料）
- [`prototype/input-event-checklist.md`](./prototype/input-event-checklist.md) — イベント仕様の検討記録
- [`prototype/prototype-editor.html`](./prototype/prototype-editor.html) — 移行前の単一HTMLプロトタイプ
- [`prototype/prototype-decision-render.html`](./prototype/prototype-decision-render.html) — レンダリング手法の検証ツール

## モーション図鑑

- [`motion-filmstrips/`](./motion-filmstrips/) — 各モーションのコマ送り画像(1モーション=1枚)。motion-review.htmlの「モーション図鑑」を書き出したスナップショットなので、最新の動きはmotion-review.html側で確認する(ページを開くたびに実際のモーションの計算から描き直している)

## favicon

- [`favicon/`](./favicon/) — favicon(キャレットのフリのポーズ)の元データ。アプリと同じポーズ計算・描画(pose.ts / render.ts)で描き出したもの。`caretman-icon.svg`が透過の元絵、`-rounded`はブラウザのタブ用(背景色#FAF8F3の角丸)、`-square`はiPhoneのホーム画面用(角丸はiOSが付ける)。実際に使っている`favicon.ico`(16/32/48px)と`apple-touch-icon.png`(180px)は`public/`に置いてある

## OGP画像

- [`ogp/ogp-source.webp`](./ogp/ogp-source.webp) — SNSシェア用画像の元データ(2000×1050)。実際に使っている`ogp.png`(1200×630)は`public/`に置いてある
