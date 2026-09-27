import './style.css';
import { CaretmanEditor } from './editor';
import { defaultFilename, downloadText } from './download';
import { INTRO_DEMO_STORAGE_KEY } from './introDemo';
import { Autosaver, contentToHtml, loadSavedContent, shouldShowAutosaveNotice } from './autosave';
import { delay } from './utils';

function requireEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as unknown as T;
}

const figureEl = requireEl<HTMLElement>('figure');
const svgEl = figureEl.querySelector('svg');
if (!svgEl) throw new Error('#figure 内に svg が見つかりません');

const editor = new CaretmanEditor({
  editor: requireEl('editor'),
  wrap: requireEl('wrap'),
  figure: figureEl,
  renderer: {
    svg: svgEl,
    cleanGroup: requireEl('clean-group'),
    roughGroup: requireEl('rough-group'),
    pHead: requireEl('p-head'),
    pBody: requireEl('p-body'),
    pArms: requireEl('p-arms'),
    pLegs: requireEl('p-legs'),
  },
});
editor.init();

const autosaver = new Autosaver(() => editor.getPlainText());
editor.setOnTextChanged(() => autosaver.scheduleSave());

// 自動保存の初回案内は、デモや最初の入力と被らないよう「ひと息ついたタイミング」まで待って出す
const NOTICE_MIN_DELAY_MS = 1200;

function showAutosaveNotice(): void {
  const notice = requireEl<HTMLElement>('autosave-notice');
  notice.hidden = false;
  requestAnimationFrame(() => notice.classList.add('visible'));
  setTimeout(() => {
    notice.classList.remove('visible');
    setTimeout(() => {
      notice.hidden = true;
    }, 400);
  }, 4000);
}

// 保存済みの内容があれば復元し、無ければ(かつ初回だけ)導入デモを再生する
void (async () => {
  const savedContent = loadSavedContent();
  if (savedContent) {
    editor.restoreContent(contentToHtml(savedContent));
    await delay(NOTICE_MIN_DELAY_MS);
  } else {
    const INTRO_DEMO_TEXT = 'いっしょに書いてこ〜！';
    let ranDemo = false;
    try {
      if (!localStorage.getItem(INTRO_DEMO_STORAGE_KEY)) {
        localStorage.setItem(INTRO_DEMO_STORAGE_KEY, '1');
        ranDemo = true;
        await editor.runIntroDemo(INTRO_DEMO_TEXT);
      }
    } catch {
      // プライベートブラウジング等でlocalStorageが使えない場合はデモをスキップする
    }
    if (!ranDemo) await delay(NOTICE_MIN_DELAY_MS);
  }

  if (shouldShowAutosaveNotice()) showAutosaveNotice();
})();

requireEl<HTMLButtonElement>('btn-dl-txt').addEventListener('click', () => {
  downloadText(editor.getPlainText(), 'txt', 'text/plain;charset=utf-8');
});
requireEl<HTMLButtonElement>('btn-dl-md').addEventListener('click', () => {
  downloadText(editor.getPlainText(), 'md', 'text/markdown;charset=utf-8');
});

const SHARE_ICON_SVG = `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M252.31-100Q222-100 201-121q-21-21-21-51.31v-375.38Q180-578 201-599q21-21 51.31-21h72.31q12.76 0 21.38 8.62 8.61 8.61 8.61 21.38T346-568.62q-8.62 8.62-21.38 8.62h-72.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v375.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85h455.38q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46v-375.38q0-4.62-3.85-8.46-3.84-3.85-8.46-3.85h-72.31q-12.76 0-21.38-8.62-8.61-8.61-8.61-21.38t8.61-21.38q8.62-8.62 21.38-8.62h72.31Q738-620 759-599q21 21 21 51.31v375.38Q780-142 759-121q-21 21-51.31 21H252.31Zm206.31-238.62Q450-347.23 450-360v-411.23l-52.92 52.92q-8.93 8.93-20.89 8.81-11.96-.11-21.27-9.42-8.69-9.31-9-21.08-.3-11.77 9-21.07l99.77-99.77q5.62-5.62 11.85-7.93 6.23-2.3 13.46-2.3t13.46 2.3q6.23 2.31 11.85 7.93l99.77 99.77q8.3 8.3 8.5 20.57.19 12.27-8.5 21.58-9.31 9.31-21.39 9.31-12.07 0-21.38-9.31L510-771.23V-360q0 12.77-8.62 21.38Q492.77-330 480-330t-21.38-8.62Z"/></svg>`;

