import { lerp, lerpPoint } from './utils';
import type { Point, Pose, JumpPhase } from './types';

/**
 * このファイルの役割(ざっくり):
 * 棒人間の「今の姿勢(頭・肩・肘・腰・膝・足の座標)」を計算するだけのファイル。
 * 画面には何も描かず、実際の見た目を絵として描くのはrender.tsの仕事。
 *
 * 中心になっているのは StickmanState.computePose() というメソッドで、
 * 「最後にキー入力があってからどれくらい時間が経ったか」や「今選択中かどうか」等の
 * 状態をもとに、if/elseで「今は打っている最中」「今はジャンプ中」のように場合分けし、
 * それぞれの場合に合わせた座標を返している。
 * 座標はすべて相対値(原点(0,0)からの距離)で、ピクセルそのものではない。
 * 実際の画面サイズへの変換(フォントサイズに応じた拡大)はeditor.ts側で行う。
 */

export const LONG_IDLE_MS = 30000; // これだけ何も操作がないと「長い待機(煽り)」(10秒だと早すぎたので30秒に)
const CARET_POSE_DELAY_MS = 3000; // 打つ/歩行の手を止めてから、キャレットのフリ(腕上げ)を始めるまでの間(基本ポーズで繋ぐ)
const SWING_PERIOD_MS = 1800; // 長い待機(煽り)で左右に体重移動する1往復の時間。せわしなさ=ウザさ
const TAUNT_SPEED = 0.08; // 通常の立ち姿⇔煽りポーズ(腕を真横・広いスタンス)の切り替え速度
const GIVE_UP_MS = 5 * 60 * 1000; // 5分煽ったら諦めて座る
export const TYPE_HOLD_MS = 300; // 最後の入力・移動からこの間は「打っている(歩き)」
const ANTICIPATE_DURATION = 130;
const JUMP_DURATION = 350;
const BRACE_DURATION = 220;
const WALK_CYCLE_MS = 560; // 歩行の1周期(左右1歩ずつ)。常に一定で、進む速さは移動そのものの速さで表現する
const THROW_DURATION_BASE = 380; // 溜め→振り抜き→余韻→戻り、の一連を見せられる長さ
const THROW_DURATION_MAX = 650;
const THROW_DURATION_PER_CHAR = 12; // 削除した文字数が多いほど、放り投げの余韻を長くする
const PASTE_DURATION_BASE = 220;
const PASTE_DURATION_MAX = 520;
const PASTE_DURATION_PER_CHAR = 12; // 貼り付けた文字量が多いほど、押し込む動作の余韻を長くする(放り投げと対称)
export const HOP_DURATION = 240; // 同一行内で大きく横移動した時の「複数文字ホップ」。editor.tsの横移動アニメもこの長さに揃える
const ARM_RISE_SPEED = 0.22; // 腕を上げ直す速さ(0.2秒程度で戻る)
const SIT_SPEED = 0.05; // 座り込みへの遷移速度
const SQUASH_SPEED = 0.15; // 文字の間にいる時に体を薄くする速度
const BLINK_HALF_MS = 530; // 一般的なキャレットの点滅速度(OSの既定値目安)

// 肘は「肩と手の中点を少し前へ膨らませる」ことで、なめらかな曲げの制御点として使う
// (決定版レンダリングでの検証値)
const TYPING_ELBOW_BEND = 1.5;
const SELECTING_ELBOW_BEND = 3;
const DEFAULT_ELBOW_BEND = 1.6; // 通常時の肘。上向きに曲がりすぎないよう、だらんとした腕に近づけた
const CROUCH_ELBOW_BEND_BOOST = 4.5; // 助走/着地の踏ん張り中、肘をさらに曲げて力の入った感じを足す
const TAUNT_ELBOW_BEND = 0.2; // 煽り中は腕を真横にピンと張る
const ARC_PEAK_ELBOW_BEND = 0.4; // ジャンプの頂点付近では、腕を伸ばし切った見た目にする

