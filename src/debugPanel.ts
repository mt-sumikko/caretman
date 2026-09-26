import type { CaretmanEditor } from './editor';

const STATUS_POLL_MS = 200;

export interface DebugPanelElements {
  toggleButton: HTMLButtonElement;
  panel: HTMLElement;
  statusEl: HTMLElement;
  scaleInput: HTMLInputElement;
  scaleOut: HTMLElement;
  gapInput: HTMLInputElement;
  gapOut: HTMLElement;
  giveUpButton: HTMLButtonElement;
  textureToggle: HTMLInputElement;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

/**
 * 本体UIには載せないデバッグ専用パネル。トグルボタン or バッククォートキーで開閉する。
 * (現在の状態表示・サイズ/距離スライダー・5分経過ボタン・質感切り替えをここに集約)
 */
export class DebugPanel {
  private readonly els: DebugPanelElements;
  private readonly editor: CaretmanEditor;

  constructor(els: DebugPanelElements, editor: CaretmanEditor) {
    this.els = els;
    this.editor = editor;
    this.bind();
  }

  private setOpen(open: boolean): void {
    this.els.panel.hidden = !open;
    this.els.toggleButton.setAttribute('aria-expanded', String(open));
  }

  private bind(): void {
    const { toggleButton, panel, statusEl, scaleInput, scaleOut, gapInput, gapOut, giveUpButton, textureToggle } = this.els;

    if (!this.editor.roughAvailable) {
      textureToggle.checked = false;
      textureToggle.disabled = true;
    }

    toggleButton.addEventListener('click', () => this.setOpen(Boolean(panel.hidden)));
    document.addEventListener('keydown', (e) => {
      if (e.key !== '`' || isTypingTarget(e.target)) return;
      this.setOpen(Boolean(panel.hidden));
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

    // 初期スライダー値をエディタ側にも反映する
    this.editor.setScale(parseFloat(scaleInput.value));
    this.editor.setGap(parseFloat(gapInput.value));
    this.editor.setTextureEnabled(textureToggle.checked);

    setInterval(() => {
      statusEl.textContent = this.editor.getStatus();
    }, STATUS_POLL_MS);
  }
}
