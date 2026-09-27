import { lerp } from './utils';
import type { Point, Pose, JumpPhase } from './types';

const LONG_IDLE_MS = 10000;
const SWING_PERIOD_MS = 2600;
const GIVE_UP_MS = 5 * 60 * 1000; // 5分煽ったら諦めて座る
const TYPE_HOLD_MS = 300;
const ANTICIPATE_DURATION = 130;
const JUMP_DURATION = 350;
const BRACE_DURATION = 220;
const WALK_PHASE_MS = 140; // 歩行の4コマ切り替え間隔(常に一定。速さは移動そのものの速さで表現する)
const THROW_DURATION = 220;
const CONFIRM_HOP_DURATION = 180; // 変換確定時の小さいホップ
const ARM_RISE_SPEED = 0.22; // 腕を上げ直す速さ(0.2秒程度で戻る)
const SIT_SPEED = 0.05; // 座り込みへの遷移速度
const SQUASH_SPEED = 0.15; // 文字の間にいる時に体を薄くする速度

// 肘は「肩と手の中点を少し前へ膨らませる」ことで、なめらかな曲げの制御点として使う
// (決定版レンダリングでの検証値。選択/貼り付けポーズ実装時は専用の値を追加する)
const TYPING_ELBOW_BEND = 1.5;
const DEFAULT_ELBOW_BEND = 2.5;

const neutral = {
  head: { cx: 0, cy: -32, r: 6 },
  neck: { x: 0, y: -26 },
  hip: { x: 0, y: -8 }, // 胴を10%短縮(neck-26から-8)
  armL: { x: -11.1, y: -9 },
  armR: { x: 11.1, y: -9 },
  legL: { x: -6, y: 8 },
  legR: { x: 6, y: 8 },
};

export interface ComputePoseOptions {
  /** キャレットの後ろに文字があるか(=文字の間にいるか) */
  betweenChars: boolean;
  /** 助走(anticipate)が終わって跳躍(arc)に切り替わった瞬間に呼ばれる */
  onEnterArc?: () => void;
}

export class StickmanState {
  private lastKeyTime: number;
  private leanPhase = 0;
  private armRaiseAmt = 1; // 0=下ろした状態 / 1=上げきった状態
  private sitAmt = 0; // 0=立っている / 1=座り込み完了
  private squashAmt = 0; // 0=通常 / 1=文字の間で極限まで薄い
  private jumpPhase: JumpPhase = 'none';
  private anticipateStart = 0;
  private jumpStart = 0;
  private braceStart = 0;
  private throwActive = false;
  private throwLineJump = false; // 投げ中に行またぎが起きた場合、フルジャンプの代わりに小さい跳ねを重ねる簡易版にする
  private throwStart = 0;
  private confirmHopActive = false;
  private confirmHopStart = 0;
  private composing = false;
  private focused = true;

  constructor(now: number) {
    // 短い待機(腕を上げたデフォルトポーズ)から開始
    this.lastKeyTime = now - (TYPE_HOLD_MS + 1);
  }

  recordActivity(now: number): void {
    this.lastKeyTime = now;
  }

  setComposing(v: boolean): void {
    this.composing = v;
  }

  isComposing(): boolean {
    return this.composing;
  }

  setFocused(v: boolean): void {
    this.focused = v;
  }

  isFocused(): boolean {
    return this.focused;
  }

  getJumpPhase(): JumpPhase {
    return this.jumpPhase;
  }

  isThrowActive(): boolean {
    return this.throwActive;
  }

  triggerJumpAnticipate(now: number): void {
    this.jumpPhase = 'anticipate';
    this.anticipateStart = now;
  }

  triggerThrow(now: number): void {
    this.throwActive = true;
    this.throwStart = now;
  }

  markThrowLineJump(): void {
    this.throwLineJump = true;
  }

  triggerConfirmHop(now: number): void {
    this.confirmHopActive = true;
    this.confirmHopStart = now;
  }

