const CONTENT_KEY = 'caretman.content';
const NOTICE_SHOWN_KEY = 'caretman.autosaveNoticeShown';
const SAVE_DEBOUNCE_MS = 400;

/** 初回だけ「このブラウザに自動保存されます」を伝える通知を出すべきかどうか(出すなら同時にフラグも立てる) */
export function shouldShowAutosaveNotice(): boolean {
  try {
    if (localStorage.getItem(NOTICE_SHOWN_KEY)) return false;
    localStorage.setItem(NOTICE_SHOWN_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function loadSavedContent(): string | null {
  try {
    return localStorage.getItem(CONTENT_KEY);
  } catch {
    return null;
  }
}

/** 保存済みテキストを、1行ごとにdivで包んだHTMLへ変換する(contenteditableが改行のたびに自然に作る構造と揃える) */
export function contentToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => `<div>${line.length ? escapeHtml(line) : '<br>'}</div>`)
    .join('');
}

export class Autosaver {
  private readonly getText: () => string;
  private timer: number | undefined;

  constructor(getText: () => string) {
    this.getText = getText;
  }

  scheduleSave(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      try {
        localStorage.setItem(CONTENT_KEY, this.getText());
      } catch {
        // 容量超過・プライベートブラウジング等は無視する(自動保存を諦めるだけで致命的ではない)
      }
    }, SAVE_DEBOUNCE_MS);
  }
}
