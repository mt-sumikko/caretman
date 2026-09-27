// このファイルは型定義だけをまとめたもの(実際の処理は書かれていない)。
// pose.tsとrender.tsの間で「棒人間の姿勢」をやり取りする時の形をここで決めている。

export interface Point {
  x: number;
  y: number;
}

export interface HeadPose {
  cx: number;
  cy: number;
  r: number;
}

export interface Pose {
  head: HeadPose;
  neck: Point;
  hip: Point;
  armL: Point;
  armR: Point;
  kneeL: Point;
  kneeR: Point;
  legL: Point;
  legR: Point;
  /** 肘・膝の曲げの強さ(制御点をどれだけ前方に膨らませるか) */
  elbowBend: number;
  /** 肘の位置を直接指定したい時だけ使う(肘で進行方向を突くような、手より肘が前に出る曲げ方用)。省略時はelbowBendから自動で決める */
  elbowL?: Point;
  elbowR?: Point;
  /** 0=通常 / 1=文字の間で潰しきった状態 */
  squashAmt: number;
  /** キャレットのフリをしている間の点滅用の不透明度(0/1)。該当しない時はnull(CSS側の不透明度に委ねる) */
  blinkOpacity: number | null;
  /** デバッグパネル表示用の現在の状態名 */
  status: string;
}

export type JumpPhase = 'none' | 'anticipate' | 'arc' | 'brace';
