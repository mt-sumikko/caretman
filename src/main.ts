import './style.css';
import { CaretmanEditor } from './editor';
import { downloadText } from './download';
import { INTRO_DEMO_STORAGE_KEY } from './introDemo';

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

const INTRO_DEMO_TEXT = 'いっしょに書いてこ〜！';
try {
  if (!localStorage.getItem(INTRO_DEMO_STORAGE_KEY)) {
    localStorage.setItem(INTRO_DEMO_STORAGE_KEY, '1');
    void editor.runIntroDemo(INTRO_DEMO_TEXT);
  }
} catch {
  // プライベートブラウジング等でlocalStorageが使えない場合はデモをスキップする
}

requireEl<HTMLButtonElement>('btn-dl-txt').addEventListener('click', () => {
  downloadText(editor.getPlainText(), 'txt', 'text/plain;charset=utf-8');
});
requireEl<HTMLButtonElement>('btn-dl-md').addEventListener('click', () => {
  downloadText(editor.getPlainText(), 'md', 'text/markdown;charset=utf-8');
});

// デバッグパネルは開発ビルド(npm run dev)でのみ生成する。import.meta.env.DEVは本番ビルドで
// 静的にfalseへ置き換わるため、この分岐ごとdebugPanel.ts/debug.cssは本番バンドルから除外される
if (import.meta.env.DEV) {
  void (async () => {
    const [{ DebugPanel }] = await Promise.all([import('./debugPanel'), import('./debug.css')]);
    new DebugPanel(editor);
  })();
}
