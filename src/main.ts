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

for (const [txtId, mdId] of [
  ['btn-dl-txt', 'btn-dl-md'],
  ['sp-dl-txt', 'sp-dl-md'],
] as const) {
  requireEl<HTMLButtonElement>(txtId).addEventListener('click', () => {
    downloadText(editor.getPlainText(), 'txt', 'text/plain;charset=utf-8');
  });
  requireEl<HTMLButtonElement>(mdId).addEventListener('click', () => {
    downloadText(editor.getPlainText(), 'md', 'text/markdown;charset=utf-8');
  });
}

{
  const dlToggle = requireEl<HTMLButtonElement>('sp-dl-btn');
  const dlPanel = requireEl<HTMLElement>('sp-dl-panel');

  const setPanelOpen = (open: boolean): void => {
    dlPanel.hidden = !open;
    dlToggle.setAttribute('aria-expanded', String(open));
  };

  dlToggle.addEventListener('click', () => setPanelOpen(Boolean(dlPanel.hidden)));
  // ダウンロードを選んだらパネルを閉じる
  requireEl<HTMLButtonElement>('sp-dl-txt').addEventListener('click', () => setPanelOpen(false));
  requireEl<HTMLButtonElement>('sp-dl-md').addEventListener('click', () => setPanelOpen(false));
  document.addEventListener('pointerdown', (e) => {
    if (dlPanel.hidden) return;
    const target = e.target;
    if (target instanceof Node && (dlPanel.contains(target) || dlToggle.contains(target))) return;
    setPanelOpen(false);
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