/** SP端末で共有するテキストファイルを、.txt/.mdダウンロードと同じ命名規則で作る */
function buildShareFile(text: string, ext: 'txt' | 'md', mime: string): File {
  return new File([text], defaultFilename(ext), { type: mime });
}

/** PCのChrome/Edge等もnavigator.shareを持つため、機能検出だけでなく実機かどうかも見て判定する */
function isMobileDevice(): boolean {
  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

{
  const spBtn = requireEl<HTMLButtonElement>('sp-dl-btn');
  const spPanel = requireEl<HTMLElement>('sp-dl-panel');
  const spTxtRow = requireEl<HTMLButtonElement>('sp-dl-txt');
  const spMdRow = requireEl<HTMLButtonElement>('sp-dl-md');

  // SPで打ったテキストは、ファイルで欲しいというより他のアプリへ転記したいニーズの方が
  // 強いと想定し、実機のSPかつnavigator.share対応端末ではOS標準の共有シートを使う。
  // .txt/.mdの2択はPCのダウンロードと揃え、file単体で渡す(textと同時に渡すと共有シート側の
  // 「コピー」操作でクリップボードに同一テキストが二重に入る不具合が確認できたため)
  const useShare = isMobileDevice() && Boolean(navigator.share);

  if (useShare) {
    spBtn.setAttribute('aria-label', '共有');
    spBtn.innerHTML = SHARE_ICON_SVG;
    spTxtRow.textContent = '.txtを共有';
    spMdRow.textContent = '.mdを共有';
  }

  const setPanelOpen = (open: boolean): void => {
    spPanel.hidden = !open;
    spBtn.setAttribute('aria-expanded', String(open));
  };

  const handleRow = (ext: 'txt' | 'md', mime: string): void => {
    const text = editor.getPlainText();
    if (text.trim()) {
      if (useShare) {
        const file = buildShareFile(text, ext, mime);
        const shareData: ShareData = navigator.canShare?.({ files: [file] }) ? { files: [file] } : { text };
        navigator.share(shareData).catch(() => {
          // ユーザーがキャンセルした場合などは何もしない
        });
      } else {
        downloadText(text, ext, mime);
      }
    }
    setPanelOpen(false);
  };

  spBtn.addEventListener('click', () => setPanelOpen(Boolean(spPanel.hidden)));
  spTxtRow.addEventListener('click', () => handleRow('txt', 'text/plain;charset=utf-8'));
  spMdRow.addEventListener('click', () => handleRow('md', 'text/markdown;charset=utf-8'));
  document.addEventListener('pointerdown', (e) => {
    if (spPanel.hidden) return;
    const target = e.target;
    if (target instanceof Node && (spPanel.contains(target) || spBtn.contains(target))) return;
    setPanelOpen(false);
  });
  // マウス操作を前提にした外側クリックでの閉じ方だけだと、キーボード操作では開いたパネルを
  // 閉じる手段がなくなってしまうため、Escapeでも閉じられるようにする(閉じたらボタンへ焦点を戻す)
  spPanel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setPanelOpen(false);
      spBtn.focus();
    }
  });
}

// デバッグパネルは開発ビルド(npm run dev)でのみ生成する。import.meta.env.DEVは本番ビルドで
// 静的にfalseへ置き換わるため、この分岐ごとdebugPanel.ts/debug.cssは本番バンドルから除外される
if (import.meta.env.DEV) {
  void (async () => {
    const [{ DebugPanel }] = await Promise.all([import('./debugPanel'), import('./debug.css')]);
    new DebugPanel(editor);
  })();
}