const neutral = {
  head: { cx: 0, cy: -32, r: 6 },
  neck: { x: 0, y: -26 },
  hip: { x: 0, y: -8 }, // 胴を10%短縮(neck-26から-8)
  armL: { x: -11.1, y: -9 },
  armR: { x: 11.1, y: -9 },
  legL: { x: -6, y: 8 },
  legR: { x: 6, y: 8 },
};
// 立ち姿の膝(腰と足先のちょうど中間=まっすぐ伸びた脚)
const standKneeL: Point = lerpPoint(neutral.hip, neutral.legL, 0.5);
const standKneeR: Point = lerpPoint(neutral.hip, neutral.legR, 0.5);

export interface ComputePoseOptions {
  /** キャレットの後ろに文字があるか(=文字の間にいるか) */
  betweenChars: boolean;
  /** 助走(anticipate)が終わって跳躍(arc)に切り替わった瞬間に呼ばれる */
  onEnterArc?: () => void;
}

export class StickmanState {
  private lastKeyTime: number;
  private leanPhase = 0; // -1=左足に体重 / 1=右足に体重
  private tauntAmt = 0; // 0=通常の立ち姿 / 1=煽りポーズ
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
  private throwDuration = THROW_DURATION_BASE;
  private pasteActive = false;
  private pasteLineJump = false; // 貼り付けで行をまたいだ場合、フルジャンプの代わりに小さい跳ねを重ねる(放り投げと同じ)
  private pasteStart = 0;
  private pasteDuration = PASTE_DURATION_BASE;
  private hopActive = false;
  private hopDir = 1; // 1=画面右へ / -1=画面左へ移動中
  private walkDir = 1; // 1=右向きに歩く / -1=左向きに歩く
  private hopStart = 0;
  private selecting = false;
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

  setSelecting(v: boolean): void {
    this.selecting = v;
  }

  getJumpPhase(): JumpPhase {
    return this.jumpPhase;
  }

  isThrowActive(): boolean {
    return this.throwActive;
  }

  isPasteActive(): boolean {
    return this.pasteActive;
  }

  /** 歩く向きをキャレットの移動方向に合わせる(dx=0の時は向きを変えない) */
  setWalkDir(dx: number): void {
    if (dx !== 0) this.walkDir = dx > 0 ? 1 : -1;
  }

  isHopActive(): boolean {
    return this.hopActive;
  }

  triggerJumpAnticipate(now: number): void {
    this.jumpPhase = 'anticipate';
    this.anticipateStart = now;
  }

  /** deletedLengthが大きいほど、放り投げの余韻(継続時間)を長くする */
  triggerThrow(now: number, deletedLength = 1): void {
    this.throwActive = true;
    this.throwStart = now;
    this.throwDuration = Math.min(
      THROW_DURATION_MAX,
      THROW_DURATION_BASE + Math.max(0, deletedLength - 1) * THROW_DURATION_PER_CHAR,
    );
  }

  markThrowLineJump(): void {
    this.throwLineJump = true;
  }

  /** pastedLengthが大きいほど、押し込む動作の余韻(継続時間)を長くする */
  triggerPaste(now: number, pastedLength = 1): void {
    this.pasteActive = true;
    this.pasteLineJump = false;
    this.pasteStart = now;
    this.pasteDuration = Math.min(
      PASTE_DURATION_MAX,
      PASTE_DURATION_BASE + Math.max(0, pastedLength - 1) * PASTE_DURATION_PER_CHAR,
    );
  }

  markPasteLineJump(): void {
    this.pasteLineJump = true;
  }

