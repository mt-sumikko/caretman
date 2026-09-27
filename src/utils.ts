// このファイルは、いろんな場所から使う小さな計算用の関数をまとめただけのもの

/** aとbの間を、t(0〜1)の割合で補間した値を返す(t=0でa、t=1でb、t=0.5でちょうど真ん中) */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 座標(x,y)版のlerp。点aから点bへ、t(0〜1)の割合だけ進んだ位置を返す */
export function lerpPoint(a: { x: number; y: number }, b: { x: number; y: number }, t: number): { x: number; y: number } {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** -amount〜+amountの範囲でランダムな値を返す(手描き風の細かい揺らぎを作るのに使う) */
export function jitter(amount: number): number {
  return (Math.random() - 0.5) * 2 * amount;
}

/** ms(ミリ秒)だけ待つ。async関数の中で `await delay(1000)` のように使う */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
