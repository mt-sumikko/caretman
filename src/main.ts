import './style.css';
import { CaretmanEditor } from './editor';
import { defaultFilename, downloadText } from './download';
import { INTRO_DEMO_STORAGE_KEY } from './introDemo';
import { Autosaver, contentToHtml, loadSavedContent, shouldShowAutosaveNotice } from './autosave';

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

// 保存済みの内容があれば復元し、無ければ(かつ初回だけ)導入デモを再生する
const savedContent = loadSavedContent();
if (savedContent) {
  editor.restoreContent(contentToHtml(savedContent));
} else {
  const INTRO_DEMO_TEXT = 'いっしょに書いてこ〜！';
  try {
    if (!localStorage.getItem(INTRO_DEMO_STORAGE_KEY)) {
      localStorage.setItem(INTRO_DEMO_STORAGE_KEY, '1');
      void editor.runIntroDemo(INTRO_DEMO_TEXT);
    }
  } catch {
    // プライベートブラウジング等でlocalStorageが使えない場合はデモをスキップする
  }
}

const autosaver = new Autosaver(() => editor.getPlainText());
editor.setOnTextChanged(() => autosaver.scheduleSave());

if (shouldShowAutosaveNotice()) {
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

requireEl<HTMLButtonElement>('btn-dl-txt').addEventListener('click', () => {
  downloadText(editor.getPlainText(), 'txt', 'text/plain;charset=utf-8');
});
requireEl<HTMLButtonElement>('btn-dl-md').addEventListener('click', () => {
  downloadText(editor.getPlainText(), 'md', 'text/markdown;charset=utf-8');
});

const SHARE_ICON_SVG = `<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M252.31-100Q222-100 201-121q-21-21-21-51.31v-375.38Q180-578 201-599q21-21 51.31-21h72.31q12.76 0 21.38 8.62 8.61 8.61 8.61 21.38T346-568.62q-8.62 8.62-21.38 8.62h-72.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v375.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85h455.38q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46v-375.38q0-4.62-3.85-8.46-3.84-3.85-8.46-3.85h-72.31q-12.76 0-21.38-8.62-8.61-8.61-8.61-21.38t8.61-21.38q8.62-8.62 21.38-8.62h72.31Q738-620 759-599q21 21 21 51.31v375.38Q780-142 759-121q-21 21-51.31 21H252.31Zm206.31-238.62Q450-347.23 450-360v-411.23l-52.92 52.92q-8.93 8.93-20.89 8.81-11.96-.11-21.27-9.42-8.69-9.31-9-21.08-.3-11.77 9-21.07l99.77-99.77q5.62-5.62 11.85-7.93 6.23-2.3 13.46-2.3t13.46 2.3q6.23 2.31 11.85 7.93l99.77 99.77q8.3 8.3 8.5 20.57.19 12.27-8.5 21.58-9.31 9.31-21.39 9.31-12.07 0-21.38-9.31L510-771.23V-360q0 12.77-8.62 21.38Q492.77-330 480-330t-21.38-8.62Z"/></svg>`;

/** SP端末(navigator.share対応時)で共有するテキストファイルを、.txt/.mdダウンロードと同じ命名規則で作る */
function buildShareFile(text: string, ext: 'txt' | 'md', mime: string): File {
  return new File([text], defaultFilename(ext), { type: mime });
}

{
  const spBtn = requireEl<HTMLButtonElement>('sp-dl-btn');
  const spPanel = requireEl<HTMLElement>('sp-dl-panel');

  // SPで打ったテキストは、ファイルで欲しいというより他のアプリへ転記したいニーズの方が
  // 強いと想定し、Web Share API(navigator.share)に対応した端末ではOS標準の共有シートへ
  // 直接渡す。1タップで完結させ、ドロップダウンは出さない。ファイル共有(files)に対応した
  // 環境ではテキストと.txtファイルを一緒に渡し、受け取り先アプリ側に委ねる
  if (navigator.share) {
    spBtn.setAttribute('aria-label', '共有');
    spBtn.removeAttribute('aria-expanded');
    spBtn.removeAttribute('aria-controls');
    spBtn.innerHTML = SHARE_ICON_SVG;
    spPanel.remove();

    spBtn.addEventListener('click', () => {
      const text = editor.getPlainText();
      if (!text.trim()) return;
      const file = buildShareFile(text, 'txt', 'text/plain;charset=utf-8');
      const shareData: ShareData = navigator.canShare?.({ files: [file] }) ? { text, files: [file] } : { text };
      navigator.share(shareData).catch(() => {
        // ユーザーがキャンセルした場合などは何もしない
      });
    });
  } else {
    // 非対応ブラウザ向けフォールバック: 従来通りダウンロードのドロップダウンを出す
    const setPanelOpen = (open: boolean): void => {
      spPanel.hidden = !open;
      spBtn.setAttribute('aria-expanded', String(open));
    };

    spBtn.addEventListener('click', () => setPanelOpen(Boolean(spPanel.hidden)));
    requireEl<HTMLButtonElement>('sp-dl-txt').addEventListener('click', () => {
      downloadText(editor.getPlainText(), 'txt', 'text/plain;charset=utf-8');
      setPanelOpen(false);
    });
    requireEl<HTMLButtonElement>('sp-dl-md').addEventListener('click', () => {
      downloadText(editor.getPlainText(), 'md', 'text/markdown;charset=utf-8');
      setPanelOpen(false);
    });
    document.addEventListener('pointerdown', (e) => {
      if (spPanel.hidden) return;
      const target = e.target;
      if (target instanceof Node && (spPanel.contains(target) || spBtn.contains(target))) return;
      setPanelOpen(false);
    });
  }
}

// デバッグパネルは開発ビルド(npm run dev)でのみ生成する。import.meta.env.DEVは本番ビルドで
// 静的にfalseへ置き換わるため、この分岐ごとdebugPanel.ts/debug.cssは本番バンドルから除外される
if (import.meta.env.DEV) {
  void (async () => {
    const [{ DebugPanel }] = await Promise.all([import('./debugPanel'), import('./debug.css')]);
    new DebugPanel(editor);
  })();
}
