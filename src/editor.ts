import { StickmanState } from './pose';
import { StickmanRenderer, type RendererElements } from './render';
import type { Pose } from './types';
import { delay } from './utils';

const JITTER_INTERVAL = 40;
const FIGURE_RATIO = 30 / 44; // 幅:高さの比率(元デザインを踏襲)
const BASE_HEIGHT_MULT = 1.35; // フォントサイズに対する基準倍率(scale=1の時)

export interface CaretmanEditorElements {
  editor: HTMLElement;
  wrap: HTMLElement;
  figure: HTMLElement;
  renderer: RendererElements;
}

export class CaretmanEditor {
  private readonly editor: HTMLElement;
  private readonly wrap: HTMLElement;
  private readonly figure: HTMLElement;
  private readonly state: StickmanState;
  private readonly renderer: StickmanRenderer;

  private figureScale = 1.1;
  private gapMult = 0.4;
  private textureEnabled = true;

  private lastLineY: number | null = null;
  private lastTextLength = 0;
  private currentPose: Pose | null = null;
  private introDemoActive = false;
  private introDemoCancelled = false;

  constructor(els: CaretmanEditorElements) {
    this.editor = els.editor;
    this.wrap = els.wrap;
    this.figure = els.figure;
    this.state = new StickmanState(performance.now());
    this.renderer = new StickmanRenderer(els.renderer);
    if (!this.renderer.roughAvailable) this.textureEnabled = false;
  }

  get roughAvailable(): boolean {
    return this.renderer.roughAvailable;
  }

  setScale(scale: number): void {
    this.figureScale = scale;
    this.updateFigurePosition();
  }

  setGap(gapMult: number): void {
    this.gapMult = gapMult;
    this.updateFigurePosition();
  }

  setTextureEnabled(v: boolean): void {
    this.textureEnabled = v && this.renderer.roughAvailable;
  }

  getStatus(): string {
    return this.currentPose?.status ?? '';
  }

  /** 打った内容をプレーンテキストとして取得する(.txt/.mdダウンロード用) */
  getPlainText(): string {
    return this.editor.innerText;
  }

  /** デバッグ用: 5秒後に「5分あきらめ経過」状態に到達させる */
  debugFastForwardToGivenUp(): void {
    this.state.debugFastForwardToGivenUp(performance.now(), 5000);
  }

