import { StickmanState, LONG_IDLE_MS, TYPE_HOLD_MS } from '../pose';
import type { Pose } from '../types';

/**
 * このファイルの役割(ざっくり):
 * motion-review.html(モーション確認ページ)で、選んだモーションを単体で繰り返し再生するための「操縦役」。
 *
 * ポーズの計算そのものは、実エディタと同じ src/pose.ts(StickmanState)をそのまま使う。
 * ここでは実際のキー入力の代わりに、「今打った」「今Enterを押した」「今消した」といった合図を
 * StickmanStateへ送って、見たいモーションを再現しているだけ。
 * そのため、確認ページと実エディタの動きは常に完全に一致する(片方だけ直してズレる、ということが起きない)。
 */

export type DemoState =
  | 'base'
  | 'shortIdle'
  | 'shortIdleBetween'
  | 'walk'
  | 'longIdle'
  | 'givenUp'
  | 'jump'
  | 'throw'
  | 'hop'
  | 'composing'
  | 'selecting'
  | 'pasting';

export const DEMO_STATES: { value: DemoState; label: string }[] = [
  { value: 'base', label: '基本ポーズ' },
  { value: 'shortIdle', label: '短い待機' },
  { value: 'shortIdleBetween', label: '短い待機(文字の間)' },
  { value: 'walk', label: '歩き' },
  { value: 'longIdle', label: '長い待機(煽り)' },
  { value: 'givenUp', label: 'あきらめて着席' },
  { value: 'jump', label: '改行ジャンプ' },
  { value: 'throw', label: '削除(放り投げ)' },
  { value: 'hop', label: '複数文字ホップ' },
  { value: 'composing', label: '変換中(表示のみ)' },
  { value: 'selecting', label: '選択ポーズ' },
  { value: 'pasting', label: '貼り付けポーズ' },
];

const REPEAT_GAP_MS = 700; // ワンショット系(ジャンプ/放り投げ/ホップ)を選んでいる間、次を再生するまでの間隔

export class DemoStickmanState {
  private state = new StickmanState(0);
  private needsSetup = true;
  private current: DemoState | null = null;
  private nextShotAt = 0; // ワンショット系を次に再生する時刻
  private shotWasActive = false;
  private hopDir = -1; // 再生するたびに右(1)と左(-1)を交互に切り替える

  /** モーションを切り替えた時に呼ぶ。状態をまっさらにして、待たずにすぐ再生を始める */
  restart(now: number): void {
    this.state = new StickmanState(now);
    this.needsSetup = true;
    this.nextShotAt = now;
    this.shotWasActive = false;
  }

  computePose(now: number, demo: DemoState): Pose {
    if (this.needsSetup || demo !== this.current) {
      if (!this.needsSetup) this.restart(now);
      this.setup(now, demo);
      this.current = demo;
      this.needsSetup = false;
    }
    this.drive(now, demo);
    const pose = this.state.computePose(now, { betweenChars: demo === 'shortIdleBetween' });
    return { ...pose, status: DEMO_STATES.find((s) => s.value === demo)?.label ?? demo };
  }

  /** モーションを選んだ瞬間に一度だけ送る合図 */
  private setup(now: number, demo: DemoState): void {
    switch (demo) {
      case 'shortIdle':
      case 'shortIdleBetween':
        // 手を止めた直後の状態から始める(基本ポーズで少し繋いでから、腕を上げてキャレットのフリ)
        this.state.recordActivity(now - TYPE_HOLD_MS);
        break;
      case 'givenUp':
        this.state.debugFastForwardToGivenUp(now, 0);
        break;
      case 'composing':
        this.state.setComposing(true);
        break;
      case 'selecting':
        this.state.setSelecting(true);
        break;
    }
  }

  /** 毎フレーム送る合図(その状態に留まり続けるため・ワンショットを繰り返すため) */
  private drive(now: number, demo: DemoState): void {
    switch (demo) {
      case 'walk':
        this.state.recordMove(now); // 打ち続けている(キャレットが動き続けている)
        return;
      case 'longIdle':
        this.state.recordActivity(now - LONG_IDLE_MS); // 煽りが始まる時間だけ放置された状態に留める(5分で座らないように)
        return;
      case 'pasting':
        this.state.triggerPaste(now); // 貼り付けポーズを出し続ける
        return;
      case 'base':
      case 'composing':
      case 'selecting':
      case 'jump':
      case 'throw':
      case 'hop':
        // 手を止めた直後の「基本ポーズ」に留める(キャレットのフリに移らないように)
        this.state.recordActivity(now - TYPE_HOLD_MS);
        break;
      default:
        return;
    }

    if (demo === 'jump' || demo === 'throw' || demo === 'hop') this.repeatShot(now, demo);
  }

  private repeatShot(now: number, demo: 'jump' | 'throw' | 'hop'): void {
    const active =
      demo === 'jump'
        ? this.state.getJumpPhase() !== 'none'
        : demo === 'throw'
          ? this.state.isThrowActive()
          : this.state.isHopActive();
    if (this.shotWasActive && !active) this.nextShotAt = now + REPEAT_GAP_MS;
    this.shotWasActive = active;
    if (active || now < this.nextShotAt) return;

    if (demo === 'jump') this.state.triggerJumpAnticipate(now);
    else if (demo === 'throw') this.state.triggerThrow(now);
    else {
      this.hopDir = -this.hopDir;
      this.state.triggerHop(now, this.hopDir);
    }
    this.shotWasActive = true;
  }
}
