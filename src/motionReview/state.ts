import { lerp } from '../utils';
import type { Point, Pose } from '../types';

/**
 * モーション確認・精査用の状態計算。
 *
 * src/pose.ts(実エディタ用)とは意図的に別ファイルにしてある。
 * ここは「dtやキャレット位置に関係なく、選んだ状態を直接再生する」デモ駆動の
 * 実装(決定版レンダリング比較ツールと同じ考え方)で、実エディタにまだ無い
 * 選択/貼り付けポーズなどの検討にも使う。ここでの調整が固まったら、
 * pose.ts / editor.ts 側に手動で反映する運用。
 */

const ANTICIPATE_DURATION = 130;
const JUMP_DURATION = 350;
const BRACE_DURATION = 220;
const THROW_DURATION = 220;
const CONFIRM_HOP_DURATION = 180;
const ARM_RISE_SPEED = 0.22;
const SIT_SPEED = 0.05;
const SQUASH_SPEED = 0.15;
const LONG_IDLE_SWING_MS = 2600;
const REPEAT_GAP_MS = 700; // ワンショット系モーションの、選択中の自動リピート間隔
const CARET_POSE_DELAY_MS = 3000; // 「短い待機」ピルを選んでから、キャレットのフリ(腕上げ)を始めるまでの間(実エディタと同じ値)
const BLINK_HALF_MS = 530; // 一般的なキャレットの点滅速度(実エディタと同じ値)

const neutral = {
  head: { cx: 0, cy: -32, r: 6 },
  neck: { x: 0, y: -26 },
  hip: { x: 0, y: -8 },
  armL: { x: -11.1, y: -9 },
  armR: { x: 11.1, y: -9 },
  legL: { x: -6, y: 8 },
  legR: { x: 6, y: 8 },
};

export type DemoState =
  | 'base'
  | 'shortIdle'
  | 'shortIdleBetween'
  | 'walk'
  | 'longIdle'
  | 'givenUp'
  | 'jump'
  | 'throw'
  | 'composing'
  | 'confirmHop'
  | 'selecting'
  | 'pasting';

export const DEMO_STATES: { value: DemoState; label: string; note?: string }[] = [
  { value: 'base', label: '基本ポーズ' },
  { value: 'shortIdle', label: '短い待機' },
  { value: 'shortIdleBetween', label: '短い待機(文字の間)' },
  { value: 'walk', label: '歩き' },
  { value: 'longIdle', label: '長い待機(煽り)' },
  { value: 'givenUp', label: 'あきらめて着席' },
  { value: 'jump', label: '改行ジャンプ' },
  { value: 'throw', label: '削除(放り投げ)' },
  { value: 'confirmHop', label: '変換確定/複数文字ホップ' },
  { value: 'composing', label: '変換中(表示のみ)' },
  { value: 'selecting', label: '選択ポーズ', note: '実エディタ接続済み' },
  { value: 'pasting', label: '貼り付けポーズ', note: '実エディタ接続済み' },
];

type JumpPhase = 'none' | 'anticipate' | 'arc' | 'brace';

export class DemoStickmanState {
  private leanPhase = 0;
  private armRaiseAmt = 1;
  private sitAmt = 0;
  private squashAmt = 0;
  private jumpPhase: JumpPhase = 'none';
  private anticipateStart = 0;
  private jumpStart = 0;
  private braceStart = 0;
  private nextJumpAt = 0;
  private throwActive = false;
  private throwStart = 0;
  private nextThrowAt = 0;
  private confirmHopActive = false;
  private confirmHopStart = 0;
  private nextHopAt = 0;
  private stateEnteredAt = 0; // 今のピルに切り替わった時刻(基本ポーズの間 → キャレットのフリの遅延に使う)

  /** モーションを切り替えた時、待たずにすぐ一度再生させる */
  restart(now: number): void {
    this.jumpPhase = 'none';
    this.throwActive = false;
    this.confirmHopActive = false;
    this.nextJumpAt = now;
    this.nextThrowAt = now;
    this.nextHopAt = now;
    this.stateEnteredAt = now;
  }

