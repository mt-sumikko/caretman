import { StickmanState, HOP_DURATION } from './pose';
import { StickmanRenderer, type RendererElements } from './render';
import type { Pose } from './types';
import { delay } from './utils';

/**
 * このファイルの役割(ざっくり):
 * 本文の入力欄(contenteditableなdiv)を実際に操作するクラス。
 * - キー入力・クリック・選択・貼り付けなどのDOMイベントを監視し、
 *   「今どんな操作があったか」をpose.ts(StickmanState)に伝える
 * - キャレット(文字入力位置)の座標を取得し、棒人間の表示位置(left/top)を
 *   その都度計算してCSSで動かす
 * - 一定間隔(毎フレーム/40ms)で「今のポーズ」を計算させ、render.tsに描画を依頼する
 * 「どう動くべきか(ポーズの座標そのもの)」はpose.tsが、「実際に画面へ描く」のはrender.tsが担当していて、
 * このファイルはその橋渡し役(入力の監視 + 位置決め)にあたる。
 */

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
  private readonly figureSvg: SVGSVGElement;
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
    this.figureSvg = els.renderer.svg;
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

  /** 保存されていた内容を復元し、キャレットを末尾(最後の行の中)に置いて、棒人間もそこへ移す */
  restoreContent(html: string): void {
    this.editor.innerHTML = html;
    this.lastTextLength = this.editor.textContent?.length ?? 0;
    try {
      const range = document.createRange();
      range.selectNodeContents(this.editor.lastChild ?? this.editor);
      range.collapse(false);
      this.moveIntoLine(range);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      // 復元時のキャレット設置に失敗しても致命的ではないので無視する
    }
    // 復元による位置の変化は「移動」ではないので、ジャンプ/ホップ扱いにしないよう前回位置を忘れてから合わせる
    this.lastLineY = null;
    this.lastCaretX = null;
    this.updateFigurePosition();
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

  /** 導入デモ専用: 1文字だけ、今のキャレット位置にDOMを直接操作して挿入する
   *  (デモ用の自動タイピングなので、貼り付け処理のようなUndo履歴への配慮は不要) */
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
      // キャレットの点滅表現。本物のキャレットのようにパキッと切り替えたいので、opacityのtransition
      // (変換中/非フォーカス時にじわっと薄くする用)がかかっている外枠(.figure)ではなく、中のsvgで切り替える
      this.figureSvg.style.opacity = this.currentPose.blinkOpacity === null ? '' : String(this.currentPose.blinkOpacity);
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
    // エディタの外をクリックすると選択位置もエディタの外へ移る。エディタへ戻る時はクリック位置に
    // キャレットが置かれるより先にfocusイベントが来るので、その瞬間の「外の位置」は測らない
    if (!this.editor.contains(liveRange.startContainer)) return null;
    const range = liveRange.cloneRange();
    // IME変換中のブラウザは、選択範囲を「入力中の文字列の末尾」と「入力中の文字列全体」の間で行き来させる。
    // 通常どおり範囲の先頭を測ると末尾⇔先頭を往復して大きく動いたように見えるため、変換中は末尾で測る
    range.collapse(!this.state.isComposing());
    this.moveIntoLine(range);
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[0];
    // 下の「目印を一時的に差し込んで測る」方法は、変換中に使うと入力中の文字列を壊しかねないので使わない
    if (this.state.isComposing()) return null;

    const marker = document.createElement('span');
    marker.appendChild(document.createTextNode('​'));
    range.insertNode(marker);
    const rect = marker.getBoundingClientRect();
    const parent = marker.parentNode;
    parent?.removeChild(marker);
    parent?.normalize();
    return rect;
  }

  /**
   * 本文は1行ごとに<div>で包まれている。位置が「エディタ直下の、行(<div>)と行の間」を指していたり、
   * 行末の改行用<br>の後ろを指していたりすると、どの行にも属さない位置として測られて高さがずれるので、
   * その行の中の位置に置き直す
   */
  private moveIntoLine(range: Range): void {
    if (range.startContainer === this.editor) {
      const next = this.editor.childNodes[range.startOffset];
      const prev = this.editor.childNodes[range.startOffset - 1];
      if (next?.nodeName === 'DIV') {
        range.setStart(next, 0);
      } else if (prev?.nodeName === 'DIV') {
        range.setStart(prev, prev.childNodes.length);
      }
      range.collapse(true);
    }
    const container = range.startContainer;
    const before = container.childNodes[range.startOffset - 1];
    if (before?.nodeName === 'BR' && range.startOffset === container.childNodes.length) {
      range.setStart(container, range.startOffset - 1);
      range.collapse(true);
    }
  }

  /** 棒人間の表示サイズ(幅・高さ)をフォントサイズから計算する。呼び出し側が既にフォントサイズを
   *  取得済みなら引数で渡せる(getComputedStyleの呼び出し回数を増やさないため) */
  private currentFigureSize(fontSize?: number): { width: number; height: number } {
    const fs = fontSize ?? (parseFloat(getComputedStyle(this.editor).fontSize) || 20);
    const height = fs * BASE_HEIGHT_MULT * this.figureScale;
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
    // フォントサイズはこの後の計算で何度も使うため、ここで一度だけ取得しておく
    // (getComputedStyleは画面の再計算を伴いうるので、呼び出し回数を減らしておきたい)
    const fontSize = parseFloat(getComputedStyle(this.editor).fontSize) || 20;
    const { width, height } = this.currentFigureSize(fontSize);
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
      } else if (this.state.isPasteActive()) {
        // 複数行の貼り付けも同様に、貼り付けポーズのまま小さく跳ねるだけにする
        this.state.markPasteLineJump();
      } else {
        this.state.triggerJumpAnticipate(performance.now());
        return; // 位置はまだ動かさず、踏み込みが終わってから移動する
      }
    }
    this.lastLineY = y;

    // 同一行内での大きな横移動(Home/End・単語単位の移動・クリックでの遠距離移動など)
    // を検出して小さいホップを発火する。通常の1文字ずつのタイピングは閾値未満なので歩行のまま
    const hopDistanceThreshold = fontSize * 1.5;
    let isHop = false;
    if (
      moveKind !== 'jump' &&
      !this.state.isThrowActive() &&
      !this.state.isPasteActive() && // 貼り付けで大きく動くのは貼り付けポーズで表現する
      !this.state.isComposing() && // 変換中の文字数の増減・文節の移動は「打っている」の一部なので歩きのまま
      this.lastCaretX !== null &&
      Math.abs(x - this.lastCaretX) >= hopDistanceThreshold
    ) {
      isHop = true;
      this.state.triggerHop(performance.now(), x - this.lastCaretX);
    }
    // 歩く向きは、キャレットが動いた向きに合わせる(左へ1文字戻る時は左向きに歩く)
    if (!isHop && moveKind !== 'jump' && this.lastCaretX !== null) this.state.setWalkDir(x - this.lastCaretX);
    this.lastCaretX = x;

    // ジャンプ/ホップでの移動はふわっと、通常の移動は素早く
    const posDuration = moveKind === 'jump' ? 350 : isHop ? HOP_DURATION : 90;
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
    // 何かしら文字が増減した時(打鍵・削除・貼り付け・Undo/Redoなど)に毎回呼ばれるイベント。
    // ここで「増えたか減ったか」を判定して、削除なら放り投げモーションを発火させている
    // (貼り付けは下のpasteイベントで個別に処理するので、ここでは扱わない)
    this.editor.addEventListener('input', (e) => {
      const inputEvent = e as InputEvent;
      this.state.recordActivity(performance.now());
      const newLength = this.editor.textContent?.length ?? 0;
      // 放り投げは、実際に文字が減った時だけ。空行や行頭でのBackspaceのように改行だけが消えた時は
      // 文字数が変わらないので投げず、ただの移動(同じ行なら歩き、行をまたげば改行ジャンプ)として扱う
      // (Undo/RedoもinputTypeだけでは削除か追加か分からないので、同じく文字数の増減で判定する)
      const isDeleteType =
        (inputEvent.inputType?.startsWith('delete') && !inputEvent.isComposing) ||
        inputEvent.inputType?.startsWith('history');
      if (isDeleteType && newLength < this.lastTextLength) {
        this.state.triggerThrow(performance.now(), this.lastTextLength - newLength);
      }
      this.lastTextLength = newLength;
      this.updateFigurePosition();
      this.onTextChanged?.();
    });

    // 貼り付け: ブラウザ標準の挙動に任せると、コピー元(Wordやwebページなど)の文字装飾や
    // HTMLタグまでそのまま貼り付けられてしまう。このエディタは書式を持たないプレーンテキスト
    // 前提のツールなので、貼り付けはいったん止めて、テキストだけを自前で挿入し直す。
    // 挿入にはdocument.execCommandという少し古いAPIを使っているが、これを使うと
    // ブラウザ標準のUndo(Ctrl+Z)の履歴にもちゃんと積まれるため、あえて採用している。
    this.editor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain');
      if (!text) return; // 画像など文字を含まないものが貼り付けられた場合は何もしない
      // insertTextを呼ぶとその場でinputイベント→位置更新まで走るので、貼り付けポーズはその前に開始しておく
      // (でないと、行をまたぐ貼り付けが普通の改行ジャンプとして扱われてしまう)
      this.state.triggerPaste(performance.now(), Array.from(text).length);
      document.execCommand('insertText', false, text);
    });

    this.editor.addEventListener('pointerdown', () => {
      this.cancelIntroDemo();
      this.caretBeforePointerDown = this.getCaretPoint();
    });

    this.editor.addEventListener('keydown', (e) => {
      this.cancelIntroDemo();
      // SafariはIMEの変換確定のEnterを、isComposing=false・keyCode=229の「普通のEnter」として送ってくるので
      // keyCodeでも除外する(でないと確定のたびに、その場で空振りジャンプしてしまう)
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        this.state.triggerJumpAnticipate(performance.now());
      }
    });

    // キーを離した時は位置合わせだけ行う。「打っている(歩き)」にするのは、実際に文字が変わった時(input)と
    // キャレットが動いた時(selectionchange)だけにする(Shift単体やCtrl+Cのコピーで歩き出さないように)
    this.editor.addEventListener('keyup', () => {
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
      // 変換確定では特別なモーションは出さない。変換中から入力中の文字の末尾に立って追従しているので、
      // 確定しても大きな移動にはならず、そのまま歩き→待機へ移る
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
      // (IME変換中の文節ハイライトも選択範囲として報告されるが、それは選択操作ではないので除外する)
      this.state.setSelecting(!!sel && !sel.isCollapsed && !this.state.isComposing());
      this.state.recordActivity(performance.now());
      this.updateFigurePosition();
    });
  }
}