  /** 同一行内での大きな横移動(Home/End・単語単位の移動など)で発火する「複数文字ホップ」。dirは移動方向(正=右) */
  triggerHop(now: number, dir: number): void {
    this.hopActive = true;
    this.hopDir = dir >= 0 ? 1 : -1;
    this.hopStart = now;
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
    // 短い待機に入った直後は基本ポーズのまま少し繋ぎ、しばらくしてからキャレットのフリを始める
    const isCaretPose = isShortIdle && dt >= TYPE_HOLD_MS + CARET_POSE_DELAY_MS;

    // 長い待機の体重移動フェーズ(あきらめたら目標0にして自然に静止へ)。
    // サイン波の山を平らに潰し(|s|^0.5)、左右の端でグッと粘ってから素早く反対へ移る「よっ、ほっ」のリズムにする
    const swing = Math.sin((now / SWING_PERIOD_MS) * Math.PI * 2);
    const leanTarget = isLongIdle ? Math.sign(swing) * Math.sqrt(Math.abs(swing)) : 0;
    this.leanPhase += (leanTarget - this.leanPhase) * 0.12;
    this.tauntAmt += ((isLongIdle ? 1 : 0) - this.tauntAmt) * TAUNT_SPEED;

    // 立ってる状態⇔座り込み、をなめらかに繋ぐための係数
    const sitTarget = isGivenUp ? 1 : 0;
    this.sitAmt += (sitTarget - this.sitAmt) * SIT_SPEED;

    // 腕を上げ直す速度だけ速くする(下ろすのは即座)
    const armRaiseTarget = isCaretPose ? 1 : 0;
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
      throwProgress = Math.min(1, (now - this.throwStart) / this.throwDuration);
      if (this.throwLineJump) comboHopY = -Math.sin(throwProgress * Math.PI) * 10;
      if (throwProgress >= 1) {
        this.throwActive = false;
        this.throwLineJump = false;
      }
    }

    // 貼り付けた時の「全力で押し込む」構え
    if (this.pasteActive) {
      const pasteProgress = Math.min(1, (now - this.pasteStart) / this.pasteDuration);
      if (this.pasteLineJump) comboHopY = -Math.sin(pasteProgress * Math.PI) * 10;
      if (pasteProgress >= 1) {
        this.pasteActive = false;
        this.pasteLineJump = false;
      }
    }
    const isPasting = this.pasteActive && !inJumpSeq && !this.throwActive;

    // 同一行内での大きな移動時の小さいホップ(改行ジャンプとは別の、軽い一発だけの跳ね)
    let hopY = 0;
    let hopLeanAmt = 0;
    if (this.hopActive) {
      const hopProgress = Math.min(1, (now - this.hopStart) / HOP_DURATION);
      hopY = -Math.sin(hopProgress * Math.PI) * 7;
      hopLeanAmt =
        hopProgress < 0.35 // 出だしで一気にダッシュ姿勢になり(肘に引っぱられる瞬間)、そこからゆっくり戻る
        ? 1 - (1 - hopProgress / 0.35) ** 2
        : 1 - ((hopProgress - 0.35) / 0.65) ** 2;
      if (hopProgress >= 1) this.hopActive = false;
    }

    const isSelecting = this.selecting && !inJumpSeq && !this.throwActive && !isPasting;

    const status = this.jumpPhase === 'anticipate'
      ? '助走'
      : this.jumpPhase === 'arc'
        ? 'ジャンプ中'
        : this.jumpPhase === 'brace'
          ? '着地'
          : this.throwActive
            ? '放り投げ'
            : isPasting
              ? '貼り付け'
              : isSelecting
              ? '選択中'
              : this.hopActive
                ? '移動'
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

