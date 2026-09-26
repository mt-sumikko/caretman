import './style.css';
import './debug.css';
import { CaretmanEditor } from './editor';
import { DebugPanel } from './debugPanel';

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

new DebugPanel(
  {
    toggleButton: requireEl('debug-toggle'),
    panel: requireEl('debug-panel'),
    statusEl: requireEl('debug-status'),
    scaleInput: requireEl('debug-scale'),
    scaleOut: requireEl('debug-scale-out'),
    gapInput: requireEl('debug-gap'),
    gapOut: requireEl('debug-gap-out'),
    giveUpButton: requireEl('debug-giveup'),
    textureToggle: requireEl('debug-texture'),
  },
  editor,
);
