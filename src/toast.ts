/**
 * このファイルの役割(ざっくり):
 * 画面下に短いメッセージを数秒だけ出す「トースト」。自動保存の案内や、空のままボタンを押した時の案内に使う。
 * SPでキーボードが出ている間は、キーボードの裏に隠れないよう、見えている範囲の下端に合わせて持ち上げる。
 */

const FADE_MS = 400; // style.cssの.toastのtransitionと揃える

export class Toast {
  private readonly el: HTMLElement;
  private hideTimer: number | undefined;
  private clearTimer: number | undefined;

  constructor(el: HTMLElement) {
    this.el = el;
    // position: fixedの基準(レイアウトビューポート)はキーボードが出ても縮まないので、
    // 実際に見えている範囲(visualViewport)との差=キーボードに隠れている高さをCSSへ渡す
    const vv = window.visualViewport;
    if (vv) {
      const update = (): void => this.updateKeyboardInset();
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }
  }

  show(text: string, durationMs = 4000): void {
    window.clearTimeout(this.hideTimer);
    window.clearTimeout(this.clearTimer);
    this.updateKeyboardInset();
    this.el.textContent = text;
    requestAnimationFrame(() => this.el.classList.add('visible'));
    this.hideTimer = window.setTimeout(() => {
      this.el.classList.remove('visible');
      // 消えた後も文字が残っていると読み上げソフトが拾うので、フェードし終えたら空にする
      this.clearTimer = window.setTimeout(() => {
        this.el.textContent = '';
      }, FADE_MS);
    }, durationMs);
  }

  private updateKeyboardInset(): void {
    const vv = window.visualViewport;
    if (!vv) return;
    const hidden = document.documentElement.clientHeight - (vv.offsetTop + vv.height);
    this.el.style.setProperty('--keyboard-inset', `${Math.max(0, hidden)}px`);
  }
}