    let branchElbowBend: number | null = null; // 放り投げ/ホップ中だけ使う肘の曲げ具合
    let elbowLOverride: Point | undefined; // 肘の位置を直接指定する時だけ使う(ホップの肘突き)
    let elbowROverride: Point | undefined;
    if (this.jumpPhase === 'anticipate' || this.jumpPhase === 'brace') {
      // 助走の踏み込み/着地の踏ん張り: 足は地面(neutral)に固定したまま、
      // 膝を曲げて腰と頭が一緒に沈み込む(ニュートラルから正しくブレンド)
      const crouchKneeL = { x: -9, y: -1 };
      const crouchKneeR = { x: 9, y: -1 };

      hip.y += crouchAmt * 6;
      head.cy += crouchAmt * 6;
      neck.y += crouchAmt * 6;
      armL = lerpPoint(neutral.armL, { x: neutral.armL.x - 4, y: neutral.armL.y + 4 }, crouchAmt);
      armR = lerpPoint(neutral.armR, { x: neutral.armR.x + 4, y: neutral.armR.y + 4 }, crouchAmt);
      kneeL = lerpPoint(standKneeL, crouchKneeL, crouchAmt);
      kneeR = lerpPoint(standKneeR, crouchKneeR, crouchAmt);
      footL = { x: neutral.legL.x, y: neutral.legL.y }; // 足は地面に固定(踏ん張り)
      footR = { x: neutral.legR.x, y: neutral.legR.y };
    } else if (this.jumpPhase === 'arc') {
      // 空中: 膝を大きく曲げて足を体の下まで引き上げ、地面との間との距離を脚の長さではなく
      // 高さ(jumpY)そのもので見せる。腕は頂点に向かって振り上げていく
      const tuckKneeL = { x: -5, y: -7 };
      const tuckKneeR = { x: 5, y: -7 };
      const tuckFootL = { x: -3, y: -2 };
      const tuckFootR = { x: 3, y: -2 };
      kneeL = lerpPoint(standKneeL, tuckKneeL, arcTuckAmt);
      kneeR = lerpPoint(standKneeR, tuckKneeR, arcTuckAmt);
      footL = lerpPoint(neutral.legL, tuckFootL, arcTuckAmt);
      footR = lerpPoint(neutral.legR, tuckFootR, arcTuckAmt);
      // 肩(y≒-20.6)から斜め上へ、腕の長さ(約16)を保ったまま頭の横にV字で振り上げた位置。
      // 体と一緒にjumpYで持ち上がるので、ここは体に対する相対位置として考える(二重に見込むと腕が伸びすぎる)
      const raiseArmL = { x: -11, y: -32 };
      const raiseArmR = { x: 11, y: -32 };
      armL = lerpPoint(neutral.armL, raiseArmL, arcTuckAmt);
      armR = lerpPoint(neutral.armR, raiseArmR, arcTuckAmt);
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
      branchElbowBend = lerp(DEFAULT_ELBOW_BEND, lerp(3.5, 0.2, throwT), powerT);
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
    } else if (isSelecting) {
      // 選択ポーズ: 両腕を体幹に沿ってほぼ真上に伸ばし、手先だけわずかに右へ。重心は中央寄りに保つ。
      // 左足はつま先立ちで接地、右足は膝を上げる
      armL = { x: 4, y: -44 };
      armR = { x: 7, y: -42 };
      kneeL = { x: -3, y: 1 };
      kneeR = { x: 5, y: -6 };
      footL = { x: -4, y: 7 };
      footR = { x: 4, y: -1 };
    } else if (this.hopActive) {
      // 大きな横移動のホップ: 進行方向側の肘を曲げて前に突き出し、その肘に引っぱられるように飛び出す。
      // 反対の腕は後ろへまっすぐ伸ばし、後ろ脚は斜めに蹴り出し、前脚は膝を上げて踏み出す。
      // 座標は右へ飛ぶ場合で書いてあり、左へ飛ぶ時はd=-1にしてx方向だけ左右反転する
      const d = this.hopDir;
      const a = hopLeanAmt;
      hip.x += d * a;
      hip.y += a;
      // あくまで真横への移動なので、上半身はほぼ起こしたまま(胴の傾きは約11°、頭は首の真上)。
      // 斜めの勢いは、後ろへ大きく蹴り出した脚(約33°)で見せる
      neck.x += d * 3.5 * a;
      neck.y += a;
      head.cx += d * 3.5 * a;
      head.cy += a;
      const shoulder = { x: neck.x + (hip.x - neck.x) * 0.3, y: neck.y + (hip.y - neck.y) * 0.3 }; // render.tsの肩と同じ位置
      const leadHand = lerpPoint(d > 0 ? neutral.armR : neutral.armL, { x: shoulder.x + d, y: shoulder.y + 3 }, a);
      const leadElbowAuto = { x: (shoulder.x + leadHand.x) / 2, y: (shoulder.y + leadHand.y) / 2 + DEFAULT_ELBOW_BEND };
      const leadElbow = lerpPoint(leadElbowAuto, { x: shoulder.x + d * 8.5, y: shoulder.y + 0.2 }, a);
      const trailHand = lerpPoint(d > 0 ? neutral.armL : neutral.armR, { x: shoulder.x - d * 16, y: shoulder.y }, a);
      const backFoot = lerpPoint(d > 0 ? neutral.legL : neutral.legR, { x: hip.x - d * 9.8, y: neutral.legL.y }, a);
      // 脚は前後の膝を1本のなめらかな線で結んで描くため、そのままだと前脚の膝に引っぱられて後ろ脚が弓なりにしなる。
      // 膝を少しだけ逆側(後ろ上)へずらして打ち消し、ピンと伸びた1本の斜め線に見せる
      const backKnee = lerpPoint(lerpPoint(hip, backFoot, 0.5), { x: (hip.x + backFoot.x) / 2 - d * 1.5, y: (hip.y + backFoot.y) / 2 - 1 }, a);
      const frontFoot = lerpPoint(d > 0 ? neutral.legR : neutral.legL, { x: hip.x - d, y: hip.y + 11 }, a);
      const frontKnee = lerpPoint(lerpPoint(hip, frontFoot, 0.5), { x: hip.x + d * 6, y: hip.y + 0.5 }, a);
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
      branchElbowBend = lerp(DEFAULT_ELBOW_BEND, 0.3, a); // 後ろへ伸ばす腕はまっすぐに
    } else if (isTyping) {
      // 真横から見た歩行サイクル(画面右へ歩く)。コマを切り替えるのではなく、位相(0〜2π)を連続的に回してなめらかに動かす。
      // 左右の脚は半周期ずらし、腕は同じ側の脚と逆向きに振る
      const phase = ((now % WALK_CYCLE_MS) / WALK_CYCLE_MS) * Math.PI * 2;
      const spread = Math.abs(Math.sin(phase)); // 両脚の開き具合(1=前後に一番開いた瞬間)
      const bob = spread * 1.5 - 0.5; // 脚が開いた瞬間に腰が沈み、片脚が真下に来た瞬間に一番高くなる
      hip.x += 0.5;
      hip.y += bob;
      neck.x += 1.5; // 進行方向へほんの少し前傾
      neck.y += bob;
      head.cx += 2;
      head.cy += bob;
      const legAt = (ph: number): { foot: Point; knee: Point } => {
        // 足が前へ動いている間(cos>0)は宙に浮かせて振り出し、後ろへ動いている間は地面について体を運ぶ
        const lift = Math.max(0, Math.cos(ph)) ** 2;
        const foot = { x: hip.x + Math.sin(ph) * 9, y: neutral.legL.y - lift * 5 };
        const mid = lerpPoint(hip, foot, 0.5);
        // 膝は常に少し進行方向へ曲げ、振り出し中は大きく前へ出す
        return { foot, knee: { x: mid.x + 1 + lift * 4, y: mid.y - lift * 2.5 } };
      };
      const legLPose = legAt(phase);
      const legRPose = legAt(phase + Math.PI);
      footL = legLPose.foot;
      kneeL = legLPose.knee;
      footR = legRPose.foot;
      kneeR = legRPose.knee;
      const shoulder = { x: neck.x + (hip.x - neck.x) * 0.3, y: neck.y + (hip.y - neck.y) * 0.3 }; // render.tsの肩と同じ位置
      // 腕は肩から前後に約30°ずつ振る。前に振った腕ほど肘を曲げて前腕を持ち上げ、後ろの腕はほぼまっすぐにする
      const armAt = (ph: number): { hand: Point; elbow: Point } => {
        const upper = -Math.sin(ph) * 0.55; // 同じ側の脚と逆向き(正=前)
        const fore = upper + 0.5 + Math.max(0, -Math.sin(ph)) * 0.7; // 肘は常に少し曲げ、脚と腕が重なる瞬間も前腕が見えるように
        const elbow = { x: shoulder.x + Math.sin(upper) * 7.5, y: shoulder.y + Math.cos(upper) * 7.5 };
        return { elbow, hand: { x: elbow.x + Math.sin(fore) * 7.5, y: elbow.y + Math.cos(fore) * 7.5 } };
      };
      const armLPose = armAt(phase);
      const armRPose = armAt(phase + Math.PI);
      armL = armLPose.hand;
      elbowLOverride = armLPose.elbow;
      armR = armRPose.hand;
      elbowROverride = armRPose.elbow;
      // 左へ歩く時は、右向きの歩きをそのまま左右反転する(腰の真上 x=0 を軸に折り返す)
      if (this.walkDir < 0) {
        for (const p of [neck, hip, armL, armR, kneeL, kneeR, footL, footR, armLPose.elbow, armRPose.elbow]) p.x = -p.x;
        head.cx = -head.cx;
      }
    } else if (isShortIdle) {
      // 通常時: 腕を上げてキャレットのフリをする(上げ直しは0.2秒くらいで)
      const downArmL = { x: neutral.armL.x, y: neutral.armL.y };
      const downArmR = { x: neutral.armR.x, y: neutral.armR.y };
      const upArmL = { x: -4, y: -42 };
      const upArmR = { x: 4, y: -42 };
      armL = lerpPoint(downArmL, upArmL, this.armRaiseAmt);
      armR = lerpPoint(downArmR, upArmR, this.armRaiseAmt);
      kneeL = { ...standKneeL }; // この後squashで書き換えるので、共通の定数を直接使わずコピーする
      kneeR = { ...standKneeR };
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
      // 長い待機(煽り): 腕を真横にピンと張り、片膝ずつ曲げて大きく左右に体重移動する「こんなに暇だぞ〜」ポーズ。
      // 通常の立ち姿⇔煽りポーズはtauntAmtで、煽り⇔諦めて座り込みはsitAmtでなめらかに繋ぐ
      const lean = this.leanPhase;
      const bendL = Math.max(0, -lean); // 左足に体重を乗せている度合い(=左膝の曲がり具合)
      const bendR = Math.max(0, lean);
      const dip = Math.abs(lean) * 4; // 膝を曲げたぶん体全体が沈む
      const tauntHip = { x: lean * 5, y: neutral.hip.y + dip };
      const tauntNeckY = neutral.neck.y + dip;
      const shoulderY = tauntNeckY + (tauntHip.y - tauntNeckY) * 0.3; // render.tsの肩の位置(胴の30%地点)と同じ
      const tauntFootL = { x: -8 - bendL * 4, y: neutral.legL.y };
      const tauntFootR = { x: 8 + bendR * 4, y: neutral.legR.y };
      // 伸ばしている側の膝は腰と足先の中点(=まっすぐ)、曲げた側は腰から真横に張り出させる
      const tauntKneeL = lerpPoint(lerpPoint(tauntHip, tauntFootL, 0.5), { x: tauntHip.x - 9, y: tauntHip.y + 2 }, bendL);
      const tauntKneeR = lerpPoint(lerpPoint(tauntHip, tauntFootR, 0.5), { x: tauntHip.x + 9, y: tauntHip.y + 2 }, bendR);
      // 腕は肩の高さで真横。体重を乗せた側へ少しだけ傾けて、シーソーのように揺らす
      const tauntArmL = { x: tauntHip.x - 15, y: shoulderY - lean * 1.5 };
      const tauntArmR = { x: tauntHip.x + 15, y: shoulderY + lean * 1.5 };

      const t = this.tauntAmt;
      const swayHip = lerpPoint(neutral.hip, tauntHip, t);
      const swayHeadCx = swayHip.x + lean * 1.2 * t; // 頭は体よりちょっとだけ大きく振って、ノリノリ感を出す
      const swayNeckX = swayHip.x;
      const swayDip = dip * t;
      const swayArmL = lerpPoint(neutral.armL, tauntArmL, t);
      const swayArmR = lerpPoint(neutral.armR, tauntArmR, t);
      const swayKneeL = lerpPoint(standKneeL, tauntKneeL, t);
      const swayKneeR = lerpPoint(standKneeR, tauntKneeR, t);
      const swayFootL = lerpPoint(neutral.legL, tauntFootL, t);
      const swayFootR = lerpPoint(neutral.legR, tauntFootR, t);

      // あぐら風: 膝を左右に大きく開き、足先は逆に体の中心近くまで寄せる(手描き参考画像に合わせた)
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
      armL = lerpPoint(swayArmL, sitArmL, this.sitAmt);
      armR = lerpPoint(swayArmR, sitArmR, this.sitAmt);
      kneeL = lerpPoint(swayKneeL, sitKneeL, this.sitAmt);
      kneeR = lerpPoint(swayKneeR, sitKneeR, this.sitAmt);
      footL = lerpPoint(swayFootL, sitFootL, this.sitAmt);
      footR = lerpPoint(swayFootR, sitFootR, this.sitAmt);
    }

