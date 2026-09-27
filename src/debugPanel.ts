import type { CaretmanEditor } from './editor';
import { INTRO_DEMO_STORAGE_KEY } from './introDemo';

const STATUS_POLL_MS = 200;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 本体UIには載せないデバッグ専用パネル。トグルボタン or バッククォートキーで開閉する。
 * (現在の状態表示・サイズ/距離スライダー・5分経過ボタン・質感切り替え・初回デモリセット・
 * モーション確認ページへの導線をここに集約)
 *
 * DOMごとJSで生成する(index.htmlには一切マークアップを置かない)。main.tsがこのモジュール自体を
 * import.meta.env.DEV の時だけ動的importするため、本番ビルドにはコード・マークアップとも含まれない。
 */
export class DebugPanel {
  private readonly editor: CaretmanEditor;
  private readonly panel: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly statusEl: HTMLElement;

  constructor(editor: CaretmanEditor) {
    this.editor = editor;

    this.toggleButton = el('button', 'debug-toggle', 'デバッグ');
    this.toggleButton.type = 'button';
    this.toggleButton.setAttribute('aria-expanded', 'false');
    this.toggleButton.setAttribute('aria-controls', 'debug-panel');

    this.panel = el('aside', 'debug-panel');
    this.panel.id = 'debug-panel';
    this.panel.hidden = true;

    this.statusEl = el('span');
    const statusRow = el('div', 'debug-row');
    statusRow.append(el('span', 'debug-label', '状態'), this.statusEl);

    const scaleInput = this.buildRange('0.3', '1.6', '0.05', '1.1');
    const scaleOut = el('output', undefined, '1.10');
    const scaleRow = this.buildLabeledRow('サイズ', scaleInput, scaleOut);

    const gapInput = this.buildRange('0', '1.2', '0.05', '0.4');
    const gapOut = el('output', undefined, '0.40');
    const gapRow = this.buildLabeledRow('距離(横)', gapInput, gapOut);

    const textureToggle = el('input');
    textureToggle.type = 'checkbox';
    textureToggle.checked = true;
    const textureRow = this.buildLabeledRow('線の質感(rough.js+鉛筆テクスチャ)', textureToggle);

    const giveUpButton = el('button', 'debug-btn', '5秒後に「5分経過」状態にする');
    giveUpButton.type = 'button';
    const giveUpRow = el('div', 'debug-row');
    giveUpRow.append(giveUpButton);

    const resetIntroButton = el('button', 'debug-btn', '初回デモをリセットして再読み込み');
    resetIntroButton.type = 'button';
    const resetIntroRow = el('div', 'debug-row');
    resetIntroRow.append(resetIntroButton);

    const motionReviewLink = el('a', 'debug-link', 'モーション確認ページを開く ↗');
    motionReviewLink.href = '/motion-review.html';
    motionReviewLink.target = '_blank';
    motionReviewLink.rel = 'noopener';
    const motionReviewRow = el('div', 'debug-row');
    motionReviewRow.append(motionReviewLink);

    this.panel.append(statusRow, scaleRow, gapRow, textureRow, giveUpRow, resetIntroRow, motionReviewRow);
    document.body.append(this.toggleButton, this.panel);

    this.bind({ scaleInput, scaleOut, gapInput, gapOut, textureToggle, giveUpButton, resetIntroButton });
  }

  private buildRange(min: string, max: string, step: string, value: string): HTMLInputElement {
    const input = el('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    return input;
  }

  private buildLabeledRow(labelText: string, control: HTMLElement, output?: HTMLElement): HTMLElement {
    const row = el('div', 'debug-row');
    const label = el('label', undefined, labelText);
    row.append(label, control);
    if (output) row.append(output);
    return row;
  }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggleButton.setAttribute('aria-expanded', String(open));
  }

  private bind(fields: {
    scaleInput: HTMLInputElement;
    scaleOut: HTMLElement;
    gapInput: HTMLInputElement;
    gapOut: HTMLElement;
    textureToggle: HTMLInputElement;
    giveUpButton: HTMLButtonElement;
    resetIntroButton: HTMLButtonElement;
  }): void {
    const { scaleInput, scaleOut, gapInput, gapOut, textureToggle, giveUpButton, resetIntroButton } = fields;

    if (!this.editor.roughAvailable) {
      textureToggle.checked = false;
      textureToggle.disabled = true;
    }

    this.toggleButton.addEventListener('click', () => this.setOpen(Boolean(this.panel.hidden)));
    document.addEventListener('keydown', (e) => {
      if (e.key !== '`' || isTypingTarget(e.target)) return;
      this.setOpen(Boolean(this.panel.hidden));
    });

    scaleInput.addEventListener('input', () => {
      const v = parseFloat(scaleInput.value);
      scaleOut.textContent = v.toFixed(2);
      this.editor.setScale(v);
    });

    gapInput.addEventListener('input', () => {
      const v = parseFloat(gapInput.value);
      gapOut.textContent = v.toFixed(2);
      this.editor.setGap(v);
    });

    giveUpButton.addEventListener('click', () => this.editor.debugFastForwardToGivenUp());

    textureToggle.addEventListener('change', () => this.editor.setTextureEnabled(textureToggle.checked));

    resetIntroButton.addEventListener('click', () => {
      try {
        localStorage.removeItem(INTRO_DEMO_STORAGE_KEY);
      } catch {
        // プライベートブラウジング等でlocalStorageが使えない場合は何もしない
      }
      location.reload();
    });

    // 初期スライダー値をエディタ側にも反映する
    this.editor.setScale(parseFloat(scaleInput.value));
    this.editor.setGap(parseFloat(gapInput.value));
    this.editor.setTextureEnabled(textureToggle.checked);

    setInterval(() => {
      this.statusEl.textContent = this.editor.getStatus();
    }, STATUS_POLL_MS);
  }
}
