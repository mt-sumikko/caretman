import { lerp, lerpPoint } from '../utils';
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
const THROW_DURATION = 380; // 実エディタのTHROW_DURATION_BASEと同じ値
const CONFIRM_HOP_DURATION = 240; // 実エディタのHOP_DURATIONと同じ値
const ARM_RISE_SPEED = 0.22;
const SIT_SPEED = 0.05;
const SQUASH_SPEED = 0.15;
const LONG_IDLE_SWING_MS = 1800; // 実エディタのSWING_PERIOD_MSと同じ値
const TAUNT_SPEED = 0.08; // 実エディタと同じ値
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
  private tauntAmt = 0;
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
  private hopDir = -1; // 確認用に、再生するたび右(1)と左(-1)を交互に切り替える
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
      this.hopDir = -this.hopDir;
    }

    // 左右の端でグッと粘ってから素早く反対へ移るリズム(実エディタと同じ)
    const swing = Math.sin((now / LONG_IDLE_SWING_MS) * Math.PI * 2);
    const leanTarget = isLongIdle ? Math.sign(swing) * Math.sqrt(Math.abs(swing)) : 0;
    this.leanPhase += (leanTarget - this.leanPhase) * 0.12;
    this.tauntAmt += ((isLongIdle ? 1 : 0) - this.tauntAmt) * TAUNT_SPEED;

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
      hopLeanAmt =
        hopProgress < 0.35 // 出だしで一気にダッシュ姿勢になり(肘に引っぱられる瞬間)、そこからゆっくり戻る
        ? 1 - (1 - hopProgress / 0.35) ** 2
        : 1 - ((hopProgress - 0.35) / 0.65) ** 2;
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

    let branchElbowBend: number | null = null; // 放り投げ/ホップ中だけ使う肘の曲げ具合
    let elbowLOverride: Point | undefined; // 肘の位置を直接指定する時だけ使う(ホップの肘突き)
    let elbowROverride: Point | undefined;
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
      // 腕は頂点に向かって振り上げていく(実エディタ: src/pose.ts と同じ値)
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
      // 肩から斜め上へ腕の長さを保ったままV字に振り上げた位置。体と一緒にjumpYで持ち上がるので、体に対する
      // 相対位置として考える(実エディタ: src/pose.ts と同じ値)
      const raiseArmL = { x: -11, y: -32 };
      const raiseArmR = { x: 11, y: -32 };
      armL = { x: lerp(neutral.armL.x, raiseArmL.x, arcTuckAmt), y: lerp(neutral.armL.y, raiseArmL.y, arcTuckAmt) };
      armR = { x: lerp(neutral.armR.x, raiseArmR.x, arcTuckAmt), y: lerp(neutral.armR.y, raiseArmR.y, arcTuckAmt) };
    } else if (this.throwActive) {
      // 放り投げ(棒人間は左向き=消した文字を背中側の画面右へ投げ捨てる):
      // ①溜め: 左足を大きく踏み込んで低く沈み、前屈みで足元から両手で掬うように掴む
      // ②投げ: 初速最大で体を右後ろへのけぞらせ、腕を伸ばし切って右上へ振り抜く(勢いで前足が浮く)
      // ③余韻: 振り抜いた姿勢で一瞬止める → ④元の立ち姿へ戻る
      const p = throwProgress;
      const easeOut = (x: number): number => 1 - (1 - x) * (1 - x);
      // 構え全体の強さ(溜めで0→1、余韻の後に1→0)と、溜め→投げの切り替わり具合(0=溜め/1=振り抜き)
      const powerT = p < 0.3 ? easeOut(p / 0.3) : p < 0.75 ? 1 : 1 - easeOut((p - 0.75) / 0.25);
      const throwT = p < 0.3 ? 0 : p < 0.55 ? easeOut((p - 0.3) / 0.25) : 1;

      // 胴: 溜めは前(左)に屈んで沈み、投げでは後ろ(右)へのけぞって伸び上がる
      hip.x += lerp(-2, 1, throwT) * powerT;
      hip.y += lerp(10, 2, throwT) * powerT;
      neck.x += lerp(-11, 8, throwT) * powerT;
      neck.y += lerp(11, 2, throwT) * powerT;
      head.cx += lerp(-14, 10, throwT) * powerT;
      head.cy += lerp(11, 2, throwT) * powerT;

      // 腕: 足元で掴む → 右上へ伸ばし切って振り抜く(腕の長さはどちらも肩から約16〜18)
      const grabL = { x: -21, y: 1 };
      const grabR = { x: -18, y: 3 };
      const tossL = { x: 18, y: -30 };
      const tossR = { x: 21, y: -25 };
      armL = lerpPoint(neutral.armL, lerpPoint(grabL, tossL, throwT), powerT);
      armR = lerpPoint(neutral.armR, lerpPoint(grabR, tossR, throwT), powerT);

      // 脚: 溜めは左足を踏み込んで膝を曲げ、右足は後ろにまっすぐ。投げでは前足が勢いで浮き上がって伸び、
      // 体重を受ける後ろ足の膝が少し曲がる
      const plantFootL = { x: -17, y: neutral.legL.y };
      const kickFootL = { x: -13, y: 1 };
      footL = lerpPoint(neutral.legL, lerpPoint(plantFootL, kickFootL, throwT), powerT);
      footR = lerpPoint(neutral.legR, { x: 14, y: neutral.legR.y }, powerT);
      const bentKneeL = { x: hip.x - 9, y: hip.y - 1 };
      const bentKneeR = { x: hip.x + 7, y: hip.y + 5 };
      kneeL = lerpPoint(lerpPoint(hip, footL, 0.5), bentKneeL, (1 - throwT) * powerT);
      kneeR = lerpPoint(lerpPoint(hip, footR, 0.5), bentKneeR, throwT * powerT * 0.4);

      // 肘: 掴む時は曲げて力を溜め、振り抜いたら伸ばし切る
      branchElbowBend = lerp(1.6, lerp(3.5, 0.2, throwT), powerT);
    } else if (this.confirmHopActive) {
      // 大きな横移動のホップ: 進行方向側の肘を曲げて前に突き出し、その肘に引っぱられるように飛び出す。
      // 反対の腕は後ろへまっすぐ伸ばし、後ろ脚は斜めに蹴り出し、前脚は膝を上げて踏み出す。
      // 座標は右へ飛ぶ場合で書いてあり、左へ飛ぶ時はd=-1にしてx方向だけ左右反転する
      const d = this.hopDir;
      const a = hopLeanAmt;
      hip.x += d * a;
      hip.y += a;
      neck.x += d * 6 * a;
      neck.y += 1.5 * a;
      head.cx += d * 7.8 * a;
      head.cy += 1.3 * a;
      const shoulder = { x: neck.x + (hip.x - neck.x) * 0.3, y: neck.y + (hip.y - neck.y) * 0.3 }; // render.tsの肩と同じ位置
      const leadHand = lerpPoint(d > 0 ? neutral.armR : neutral.armL, { x: shoulder.x + d * 2.5, y: shoulder.y + 3.5 }, a);
      const leadElbowAuto = { x: (shoulder.x + leadHand.x) / 2, y: (shoulder.y + leadHand.y) / 2 + 1.6 };
      const leadElbow = lerpPoint(leadElbowAuto, { x: shoulder.x + d * 8.5, y: shoulder.y + 0.3 }, a);
      const trailHand = lerpPoint(d > 0 ? neutral.armL : neutral.armR, { x: shoulder.x - d * 16, y: shoulder.y - 0.5 }, a);
      const backFoot = lerpPoint(d > 0 ? neutral.legL : neutral.legR, { x: hip.x - d * 10, y: neutral.legL.y }, a);
      const backKnee = lerpPoint(hip, backFoot, 0.5);
      const frontFoot = lerpPoint(d > 0 ? neutral.legR : neutral.legL, { x: hip.x + d * 8.5, y: hip.y + 10 }, a);
      const frontKnee = lerpPoint(lerpPoint(hip, frontFoot, 0.5), { x: hip.x + d * 8, y: hip.y + 1 }, a);
      if (d > 0) {
        armR = leadHand;
        elbowROverride = leadElbow;
        armL = trailHand;
        footL = backFoot;
        kneeL = backKnee;
        footR = frontFoot;
        kneeR = frontKnee;
      } else {
        armL = leadHand;
        elbowLOverride = leadElbow;
        armR = trailHand;
        footR = backFoot;
        kneeR = backKnee;
        footL = frontFoot;
        kneeL = frontKnee;
      }
      branchElbowBend = lerp(1.6, 0.3, a); // 後ろへ伸ばす腕はまっすぐに
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
      // 貼り付け: 貼り付けた文字を全力で押し込む構え(棒人間は左向き)。上半身を約40°前傾させて腰を低く落とし、
      // 両腕を画面左へまっすぐ突き出す。前脚(左)は膝を曲げて踏ん張り、後ろ脚(右)は膝を地面近くまで落として
      // 足先を画面右へ大きく残し、地面を蹴っている形にする
      hip.x += 3;
      hip.y += 7;
      // 前傾+脚を縮めた姿勢だと胴が長く見えるので、このポーズだけ胴を短め(約14)に詰めている
      neck.x -= 6;
      neck.y += 14.3;
      head.cx -= 10.2; // 頭は胴の延長線上
      head.cy += 15.3;
      armL = { x: -20, y: -9 }; // 頭にかからない高さで、2本の腕を上下に並べる
      armR = { x: -19, y: -4 };
      kneeL = { x: -7, y: -1 };
      footL = { x: -13, y: 8 };
      kneeR = { x: 7, y: 6 };
      footR = { x: 15, y: 8 };
      branchElbowBend = 0.3; // 腕はしっかり伸ばし切る
    } else if (isBase) {
      armL = { x: neutral.armL.x, y: neutral.armL.y };
      armR = { x: neutral.armR.x, y: neutral.armR.y };
      kneeL = { x: neutral.legL.x / 2, y: (hip.y + neutral.legL.y) / 2 };
      kneeR = { x: neutral.legR.x / 2, y: (hip.y + neutral.legR.y) / 2 };
      footL = { x: neutral.legL.x, y: neutral.legL.y };
      footR = { x: neutral.legR.x, y: neutral.legR.y };
    } else {
      // 長い待機(煽り: 腕を真横、片膝ずつ曲げて大きく体重移動) ⇔ 諦めて座り込み(実エディタ: src/pose.ts と同じ値)
      const lean = this.leanPhase;
      const bendL = Math.max(0, -lean);
      const bendR = Math.max(0, lean);
      const dip = Math.abs(lean) * 4;
      const tauntHip = { x: lean * 5, y: neutral.hip.y + dip };
      const tauntNeckY = neutral.neck.y + dip;
      const shoulderY = tauntNeckY + (tauntHip.y - tauntNeckY) * 0.3;
      const tauntFootL = { x: -8 - bendL * 4, y: neutral.legL.y };
      const tauntFootR = { x: 8 + bendR * 4, y: neutral.legR.y };
      const tauntKneeL = lerpPoint(lerpPoint(tauntHip, tauntFootL, 0.5), { x: tauntHip.x - 9, y: tauntHip.y + 2 }, bendL);
      const tauntKneeR = lerpPoint(lerpPoint(tauntHip, tauntFootR, 0.5), { x: tauntHip.x + 9, y: tauntHip.y + 2 }, bendR);
      const tauntArmL = { x: tauntHip.x - 15, y: shoulderY - lean * 1.5 };
      const tauntArmR = { x: tauntHip.x + 15, y: shoulderY + lean * 1.5 };

      const t = this.tauntAmt;
      const swayHip = lerpPoint(neutral.hip, tauntHip, t);
      const swayHeadCx = swayHip.x + lean * 1.2 * t;
      const swayNeckX = swayHip.x;
      const swayDip = dip * t;
      const swayArmL = lerpPoint(neutral.armL, tauntArmL, t);
      const swayArmR = lerpPoint(neutral.armR, tauntArmR, t);
      const swayKneeL = lerpPoint({ x: neutral.legL.x / 2, y: (neutral.hip.y + neutral.legL.y) / 2 }, tauntKneeL, t);
      const swayKneeR = lerpPoint({ x: neutral.legR.x / 2, y: (neutral.hip.y + neutral.legR.y) / 2 }, tauntKneeR, t);
      const swayFootL = lerpPoint(neutral.legL, tauntFootL, t);
      const swayFootR = lerpPoint(neutral.legR, tauntFootR, t);
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
      head.cy += lerp(swayDip, 13, this.sitAmt);
      neck.x = lerp(swayNeckX, neutral.neck.x, this.sitAmt);
      neck.y += lerp(swayDip, 13, this.sitAmt);
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
    if (elbowLOverride) elbowLOverride.y += jumpY + hopY;
    if (elbowROverride) elbowROverride.y += jumpY + hopY;
    armR.y += jumpY + hopY;
    kneeL.y += jumpY;
    kneeR.y += jumpY;
    footL.y += jumpY + hopY * 0.4;
    footR.y += jumpY + hopY * 0.4;

    // 助走/着地の踏ん張り中は肘をさらに曲げ、ジャンプの頂点に近づくほど腕を伸ばし切る(実エディタと同じ)
    const elbowBend = branchElbowBend !== null
      ? branchElbowBend
      : isTyping
      ? 1.5
      : isSelecting
        ? 3
        : isBase
          ? 0
          : this.jumpPhase === 'anticipate' || this.jumpPhase === 'brace'
            ? 1.6 + crouchAmt * 4.5
            : this.jumpPhase === 'arc'
              ? lerp(1.6, 0.4, arcTuckAmt)
              : lerp(1.6, 0.2, this.tauntAmt * (1 - this.sitAmt));

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
      elbowL: elbowLOverride,
      elbowR: elbowROverride,
      squashAmt: this.squashAmt,
      blinkOpacity,
      status: DEMO_STATES.find((s) => s.value === demoState)?.label ?? demoState,
    };
  }
}