    // ジャンプの跳ね上がり(jumpY)・複数文字ホップ(hopY)はどの状態の上にも重ねる。
    // 足にもjumpYを足しているのは、体だけ浮いて脚が地面に取り残されたように伸びて見えるのを防ぐため
    // (跳んでいる間は脚を含めた体全体が一緒に浮いて見えるようにし、地面との距離は高さそのもので見せる)
    head.cy += jumpY + hopY + comboHopY;
    neck.y += jumpY + hopY + comboHopY;
    hip.y += jumpY + hopY + comboHopY;
    armL.y += jumpY + hopY + comboHopY;
    if (elbowLOverride) elbowLOverride.y += jumpY + hopY + comboHopY;
    if (elbowROverride) elbowROverride.y += jumpY + hopY + comboHopY;
    armR.y += jumpY + hopY + comboHopY;
    kneeL.y += jumpY;
    kneeR.y += jumpY;
    footL.y += jumpY + (hopY + comboHopY) * 0.4;
    footR.y += jumpY + (hopY + comboHopY) * 0.4;

    // 助走/着地の踏ん張り中は肘をさらに曲げ、ジャンプの頂点に近づくほど腕を伸ばし切る
    const elbowBend = branchElbowBend !== null
      ? branchElbowBend
      : isTyping
      ? TYPING_ELBOW_BEND
      : isSelecting
        ? SELECTING_ELBOW_BEND
        : this.jumpPhase === 'anticipate' || this.jumpPhase === 'brace'
          ? DEFAULT_ELBOW_BEND + crouchAmt * CROUCH_ELBOW_BEND_BOOST
          : this.jumpPhase === 'arc'
            ? lerp(DEFAULT_ELBOW_BEND, ARC_PEAK_ELBOW_BEND, arcTuckAmt)
            : lerp(DEFAULT_ELBOW_BEND, TAUNT_ELBOW_BEND, this.tauntAmt * (1 - this.sitAmt));

    // キャレットのフリをしている間だけ、実際のキャレットらしく一定速度で点滅させる
    // (フォーカスが外れている間は不透明度をunfocused側の演出に譲り、ここでは制御しない)
    let blinkOpacity: number | null = null;
    if (isCaretPose && this.focused) {
      const blinkElapsed = dt - (TYPE_HOLD_MS + CARET_POSE_DELAY_MS);
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
      status,
    };
  }
}
