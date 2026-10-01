# caretman

テキスト入力中に表示される点滅キャレット(カーソル)を、鉛筆描き風の棒人間アニメーションに置き換えたミニマルなWebテキストエディタ。

- 公開ページ: https://caretman.lolipop-now.app
- モーション確認ページ: https://caretman.lolipop-now.app/motion-review.html (全モーションを単体で再生・コマ送りで見られる開発用ページ)

## コンセプト

- キャレットを「状態を持つキャラクター」に置き換えた、キャレットUIの拡張実験
- 文字の書き消し・変換・経過時間など、テキストエディタ上で起こるあらゆる現象を、棒人間の動きで表現する。例えば、位置移動では歩き、待機が長いと煽ってくる、さらに放置すると諦めて座り込む、文字を消すと放り投げる…など。
- 絵の質感は、鉛筆で描いたような揺らぎ・不完全さ・手の温度を感じるものに
- ログイン・アカウント登録なしで、あらゆる環境ですぐに遊べるシンプルなWebページとする

初期の企画意図・検討過程は [`docs/`](./docs) 以下の仕様書・プロトタイプを参照。

## 基本的な仕様

### MVP機能

- ログイン・アカウント登録なし
- 入力内容をlocalStorageへ自動保存(400msデバウンス)。
- 本文が空の時だけ、棒人間の右隣に「入力まってるよ〜」を薄く表示(打つと消え、空に戻すとまた出る。デモ中・IME変換中は出さない)
- PC: 右上の「ダウンロード」ボタンから `.txt` としてダウンロード
- SP*: 右上の共有ボタンを押すと、OS標準の共有シートで `.txt` をファイル共有。

※実機のモバイル端末でnavigator.share対応時。共有シートは実機かどうかをUser-Agentで判定して切り替え、非対応環境ではPCと同じダウンロードにフォールバックする

#### 初回訪問時のみ（オンボーディング）
- 自動でタイプ→削除するデモを再生
- 「このブラウザに自動保存されます」という案内を表示(デモの再生後に表示)

### 棒人間

#### 棒人間のサイズ
エディタのフォントサイズに連動し、縦位置は文字のベースラインに揃える。

#### 棒人間の絵柄・描画

- 頭・肩・肘・腰・膝・足などの座標を毎フレーム計算し、線で結ぶ手続き型(procedural)のアニメーション
- rough.js で線の頂点をランダムに揺らして手描き風の形にし、テクスチャ画像[pencil-grain.webp]https://github.com/mt-sumikko/caretman/blob/main/public/textures/pencil-grain.webp)をSVGの`<mask>`で重ねて鉛筆の擦れ・粒感を表現
- SVGの`viewBox`は固定したまま表示サイズ(width/height)だけをフォントサイズに連動させることで、rough.jsのパラメータを固定値のままフォントサイズ変化に追従させている

## 棒人間のモーション

詳しくは [`docs/motion.md`](./docs/motion.md) を参照してください。各状態の発生条件と表現をキャレット目線で記載しています。


## 技術スタック

- [Vite](https://vitejs.dev/) + TypeScript(UIフレームワークなし、素のDOM操作)
- [rough.js](https://roughjs.com/)
- デプロイ先: ロリポップ！デプロイナウ(`npm run build`で生成される`dist/`を静的配信)

## ディレクトリ構成

```
index.html             本体(エディタ)のHTML
motion-review.html     モーション確認ページ(各モーションを単体で繰り返し再生+コマ送りの図鑑)
src/
  main.ts              起動処理・自動保存/共有・ダウンロードUIの配線
  editor.ts            contenteditableのイベント処理、キャレット追従、初回イントロデモの再生
  pose.ts              棒人間のポーズ計算(状態機械)。実エディタと確認ページの両方がこれを使う
  render.ts            rough.js + SVGでの実際の描画
  types.ts             ポーズなどの型定義
  utils.ts             補間などの小さな計算関数
  autosave.ts          localStorage自動保存
  download.ts          .txtダウンロード
  introDemo.ts         初回イントロデモを再生済みかどうかの保存キー
  debugPanel.ts        開発ビルドのみで読み込まれるデバッグUI(本番ビルドからは自動で除外される)
  motionReview/        確認ページ用(state.ts=pose.tsへの合図送り役、filmstrips.ts=図鑑の描画)
public/                favicon・OGP画像・鉛筆テクスチャ画像(textures/)
docs/                  初期の仕様書・プロトタイプ(企画の経緯の記録)、モーション図鑑のPNG、favicon/OGP画像の元データ
.env                   公開URL(OGPのURLに使う。秘密情報ではない)
```

## 開発

```
npm install
npm run dev       # 開発サーバー
npm run build     # 型チェック + 本番ビルド(dist/)
npm run preview   # 本番ビルドのプレビュー
```

`npm run dev` の時だけ、エディタ画面にデバッグパネル(モーション状態表示・各種スライダー・5分経過ボタンなど)が表示される。`import.meta.env.DEV`による分岐のため、本番ビルドには含まれない。