  /** デバッグ用: 「5分経過」状態にremainingMsだけ早く到達させる */
  debugFastForwardToGivenUp(now: number, remainingMs: number): void {
    this.lastKeyTime = now - (LONG_IDLE_MS + GIVE_UP_MS) + remainingMs;
  }

  computePose(now: number, opts: ComputePoseOptions): Pose {
    const dt = now - this.lastKeyTime;
    const inJumpSeq = this.jumpPhase !== 'none';
    const isTyping = !inJumpSeq && dt < TYPE_HOLD_MS;
    const isGivenUp = !inJumpSeq && !isTyping && dt >= LONG_IDLE_MS + GIVE_UP_MS;
    const isLongIdle = !inJumpSeq && !isTyping && !isGivenUp && dt >= LONG_IDLE_MS;
    const isShortIdle = !inJumpSeq && !isTyping && !isGivenUp && !isLongIdle;

    // 長い待機の体重移動フェーズ(あきらめたら目標0にして自然に静止へ)
    const leanTarget = isLongIdle ? Math.sin((now / SWING_PERIOD_MS) * Math.PI * 2) : 0;
    this.leanPhase += (leanTarget - this.leanPhase) * 0.05;

    // 立ってる状態⇔座り込み、をなめらかに繋ぐための係数
    const sitTarget = isGivenUp ? 1 : 0;
    this.sitAmt += (sitTarget - this.sitAmt) * SIT_SPEED;

    // 腕を上げ直す速度だけ速くする(下ろすのは即座)
    const armRaiseTarget = isShortIdle ? 1 : 0;
    if (armRaiseTarget > this.armRaiseAmt) {
      this.armRaiseAmt += (armRaiseTarget - this.armRaiseAmt) * ARM_RISE_SPEED;
    } else {
      this.armRaiseAmt = armRaiseTarget;
    }

    // 文字の間にいる時だけ、体を極限まで薄くする
    this.squashAmt += ((opts.betweenChars ? 1 : 0) - this.squashAmt) * SQUASH_SPEED;

    // 助走の踏み込み(anticipate) → 跳躍(arc) → 着地の踏ん張り(brace)
    let jumpY = 0;
    let arcTuckAmt = 0;
    let crouchAmt = 0;
    if (this.jumpPhase === 'anticipate') {
      const progress = Math.min(1, (now - this.anticipateStart) / ANTICIPATE_DURATION);
      crouchAmt = Math.sin((progress * Math.PI) / 2);
      if (progress >= 1) {
        this.jumpPhase = 'arc';
        this.jumpStart = now;
        opts.onEnterArc?.(); // 踏み込みが終わった瞬間に、ジャンプの弧に合わせて次の行へ移動開始
      }
    } else if (this.jumpPhase === 'arc') {
      const progress = Math.min(1, (now - this.jumpStart) / JUMP_DURATION);
      jumpY = -Math.sin(progress * Math.PI) * 20;
      arcTuckAmt = Math.sin(progress * Math.PI); // 空中では膝を曲げて足を引き上げ、地面との間を空ける
      if (progress >= 1) {
        this.jumpPhase = 'brace';
        this.braceStart = now;
        crouchAmt = 1; // 切り替わった瞬間から即座に最大まで曲げておく(1フレーム遅延の防止)
      }
    } else if (this.jumpPhase === 'brace') {
      const progress = Math.min(1, (now - this.braceStart) / BRACE_DURATION);
      crouchAmt = Math.cos((progress * Math.PI) / 2); // 着地の瞬間に最大まで曲げ、そこから伸び上がる
      if (progress >= 1) this.jumpPhase = 'none';
    }

    // 文字を消す時の「掴んで放り投げる」ジェスチャー
    let throwProgress = -1;
    let comboHopY = 0;
    if (this.throwActive) {
      throwProgress = Math.min(1, (now - this.throwStart) / THROW_DURATION);
      if (this.throwLineJump) comboHopY = -Math.sin(throwProgress * Math.PI) * 10;
      if (throwProgress >= 1) {
        this.throwActive = false;
        this.throwLineJump = false;
      }
    }

    // IME変換確定時の小さいホップ(改行ジャンプとは別の、軽い一発だけの跳ね)
    let hopY = 0;
    let hopLeanAmt = 0;
    if (this.confirmHopActive) {
      const hopProgress = Math.min(1, (now - this.confirmHopStart) / CONFIRM_HOP_DURATION);
      hopY = -Math.sin(hopProgress * Math.PI) * 7;
      hopLeanAmt = Math.sin(hopProgress * Math.PI); // 跳んでいる最中がピークになる前傾具合
      if (hopProgress >= 1) this.confirmHopActive = false;
    }

    const status = this.confirmHopActive
      ? '変換確定'
      : this.jumpPhase === 'anticipate'
        ? '助走'
        : this.jumpPhase === 'arc'
          ? 'ジャンプ中'
          : this.jumpPhase === 'brace'
            ? '着地'
            : this.throwActive
              ? '放り投げ'
              : isTyping
                ? '打っている'
                : isGivenUp
                  ? 'あきらめて着席'
                  : isLongIdle
                    ? '長い待機'
                    : '短い待機';

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
      // 助走の踏み込み/着地の踏ん張り: 足は地面(neutral)に固定したまま、
      // 膝を曲げて腰と頭が一緒に沈み込む(ニュートラルから正しくブレンド)
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
      footL = { x: neutral.legL.x, y: neutral.legL.y }; // 足は地面に固定(踏ん張り)
      footR = { x: neutral.legR.x, y: neutral.legR.y };
    } else if (this.jumpPhase === 'arc') {
      // 空中: 膝を曲げて足を引き上げ、地面との間にはっきり余白を作る
      const standKneeL = { x: neutral.legL.x / 2, y: (neutral.hip.y + neutral.legL.y) / 2 };
      const standKneeR = { x: neutral.legR.x / 2, y: (neutral.hip.y + neutral.legR.y) / 2 };
      const tuckKneeL = { x: -6, y: -5 };
      const tuckKneeR = { x: 6, y: -5 };
      const tuckFootL = { x: -4, y: 1 };
      const tuckFootR = { x: 4, y: 1 };
      kneeL = { x: lerp(standKneeL.x, tuckKneeL.x, arcTuckAmt), y: lerp(standKneeL.y, tuckKneeL.y, arcTuckAmt) };
      kneeR = { x: lerp(standKneeR.x, tuckKneeR.x, arcTuckAmt), y: lerp(standKneeR.y, tuckKneeR.y, arcTuckAmt) };
      footL = { x: lerp(neutral.legL.x, tuckFootL.x, arcTuckAmt), y: lerp(neutral.legL.y, tuckFootL.y, arcTuckAmt) };
      footR = { x: lerp(neutral.legR.x, tuckFootR.x, arcTuckAmt), y: lerp(neutral.legR.y, tuckFootR.y, arcTuckAmt) };
      armL = { x: neutral.armL.x, y: neutral.armL.y };
      armR = { x: neutral.armR.x, y: neutral.armR.y };
    } else if (this.throwActive) {
      // 両手を画面左に寄せて掴み、片足を前に踏み込みながら両手ごと画面右へ振り抜く
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

      // 片足(左)を前に大きく踏み込んで全力感を出す
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
    } else if (isTyping) {
      // 真横から見た歩行サイクル(4コマ): 接地(前)→振り出し中→接地(反転)→振り出し中→...
      // ※ 前後2コマの単純な入れ替えだと左右の脚が同じ形で描画されるため絵が変わらないバグを踏んだので、
      //   間に「片方の脚が浮いて振り出し中」の非対称なコマを挟んだ4コマ構成にしている
      const front = { x: 9, y: 8.4 };
      const frontKnee = { x: 4, y: 3 };
      const back = { x: -10.2, y: 7.6 };
      const backKnee = { x: -3, y: -2 };
      const swingFoot = { x: 0, y: 3 }; // 振り出し中、膝を高く曲げて浮かせた脚
      const swingKnee = { x: 2, y: -7 };
      const plantFoot = { x: 0, y: 8 }; // 振り出し中、支えてる方の脚(腰の真下でほぼ直立)
      const plantKnee = { x: 0, y: 3 };
      const armFwd = { x: -7.4, y: -15.9 };
      const armBack = { x: 10, y: -18.5 };
      const bounce = 1.6;
      const phase = Math.floor(now / WALK_PHASE_MS) % 4;

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
      const bounceAmt = phase % 2 === 1 ? bounce : bounce * 0.3; // 振り出し中の方が体は高く上がる
      head.cy -= bounceAmt;
      neck.y -= bounceAmt;
      hip.y -= bounceAmt;
    } else if (this.confirmHopActive) {
      // 変換確定の小さいホップ: 左から右へ跳ぶイメージで、前傾しながら腕・脚が後方(左)へ流れる
      head.cx += hopLeanAmt * 6;
      neck.x += hopLeanAmt * 4;
      hip.x += hopLeanAmt * 3;
      armL = { x: neutral.armL.x - hopLeanAmt * 10, y: neutral.armL.y + hopLeanAmt * 5 };
      armR = { x: neutral.armR.x + hopLeanAmt * 10, y: neutral.armR.y - hopLeanAmt * 7 };
      kneeL = { x: neutral.legL.x / 2 - hopLeanAmt * 6, y: (hip.y + neutral.legL.y) / 2 + hopLeanAmt * 3 };
      kneeR = { x: neutral.legR.x / 2 + hopLeanAmt * 4, y: (hip.y + neutral.legR.y) / 2 - hopLeanAmt * 2 };
      footL = { x: neutral.legL.x - hopLeanAmt * 9, y: neutral.legL.y };
      footR = { x: neutral.legR.x + hopLeanAmt * 7, y: neutral.legR.y - hopLeanAmt * 3 };
    } else if (isShortIdle) {
      // 通常時: 腕を上げてキャレットのフリをする(上げ直しは0.2秒くらいで)
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

      // 文字の間にいる時は、腕・脚を中心軸まで寄せてほぼ棒状に潰す
      armL.x = lerp(armL.x, 0, this.squashAmt * 0.9);
      armR.x = lerp(armR.x, 0, this.squashAmt * 0.9);
      kneeL.x = lerp(kneeL.x, 0, this.squashAmt * 0.9);
      kneeR.x = lerp(kneeR.x, 0, this.squashAmt * 0.9);
      footL.x = lerp(footL.x, 0, this.squashAmt * 0.9);
      footR.x = lerp(footR.x, 0, this.squashAmt * 0.9);
    } else {
      // 長い待機(体重移動) ⇔ 諦めて座り込み、をsitAmtでなめらかに繋ぐ
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

      const sitHip = { x: neutral.hip.x, y: neutral.hip.y + 16 };
      const sitArmL = { x: -8, y: 4 };
      const sitArmR = { x: 8, y: 4 };
      const sitKneeL = { x: -10, y: 6 };
      const sitKneeR = { x: 10, y: 6 };
      const sitFootL = { x: -15, y: 8 };
      const sitFootR = { x: 15, y: 8 };

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

    // ジャンプの跳ね上がり(jumpY)・変換確定ホップ(hopY)はどの状態の上にも重ねる
    head.cy += jumpY + hopY + comboHopY;
    neck.y += jumpY + hopY + comboHopY;
    hip.y += jumpY + hopY + comboHopY;
    armL.y += jumpY + hopY + comboHopY;
    armR.y += jumpY + hopY + comboHopY;
    footL.y += (hopY + comboHopY) * 0.4;
    footR.y += (hopY + comboHopY) * 0.4;

    const elbowBend = isTyping ? TYPING_ELBOW_BEND : DEFAULT_ELBOW_BEND;

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
      status,
    };
  }
}
