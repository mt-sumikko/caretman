import './style.css';
import { CaretmanEditor } from './editor';
import { downloadText } from './download';
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

// 仮の共有アイコン。UIリサーチが済んだら正式なSVGに差し替え予定
const SHARE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 16V4" />
  <path d="M7 8l5-5 5 5" />
  <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
</svg>`;

{
  const spBtn = requireEl<HTMLButtonElement>('sp-dl-btn');
  const spPanel = requireEl<HTMLElement>('sp-dl-panel');

  // SPで打ったテキストは、ファイルで欲しいというより他のアプリへ転記したいニーズの方が
  // 強いと想定し、Web Share API(navigator.share)に対応した端末ではOS標準の共有シートへ
  // 直接テキストを渡す。1タップで完結させ、ドロップダウンは出さない
  if (navigator.share) {
    spBtn.setAttribute('aria-label', '共有');
    spBtn.removeAttribute('aria-expanded');
    spBtn.removeAttribute('aria-controls');
    spBtn.innerHTML = SHARE_ICON_SVG;
    spPanel.remove();

    spBtn.addEventListener('click', () => {
      const text = editor.getPlainText();
      if (!text.trim()) return;
      navigator.share({ text }).catch(() => {
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