  computePose(now: number, demoState: DemoState): Pose {
    const isBase = demoState === 'base';
    const isShortIdle = demoState === 'shortIdle' || demoState === 'shortIdleBetween';
    const betweenChars = demoState === 'shortIdleBetween';
    const isTyping = demoState === 'walk';
    const isLongIdle = demoState === 'longIdle';
    const isGivenUp = demoState === 'givenUp';
    const isSelecting = demoState === 'selecting';
    const isPasting = demoState === 'pasting';
    // 「短い待機」ピルを選んでから3秒経つまでは基本ポーズのまま繋ぎ、それから腕を上げ始める(実エディタと同じ)
    const isCaretPose = isShortIdle && now - this.stateEnteredAt >= CARET_POSE_DELAY_MS;

    // ワンショット系(ジャンプ/放り投げ/変換確定ホップ)は選択中、一定間隔で自動的に繰り返す
    if (demoState === 'jump' && this.jumpPhase === 'none' && now >= this.nextJumpAt) {
      this.jumpPhase = 'anticipate';
      this.anticipateStart = now;
    }
    if (demoState === 'throw' && !this.throwActive && now >= this.nextThrowAt) {
      this.throwActive = true;
      this.throwStart = now;
    }
    if (demoState === 'confirmHop' && !this.confirmHopActive && now >= this.nextHopAt) {
      this.confirmHopActive = true;
      this.confirmHopStart = now;
    }

    const leanTarget = isLongIdle ? Math.sin((now / LONG_IDLE_SWING_MS) * Math.PI * 2) : 0;
    this.leanPhase += (leanTarget - this.leanPhase) * 0.05;

    const sitTarget = isGivenUp ? 1 : 0;
    this.sitAmt += (sitTarget - this.sitAmt) * SIT_SPEED;

    const armRaiseTarget = isCaretPose ? 1 : 0;
    if (armRaiseTarget > this.armRaiseAmt) {
      this.armRaiseAmt += (armRaiseTarget - this.armRaiseAmt) * ARM_RISE_SPEED;
    } else {
      this.armRaiseAmt = armRaiseTarget;
    }

    this.squashAmt += ((betweenChars ? 1 : 0) - this.squashAmt) * SQUASH_SPEED;

    let jumpY = 0;
    let crouchAmt = 0;
    let arcTuckAmt = 0;
    if (this.jumpPhase === 'anticipate') {
      const progress = Math.min(1, (now - this.anticipateStart) / ANTICIPATE_DURATION);
      crouchAmt = Math.sin((progress * Math.PI) / 2);
      if (progress >= 1) {
        this.jumpPhase = 'arc';
        this.jumpStart = now;
      }
    } else if (this.jumpPhase === 'arc') {
      const progress = Math.min(1, (now - this.jumpStart) / JUMP_DURATION);
      jumpY = -Math.sin(progress * Math.PI) * 20;
      arcTuckAmt = Math.sin(progress * Math.PI);
      if (progress >= 1) {
        this.jumpPhase = 'brace';
        this.braceStart = now;
        crouchAmt = 1;
      }
    } else if (this.jumpPhase === 'brace') {
      const progress = Math.min(1, (now - this.braceStart) / BRACE_DURATION);
      crouchAmt = Math.cos((progress * Math.PI) / 2);
      if (progress >= 1) {
        this.jumpPhase = 'none';
        this.nextJumpAt = now + REPEAT_GAP_MS;
      }
    }

    let throwProgress = -1;
    if (this.throwActive) {
      throwProgress = Math.min(1, (now - this.throwStart) / THROW_DURATION);
      if (throwProgress >= 1) {
        this.throwActive = false;
        this.nextThrowAt = now + REPEAT_GAP_MS;
      }
    }

    let hopY = 0;
    let hopLeanAmt = 0;
    if (this.confirmHopActive) {
      const hopProgress = Math.min(1, (now - this.confirmHopStart) / CONFIRM_HOP_DURATION);
      hopY = -Math.sin(hopProgress * Math.PI) * 7;
      hopLeanAmt = Math.sin(hopProgress * Math.PI);
      if (hopProgress >= 1) {
        this.confirmHopActive = false;
        this.nextHopAt = now + REPEAT_GAP_MS;
      }
    }

    const head = { cx: neutral.head.cx, cy: neutral.head.cy, r: neutral.head.r };
    const neck: Point = { x: neutral.neck.x, y: neutral.neck.y };
    const hip: Point = { x: neutral.hip.x, y: neutral.hip.y };
    let armL: Point;
    let armR: Point;
    let kneeL: Point;
    let kneeR: Point;
    let footL: Point;
    let footR: Point;

    if (this.jumpPhase === 'anticipate' || this.jumpPhase === 'brace') {
      const standKneeL = { x: neutral.legL.x / 2, y: (neutral.hip.y + neutral.legL.y) / 2 };
      const standKneeR = { x: neutral.legR.x / 2, y: (neutral.hip.y + neutral.legR.y) / 2 };
      const crouchKneeL = { x: -9, y: -1 };
      const crouchKneeR = { x: 9, y: -1 };
      hip.y += crouchAmt * 6;
      head.cy += crouchAmt * 6;
      neck.y += crouchAmt * 6;
      armL = { x: lerp(neutral.armL.x, neutral.armL.x - 4, crouchAmt), y: lerp(neutral.armL.y, neutral.armL.y + 4, crouchAmt) };
      armR = { x: lerp(neutral.armR.x, neutral.armR.x + 4, crouchAmt), y: lerp(neutral.armR.y, neutral.armR.y + 4, crouchAmt) };
      kneeL = { x: lerp(standKneeL.x, crouchKneeL.x, crouchAmt), y: lerp(standKneeL.y, crouchKneeL.y, crouchAmt) };
      kneeR = { x: lerp(standKneeR.x, crouchKneeR.x, crouchAmt), y: lerp(standKneeR.y, crouchKneeR.y, crouchAmt) };
      footL = { x: neutral.legL.x, y: neutral.legL.y };
      footR = { x: neutral.legR.x, y: neutral.legR.y };
    } else if (this.jumpPhase === 'arc') {
      // 空中: 膝を大きく曲げて足を体の下まで引き上げ、地面との距離は脚の長さでなく高さ(jumpY)で見せる。
      // 腕は逆に、頂点に向かって下げ切っていく(実エディタ: src/pose.ts と同じ値)
      const standKneeL = { x: neutral.legL.x / 2, y: (neutral.hip.y + neutral.legL.y) / 2 };
      const standKneeR = { x: neutral.legR.x / 2, y: (neutral.hip.y + neutral.legR.y) / 2 };
      const tuckKneeL = { x: -5, y: -7 };
      const tuckKneeR = { x: 5, y: -7 };
      const tuckFootL = { x: -3, y: -2 };
      const tuckFootR = { x: 3, y: -2 };
      kneeL = { x: lerp(standKneeL.x, tuckKneeL.x, arcTuckAmt), y: lerp(standKneeL.y, tuckKneeL.y, arcTuckAmt) };
      kneeR = { x: lerp(standKneeR.x, tuckKneeR.x, arcTuckAmt), y: lerp(standKneeR.y, tuckKneeR.y, arcTuckAmt) };
      footL = { x: lerp(neutral.legL.x, tuckFootL.x, arcTuckAmt), y: lerp(neutral.legL.y, tuckFootL.y, arcTuckAmt) };
      footR = { x: lerp(neutral.legR.x, tuckFootR.x, arcTuckAmt), y: lerp(neutral.legR.y, tuckFootR.y, arcTuckAmt) };
      // 腕のyはこの後jumpYで体ごと持ち上げられる(-20程度)ぶん相殺されるため、その分を見込んで
      // 大きめの値にしてある(実エディタ: src/pose.ts と同じ値)
      const hangArmL = { x: -4, y: 40 };
      const hangArmR = { x: 4, y: 40 };
      armL = { x: lerp(neutral.armL.x, hangArmL.x, arcTuckAmt), y: lerp(neutral.armL.y, hangArmL.y, arcTuckAmt) };
      armR = { x: lerp(neutral.armR.x, hangArmR.x, arcTuckAmt), y: lerp(neutral.armR.y, hangArmR.y, arcTuckAmt) };
    } else if (this.throwActive) {
      const grabL = { x: -15, y: -12 };
      const grabR = { x: -12, y: -10 };
      const tossL = { x: 18, y: -22 };
      const tossR = { x: 21, y: -19 };
      let axL: number, ayL: number, axR: number, ayR: number;
      if (throwProgress < 0.25) {
        const t = throwProgress / 0.25;
        axL = lerp(neutral.armL.x, grabL.x, t);
        ayL = lerp(neutral.armL.y, grabL.y, t);
        axR = lerp(neutral.armR.x, grabR.x, t);
        ayR = lerp(neutral.armR.y, grabR.y, t);
      } else if (throwProgress < 0.6) {
        const t = (throwProgress - 0.25) / 0.35;
        axL = lerp(grabL.x, tossL.x, t);
        ayL = lerp(grabL.y, tossL.y, t);
        axR = lerp(grabR.x, tossR.x, t);
        ayR = lerp(grabR.y, tossR.y, t);
      } else {
        const t = (throwProgress - 0.6) / 0.4;
        axL = lerp(tossL.x, neutral.armL.x, t);
        ayL = lerp(tossL.y, neutral.armL.y, t);
        axR = lerp(tossR.x, neutral.armR.x, t);
        ayR = lerp(tossR.y, neutral.armR.y, t);
      }
      armL = { x: axL, y: ayL };
      armR = { x: axR, y: ayR };
      const standKneeL = { x: neutral.legL.x / 2, y: (neutral.hip.y + neutral.legL.y) / 2 };
      const standKneeR = { x: neutral.legR.x / 2, y: (neutral.hip.y + neutral.legR.y) / 2 };
      const lungeKneeL = { x: -13, y: 3 };
      const lungeFootL = { x: -17, y: 8 };
      const lungeKneeR = { x: 7, y: 3 };
      const lungeFootR = { x: 11, y: 8 };
      let lungeT: number;
      if (throwProgress < 0.25) lungeT = throwProgress / 0.25;
      else if (throwProgress < 0.6) lungeT = 1;
      else lungeT = 1 - (throwProgress - 0.6) / 0.4;
      lungeT = Math.max(0, Math.min(1, lungeT));
      kneeL = { x: lerp(standKneeL.x, lungeKneeL.x, lungeT), y: lerp(standKneeL.y, lungeKneeL.y, lungeT) };
      kneeR = { x: lerp(standKneeR.x, lungeKneeR.x, lungeT), y: lerp(standKneeR.y, lungeKneeR.y, lungeT) };
      footL = { x: lerp(neutral.legL.x, lungeFootL.x, lungeT), y: neutral.legL.y };
      footR = { x: lerp(neutral.legR.x, lungeFootR.x, lungeT), y: neutral.legR.y };
      const twist = Math.sin(throwProgress * Math.PI);
      hip.x += twist * 5;
      hip.y -= lungeT * 3;
      head.cx -= twist * 3;
    } else if (this.confirmHopActive) {
      head.cx += hopLeanAmt * 6;
      neck.x += hopLeanAmt * 4;
      hip.x += hopLeanAmt * 3;
      armL = { x: neutral.armL.x - hopLeanAmt * 10, y: neutral.armL.y + hopLeanAmt * 5 };
      armR = { x: neutral.armR.x + hopLeanAmt * 10, y: neutral.armR.y - hopLeanAmt * 7 };
      kneeL = { x: neutral.legL.x / 2 - hopLeanAmt * 6, y: (hip.y + neutral.legL.y) / 2 + hopLeanAmt * 3 };
      kneeR = { x: neutral.legR.x / 2 + hopLeanAmt * 4, y: (hip.y + neutral.legR.y) / 2 - hopLeanAmt * 2 };
      footL = { x: neutral.legL.x - hopLeanAmt * 9, y: neutral.legL.y };
      footR = { x: neutral.legR.x + hopLeanAmt * 7, y: neutral.legR.y - hopLeanAmt * 3 };
    } else if (isTyping) {
      const front = { x: 9, y: 8.4 };
      const frontKnee = { x: 4, y: 3 };
      const back = { x: -10.2, y: 7.6 };
      const backKnee = { x: -3, y: -2 };
      const swingFoot = { x: 0, y: 3 };
      const swingKnee = { x: 2, y: -7 };
      const plantFoot = { x: 0, y: 8 };
      const plantKnee = { x: 0, y: 3 };
      const armFwd = { x: -7.4, y: -15.9 };
      const armBack = { x: 10, y: -18.5 };
      const bounce = 1.6;
      const phase = Math.floor(now / 140) % 4;

      if (phase === 0) {
        footL = front;
        kneeL = frontKnee;
        footR = back;
        kneeR = backKnee;
        armL = armBack;
        armR = armFwd;
      } else if (phase === 1) {
        footL = swingFoot;
        kneeL = swingKnee;
        footR = plantFoot;
        kneeR = plantKnee;
        armL = { x: neutral.armL.x, y: neutral.armL.y };
        armR = { x: neutral.armR.x, y: neutral.armR.y };
      } else if (phase === 2) {
        footL = back;
        kneeL = backKnee;
        footR = front;
        kneeR = frontKnee;
        armL = armFwd;
        armR = armBack;
      } else {
        footL = plantFoot;
        kneeL = plantKnee;
        footR = swingFoot;
        kneeR = swingKnee;
        armL = { x: neutral.armL.x, y: neutral.armL.y };
        armR = { x: neutral.armR.x, y: neutral.armR.y };
      }
      const bounceAmt = phase % 2 === 1 ? bounce : bounce * 0.3;
      head.cy -= bounceAmt;
      neck.y -= bounceAmt;
      hip.y -= bounceAmt;
    } else if (isShortIdle) {
      const downArmL = { x: neutral.armL.x, y: neutral.armL.y };
      const downArmR = { x: neutral.armR.x, y: neutral.armR.y };
      const upArmL = { x: -4, y: -42 };
      const upArmR = { x: 4, y: -42 };
      armL = { x: lerp(downArmL.x, upArmL.x, this.armRaiseAmt), y: lerp(downArmL.y, upArmL.y, this.armRaiseAmt) };
      armR = { x: lerp(downArmR.x, upArmR.x, this.armRaiseAmt), y: lerp(downArmR.y, upArmR.y, this.armRaiseAmt) };
      kneeL = { x: neutral.legL.x / 2, y: (hip.y + neutral.legL.y) / 2 };
      kneeR = { x: neutral.legR.x / 2, y: (hip.y + neutral.legR.y) / 2 };
      footL = { x: neutral.legL.x, y: neutral.legL.y };
      footR = { x: neutral.legR.x, y: neutral.legR.y };

      armL.x = lerp(armL.x, 0, this.squashAmt * 0.9);
      armR.x = lerp(armR.x, 0, this.squashAmt * 0.9);
      kneeL.x = lerp(kneeL.x, 0, this.squashAmt * 0.9);
      kneeR.x = lerp(kneeR.x, 0, this.squashAmt * 0.9);
      footL.x = lerp(footL.x, 0, this.squashAmt * 0.9);
      footR.x = lerp(footR.x, 0, this.squashAmt * 0.9);
    } else if (isSelecting) {
      // 選択ポーズ: 両腕は体幹に沿ってほぼ真上に伸ばし、先端(手)だけわずかに右へ。重心は中央寄りに保つ。
      // 左足はつま先立ちで接地、右足は膝を上げる (実エディタ: src/pose.ts と同じ値)
      armL = { x: 4, y: -44 };
      armR = { x: 7, y: -42 };
      kneeL = { x: -3, y: 1 };
      kneeR = { x: 5, y: -6 };
      footL = { x: -4, y: 7 };
      footR = { x: 4, y: -1 };
    } else if (isPasting) {
      // 貼り付けポーズ(仮): 足先は右側に残したまま、膝だけ左へ入れる。腰を深く屈めて左へ前屈みになる
      hip.x -= 2;
      hip.y += 7;
      head.cx -= 9;
      head.cy += 6;
      neck.x -= 7;
      neck.y += 6;
      armL = { x: -19, y: -3 };
      armR = { x: -16, y: -1 };
      kneeL = { x: -14, y: 2 };
      kneeR = { x: -9, y: 3 };
      footL = { x: -2, y: 8 };
      footR = { x: 4, y: 8 };
    } else if (isBase) {
      armL = { x: neutral.armL.x, y: neutral.armL.y };
      armR = { x: neutral.armR.x, y: neutral.armR.y };
      kneeL = { x: neutral.legL.x / 2, y: (hip.y + neutral.legL.y) / 2 };
      kneeR = { x: neutral.legR.x / 2, y: (hip.y + neutral.legR.y) / 2 };
      footL = { x: neutral.legL.x, y: neutral.legL.y };
      footR = { x: neutral.legR.x, y: neutral.legR.y };
    } else {
      // 長い待機(体重移動) ⇔ 諦めて座り込み
      const hipShift = this.leanPhase * 5;
      const headShift = this.leanPhase * -2.5;
      const armSwingLean = this.leanPhase * 5;
      const swayHip = { x: neutral.hip.x + hipShift, y: neutral.hip.y };
      const swayHeadCx = neutral.head.cx + headShift;
      const swayNeckX = neutral.neck.x + headShift * 0.6;
      const swayArmL = { x: neutral.armL.x, y: neutral.armL.y - armSwingLean };
      const swayArmR = { x: neutral.armR.x, y: neutral.armR.y + armSwingLean };
      const swayKneeL = { x: neutral.legL.x / 2, y: (swayHip.y + neutral.legL.y) / 2 };
      const swayKneeR = { x: neutral.legR.x / 2, y: (swayHip.y + neutral.legR.y) / 2 };
      const swayFootL = { x: neutral.legL.x, y: neutral.legL.y };
      const swayFootR = { x: neutral.legR.x, y: neutral.legR.y };
      // あぐら風: 膝を左右に大きく開き、足先は逆に体の中心近くまで寄せる(実エディタ: src/pose.ts と同じ値)
      const sitHip = { x: neutral.hip.x, y: neutral.hip.y + 16 };
      const sitArmL = { x: -10, y: 4 };
      const sitArmR = { x: 10, y: 4 };
      const sitKneeL = { x: -15, y: 3 };
      const sitKneeR = { x: 15, y: 3 };
      const sitFootL = { x: -3, y: 9 };
      const sitFootR = { x: 3, y: 9 };
      hip.x = lerp(swayHip.x, sitHip.x, this.sitAmt);
      hip.y = lerp(swayHip.y, sitHip.y, this.sitAmt);
      head.cx = lerp(swayHeadCx, neutral.head.cx, this.sitAmt);
      head.cy += this.sitAmt * 13;
      neck.x = lerp(swayNeckX, neutral.neck.x, this.sitAmt);
      neck.y += this.sitAmt * 13;
      armL = { x: lerp(swayArmL.x, sitArmL.x, this.sitAmt), y: lerp(swayArmL.y, sitArmL.y, this.sitAmt) };
      armR = { x: lerp(swayArmR.x, sitArmR.x, this.sitAmt), y: lerp(swayArmR.y, sitArmR.y, this.sitAmt) };
      kneeL = { x: lerp(swayKneeL.x, sitKneeL.x, this.sitAmt), y: lerp(swayKneeL.y, sitKneeL.y, this.sitAmt) };
      kneeR = { x: lerp(swayKneeR.x, sitKneeR.x, this.sitAmt), y: lerp(swayKneeR.y, sitKneeR.y, this.sitAmt) };
      footL = { x: lerp(swayFootL.x, sitFootL.x, this.sitAmt), y: lerp(swayFootL.y, sitFootL.y, this.sitAmt) };
      footR = { x: lerp(swayFootR.x, sitFootR.x, this.sitAmt), y: lerp(swayFootR.y, sitFootR.y, this.sitAmt) };
    }

    // 足にもjumpYを足しているのは、体だけ浮いて脚が地面に取り残されたように伸びて見えるのを防ぐため
    head.cy += jumpY + hopY;
    neck.y += jumpY + hopY;
    hip.y += jumpY + hopY;
    armL.y += jumpY + hopY;
    armR.y += jumpY + hopY;
    kneeL.y += jumpY;
    kneeR.y += jumpY;
    footL.y += jumpY + hopY * 0.4;
    footR.y += jumpY + hopY * 0.4;

    // 助走/着地の踏ん張り中は肘をさらに曲げ、ジャンプの頂点に近づくほど腕を伸ばし切る(実エディタと同じ)
    const elbowBend = isTyping
      ? 1.5
      : isSelecting
        ? 3
        : isBase
          ? 0
          : this.jumpPhase === 'anticipate' || this.jumpPhase === 'brace'
            ? 1.6 + crouchAmt * 2
            : this.jumpPhase === 'arc'
              ? lerp(1.6, 0.4, arcTuckAmt)
              : 1.6;

    // キャレットのフリをしている間だけ点滅させる(実エディタと同じ)
    let blinkOpacity: number | null = null;
    if (isCaretPose) {
      const blinkElapsed = now - this.stateEnteredAt - CARET_POSE_DELAY_MS;
      blinkOpacity = Math.floor(blinkElapsed / BLINK_HALF_MS) % 2 === 0 ? 1 : 0;
    }

    return {
      head,
      neck,
      hip,
      armL,
      armR,
      kneeL,
      kneeR,
      legL: footL,
      legR: footR,
      elbowBend,
      squashAmt: this.squashAmt,
      blinkOpacity,
      status: DEMO_STATES.find((s) => s.value === demoState)?.label ?? demoState,
    };
  }
}
