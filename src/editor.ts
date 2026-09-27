import { StickmanState } from './pose';
import { StickmanRenderer, type RendererElements } from './render';
import type { Pose } from './types';
import { delay } from './utils';

const JITTER_INTERVAL = 40;
const FIGURE_RATIO = 30 / 44; // 幅:高さの比率(元デザインを踏襲)
const BASE_HEIGHT_MULT = 1.35; // フォントサイズに対する基準倍率(scale=1の時)
// 立ちポーズの足位置(viewBox上のy=8)は、figureボックスの下端(y=16)より上にある。
// その分だけ下にずらして、足先を文字のベースライン(=ボックス下端に合わせているcaret位置)へ寄せる
const FOOT_BASELINE_OFFSET_RATIO = 8 / 60;

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
  private lastCaretX: number | null = null;
  private lastTextLength = 0;
  private currentPose: Pose | null = null;
  private introDemoActive = false;
  private introDemoCancelled = false;
  private caretBeforePointerDown: { node: Node; offset: number } | null = null;
  private onTextChanged: (() => void) | null = null;

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

  /** 本文が変化するたび(打鍵・削除・貼り付けなど)に呼ばれるコールバックを登録する(自動保存用) */
  setOnTextChanged(cb: () => void): void {
    this.onTextChanged = cb;
  }

  /** 保存されていた内容を復元し、キャレットを末尾に置く */
  restoreContent(html: string): void {
    this.editor.innerHTML = html;
    this.lastTextLength = this.editor.textContent?.length ?? 0;
    try {
      const range = document.createRange();
      range.selectNodeContents(this.editor);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      // 復元時のキャレット設置に失敗しても致命的ではないので無視する
    }
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
      if (!this.currentPose) return;
      this.renderer.draw(this.currentPose, this.state.isFocused(), this.textureEnabled);
      // キャレットの点滅表現。該当しない時はCSS側(composing/unfocused等)の不透明度に委ねる
      this.figure.style.opacity = this.currentPose.blinkOpacity === null ? '' : String(this.currentPose.blinkOpacity);
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

  private getCaretPoint(): { node: Node; offset: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    return { node: r.startContainer, offset: r.startOffset };
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

  private updateFigurePosition(moveKind?: 'jump'): void {
    if (document.activeElement !== this.editor) return;
    if (this.state.getJumpPhase() === 'anticipate') return; // 踏み込み中はその場に留まる
    const rect = this.getCaretRect();
    if (!rect) return;
    const wrapRect = this.wrap.getBoundingClientRect();
    const { width, height } = this.currentFigureSize();
    const x = rect.left - wrapRect.left;
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
      this.lastCaretX = x;
      if (this.state.isThrowActive()) {
        // 削除で行が結合した場合: フルの助走→跳躍→着地ではなく、放り投げに小さい跳ねを重ねた簡易版にする
        this.state.markThrowLineJump();
      } else {
        this.state.triggerJumpAnticipate(performance.now());
        return; // 位置はまだ動かさず、踏み込みが終わってから移動する
      }
    }
    this.lastLineY = y;

    // 同一行内での大きな横移動(Home/End・複数文字ジャンプ・クリックでの遠距離移動・IME変換確定など)
    // を検出して小さいホップを発火する。通常の1文字ずつのタイピングは閾値未満なので歩行のまま
    const fontSize = parseFloat(getComputedStyle(this.editor).fontSize) || 20;
    const hopDistanceThreshold = fontSize * 1.5;
    let isHop = false;
    if (
      moveKind !== 'jump' &&
      !this.state.isThrowActive() &&
      this.lastCaretX !== null &&
      Math.abs(x - this.lastCaretX) >= hopDistanceThreshold
    ) {
      isHop = true;
      this.state.triggerHop(performance.now());
    }
    this.lastCaretX = x;

    // ジャンプ/ホップでの移動はふわっと、通常の移動は素早く
    const posDuration = moveKind === 'jump' ? 350 : isHop ? 180 : 90;
    const posEasing = moveKind === 'jump' || isHop ? 'ease-out' : 'linear';
    this.figure.style.transition = `left ${posDuration}ms ${posEasing}, top ${posDuration}ms ${posEasing}, width 120ms ease, height 120ms ease, opacity 150ms ease`;

    this.figure.style.width = `${width}px`;
    this.figure.style.height = `${height}px`;
    // 後ろに文字がある(=文字の間にいる)時は寄せずにその場に留める
    const hGap = this.hasCharAfterCaret() ? 0 : fontSize * this.gapMult;
    this.figure.style.left = `${x - width / 2 + hGap}px`;
    this.figure.style.top = `${y - height + height * FOOT_BASELINE_OFFSET_RATIO}px`; // 足先を文字のベースラインに揃える
  }

  private bindEvents(): void {
    this.editor.addEventListener('input', (e) => {
      const inputEvent = e as InputEvent;
      this.state.recordActivity(performance.now());
      const newLength = this.editor.textContent?.length ?? 0;
      const isDelete = inputEvent.inputType?.startsWith('delete') && !inputEvent.isComposing;
      // Undo/Redoはinputtype自体では削除か追加か分からないので、文字数の増減で判定する
      const isHistoryDelete = inputEvent.inputType?.startsWith('history') && newLength < this.lastTextLength;
      const isPaste = inputEvent.inputType?.startsWith('insertFromPaste') && !inputEvent.isComposing;
      if (isDelete || isHistoryDelete) {
        const deletedLength = Math.max(1, this.lastTextLength - newLength);
        this.state.triggerThrow(performance.now(), deletedLength);
      } else if (isPaste) {
        const pastedLength = Math.max(1, newLength - this.lastTextLength);
        this.state.triggerPaste(performance.now(), pastedLength);
      }
      this.lastTextLength = newLength;
      this.updateFigurePosition();
      this.onTextChanged?.();
    });

    this.editor.addEventListener('pointerdown', () => {
      this.cancelIntroDemo();
      this.caretBeforePointerDown = this.getCaretPoint();
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
      // 変換確定専用のトリガーは廃止。同一行内の大きな移動を検出する一般ルール(updateFigurePosition内)に
      // 統合されており、確定で実際に大きく動いた時だけ自然にホップする
      this.updateFigurePosition();
    });

    this.editor.addEventListener('click', () => {
      const before = this.caretBeforePointerDown;
      const after = this.getCaretPoint();
      const moved = !before || !after || before.node !== after.node || before.offset !== after.offset;
      // 実際にキャレットが移動した時だけ「打っている」を発火する。同じ位置へのクリックは
      // 基本ポーズへ戻るだけにする(歩行モーションが余計に発火してしまうのを防ぐ)
      if (moved) {
        this.state.recordActivity(performance.now());
      }
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
      if (document.activeElement !== this.editor) return;
      const sel = window.getSelection();
      // ドラッグ/Shift+矢印/ダブル・トリプルクリックなど、選択範囲がある間は選択ポーズを維持する
      this.state.setSelecting(!!sel && !sel.isCollapsed);
      this.state.recordActivity(performance.now());
      this.updateFigurePosition();
    });
  }
}
