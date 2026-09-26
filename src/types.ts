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
  /** 0=通常 / 1=文字の間で潰しきった状態 */
  squashAmt: number;
  /** デバッグパネル表示用の現在の状態名 */
  status: string;
}

export type JumpPhase = 'none' | 'anticipate' | 'arc' | 'brace';