  /**
   * 初回訪問時だけ、サイト側が自動でタイプ→少し待つ→まとめて消す、というデモを再生する。
   * プレースホルダーではなく実際にDOMへ文字を打ち込むので、打鍵/削除の一連のモーションが
   * 実際に発火する。ユーザーが操作(クリック/キー入力)した時点で即座に中断する。
   */
  async runIntroDemo(text: string): Promise<void> {
    if (this.introDemoCancelled) return;
    this.introDemoActive = true;
    this.editor.focus();

    await delay(600);
    for (const ch of Array.from(text)) {
      if (this.introDemoCancelled) {
        this.introDemoActive = false;
        return;
      }
      this.insertTextAtCaret(ch);
      this.editor.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true }));
      await delay(90 + Math.random() * 70);
    }

    if (this.introDemoCancelled) {
      this.introDemoActive = false;
      return;
    }
    await delay(1000);

    if (this.introDemoCancelled) {
      this.introDemoActive = false;
      return;
    }
    this.editor.textContent = '';
    this.editor.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
    this.introDemoActive = false;
  }

  private cancelIntroDemo(): void {
    if (!this.introDemoActive) return;
    this.introDemoCancelled = true;
    this.introDemoActive = false;
    this.editor.textContent = '';
    this.lastTextLength = 0;
    this.updateFigurePosition();
  }

  private insertTextAtCaret(text: string): void {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (!range || !this.editor.contains(range.startContainer)) {
      const node = document.createTextNode(text);
      this.editor.appendChild(node);
      const r = document.createRange();
      r.setStartAfter(node);
      r.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(r);
      return;
    }
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  init(): void {
    this.bindEvents();

    // 初期表示: 実際のフォーカス/キーボード操作を待たずに、正しいサイズ・位置で表示する
    const initSize = this.currentFigureSize();
    this.figure.style.width = `${initSize.width}px`;
    this.figure.style.height = `${initSize.height}px`;
    try {
      const initRange = document.createRange();
      initRange.setStart(this.editor, 0);
      initRange.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(initRange);
    } catch {
      // 初期キャレット設置に失敗しても致命的ではないので無視する
    }
    this.editor.focus();
    this.updateFigurePosition();

    const draw = () => {
      if (this.currentPose) this.renderer.draw(this.currentPose, this.state.isFocused(), this.textureEnabled);
    };
    setInterval(draw, JITTER_INTERVAL);

    const loop = (now: number) => {
      this.currentPose = this.state.computePose(now, {
        betweenChars: document.activeElement === this.editor && this.hasCharAfterCaret(),
        onEnterArc: () => this.updateFigurePosition('jump'),
      });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---- キャレット座標の取得と追従 ----
  private getCaretRect(): DOMRect | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const liveRange = sel.getRangeAt(0);
    const range = liveRange.cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[0];

    const marker = document.createElement('span');
    marker.appendChild(document.createTextNode('​'));
    range.insertNode(marker);
    const rect = marker.getBoundingClientRect();
    const parent = marker.parentNode;
    parent?.removeChild(marker);
    parent?.normalize();
    return rect;
  }

  private currentFigureSize(): { width: number; height: number } {
    const fontSize = parseFloat(getComputedStyle(this.editor).fontSize) || 20;
    const height = fontSize * BASE_HEIGHT_MULT * this.figureScale;
    const width = height * FIGURE_RATIO;
    return { width, height };
  }

  private hasCharAfterCaret(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    const offset = r.startOffset;
    if (node.nodeType === Node.TEXT_NODE) {
      return offset < (node.textContent?.length ?? 0);
    }
    // 要素内: 改行直後の<br>プレースホルダーだけは「後ろに文字がある」に含めない
    for (let i = offset; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child.nodeName === 'BR') continue;
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.length === 0) continue;
      return true;
    }
    return false;
  }

  private updateFigurePosition(moveKind?: 'jump' | 'hop'): void {
    if (document.activeElement !== this.editor) return;
    if (this.state.getJumpPhase() === 'anticipate') return; // 踏み込み中はその場に留まる
    const rect = this.getCaretRect();
    if (!rect) return;
    const wrapRect = this.wrap.getBoundingClientRect();
    const { width, height } = this.currentFigureSize();
    const y = rect.bottom - wrapRect.top;

    // 改行キー経由でなくても、行を跨ぐ移動なら踏み込み→ジャンプさせる(変換中の折り返しは対象外)
    const lineHeightPx = parseFloat(getComputedStyle(this.editor).lineHeight) || height;
    if (
      this.lastLineY !== null &&
      this.state.getJumpPhase() === 'none' &&
      !this.state.isComposing() &&
      Math.abs(y - this.lastLineY) > lineHeightPx * 0.5
    ) {
      this.lastLineY = y;
      if (this.state.isThrowActive()) {
        // 削除で行が結合した場合: フルの助走→跳躍→着地ではなく、放り投げに小さい跳ねを重ねた簡易版にする
        this.state.markThrowLineJump();
      } else {
        this.state.triggerJumpAnticipate(performance.now());
        return; // 位置はまだ動かさず、踏み込みが終わってから移動する
      }
    }
    this.lastLineY = y;

    // ジャンプでの移動は跳躍の弧に合わせてゆっくり、通常の移動は素早く
    const posDuration = moveKind === 'jump' ? 350 : moveKind === 'hop' ? 180 : 90;
    const posEasing = moveKind ? 'ease-out' : 'linear';
    this.figure.style.transition = `left ${posDuration}ms ${posEasing}, top ${posDuration}ms ${posEasing}, width 120ms ease, height 120ms ease, opacity 150ms ease`;

    this.figure.style.width = `${width}px`;
    this.figure.style.height = `${height}px`;
    const fontSize = parseFloat(getComputedStyle(this.editor).fontSize) || 20;
    // 後ろに文字がある(=文字の間にいる)時は寄せずにその場に留める
    const hGap = this.hasCharAfterCaret() ? 0 : fontSize * this.gapMult;
    const x = rect.left - wrapRect.left;
    this.figure.style.left = `${x - width / 2 + hGap}px`;
    this.figure.style.top = `${y - height}px`; // ベースラインは文字に揃える
  }

  private bindEvents(): void {
    this.editor.addEventListener('input', (e) => {
      const inputEvent = e as InputEvent;
      this.state.recordActivity(performance.now());
      const newLength = this.editor.textContent?.length ?? 0;
      const isDelete = inputEvent.inputType?.startsWith('delete') && !inputEvent.isComposing;
      // Undo/Redoはinputtype自体では削除か追加か分からないので、文字数の増減で判定する
      const isHistoryDelete = inputEvent.inputType?.startsWith('history') && newLength < this.lastTextLength;
      if (isDelete || isHistoryDelete) {
        this.state.triggerThrow(performance.now());
      }
      this.lastTextLength = newLength;
      this.updateFigurePosition();
    });

    this.editor.addEventListener('pointerdown', () => {
      this.cancelIntroDemo();
    });

    this.editor.addEventListener('keydown', (e) => {
      this.cancelIntroDemo();
      if (e.key === 'Enter' && !e.isComposing) {
        this.state.triggerJumpAnticipate(performance.now());
      }
    });

    this.editor.addEventListener('keyup', () => {
      this.state.recordActivity(performance.now());
      this.updateFigurePosition();
    });

    this.editor.addEventListener('compositionstart', () => {
      this.state.setComposing(true);
      this.figure.classList.add('composing');
    });

    this.editor.addEventListener('compositionupdate', () => {
      this.state.recordActivity(performance.now());
      this.updateFigurePosition();
    });

    this.editor.addEventListener('compositionend', () => {
      this.state.setComposing(false);
      this.figure.classList.remove('composing');
      this.state.recordActivity(performance.now());
      this.state.triggerConfirmHop(performance.now());
      this.updateFigurePosition('hop');
    });

    this.editor.addEventListener('click', () => {
      this.state.recordActivity(performance.now());
      this.updateFigurePosition();
    });

    this.editor.addEventListener('blur', () => {
      this.state.setFocused(false);
      this.figure.classList.add('unfocused');
    });

    this.editor.addEventListener('focus', () => {
      this.state.setFocused(true);
      this.figure.classList.remove('unfocused');
      this.updateFigurePosition();
    });

    window.addEventListener('resize', () => {
      // リサイズで位置がずれる場合も、既存の移動ルール(同一行スライド/行またぎジャンプ)をそのまま適用する
      this.updateFigurePosition();
    });

    document.addEventListener('selectionchange', () => {
      if (document.activeElement === this.editor) {
        this.state.recordActivity(performance.now());
        this.updateFigurePosition();
      }
    });
  }
}
