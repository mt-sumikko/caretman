import './style.css';
import { DemoStickmanState, DEMO_STATES, type DemoState } from './state';
import { StickmanRenderer } from '../render';
import { renderFilmstrips } from './filmstrips';

/**
 * このファイルの役割(ざっくり):
 * motion-review.html(モーション確認専用ページ)の起動処理。
 * 実際の入力欄はなく、ボタンを押すと「打っている」「選択中」などの状態に切り替えて、
 * 各モーションの見た目を単体で確認・調整するための開発者向けツール。
 * ポーズの計算は実エディタと同じsrc/pose.tsを使っている(state.tsがそれを操縦している)。
 */

function requireEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as unknown as T;
}

const figureEl = requireEl<HTMLElement>('figure');
const svgEl: SVGSVGElement = (() => {
  const el = figureEl.querySelector('svg');
  if (!el) throw new Error('#figure 内に svg が見つかりません');
  return el;
})();

const renderer = new StickmanRenderer({
  svg: svgEl,
  cleanGroup: requireEl('clean-group'),
  roughGroup: requireEl('rough-group'),
  pHead: requireEl('p-head'),
  pBody: requireEl('p-body'),
  pArms: requireEl('p-arms'),
  pLegs: requireEl('p-legs'),
});

const scaleInput = requireEl<HTMLInputElement>('scale');
const scaleOut = requireEl<HTMLElement>('scale-out');
const textureToggle = requireEl<HTMLInputElement>('texture');
const boilToggle = requireEl<HTMLInputElement>('boil');
const picker = requireEl<HTMLElement>('picker');
const sizeRefLeft = requireEl<HTMLElement>('size-ref-left');
const sizeRefRight = requireEl<HTMLElement>('size-ref-right');

if (!renderer.roughAvailable) {
  textureToggle.checked = false;
  textureToggle.disabled = true;
}

const FIGURE_RATIO = 30 / 44;
// 実エディタ(editor.ts)の「フォントサイズ→棒人間の高さ」の計算式と同じ倍率。
// この値で逆算し、「このサイズは大体何pxの文字に相当するか」を横に並べた文字で確認できるようにする
const BASE_HEIGHT_MULT = 1.35;
// 実エディタ(editor.ts)と同じ、「足先を文字のベースラインに揃える」ための下方向オフセット。
// これが無いと、ボックスの下端(=あ/愛と同じ位置)より上に立ち姿の足があるぶん、棒人間が浮いて見える
const FOOT_BASELINE_OFFSET_RATIO = 2 / 60;

function applySize(scale: number): void {
  const height = scale * 20;
  const width = height * FIGURE_RATIO;
  figureEl.style.width = `${width}px`;
  figureEl.style.height = `${height}px`;
  figureEl.style.transform = `translateY(${height * FOOT_BASELINE_OFFSET_RATIO}px)`;

  const equivalentFontSize = height / BASE_HEIGHT_MULT;
  sizeRefLeft.style.fontSize = `${equivalentFontSize}px`;
  sizeRefRight.style.fontSize = `${equivalentFontSize}px`;
}

scaleInput.addEventListener('input', () => {
  const v = parseFloat(scaleInput.value);
  scaleOut.textContent = v.toFixed(1);
  applySize(v);
});
applySize(parseFloat(scaleInput.value));
scaleOut.textContent = parseFloat(scaleInput.value).toFixed(1);

let demoState: DemoState = 'shortIdle';
const state = new DemoStickmanState();
state.restart(performance.now());

for (const { value, label } of DEMO_STATES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'motion-pill';
  btn.dataset.value = value;
  btn.textContent = label;
  if (value === demoState) btn.classList.add('active');
  btn.addEventListener('click', () => {
    demoState = value;
    state.restart(performance.now());
    for (const el of picker.querySelectorAll('.motion-pill')) {
      el.classList.toggle('active', el === btn);
    }
  });
  picker.appendChild(btn);
}

renderFilmstrips(requireEl<HTMLElement>('filmstrips'));

function loop(now: number): void {
  const pose = state.computePose(now, demoState);
  figureEl.classList.toggle('composing', demoState === 'composing');
  renderer.draw(pose, boilToggle.checked, textureToggle.checked);
  // キャレットの点滅表現(実エディタと同じくsvg側で切り替えて、パキッと点滅させる)
  svgEl.style.opacity = pose.blinkOpacity === null ? '' : String(pose.blinkOpacity);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
