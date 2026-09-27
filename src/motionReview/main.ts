import './style.css';
import { DemoStickmanState, DEMO_STATES, type DemoState } from './state';
import { StickmanRenderer } from '../render';

/**
 * このファイルの役割(ざっくり):
 * motion-review.html(本番のエディタとは別の、モーション確認専用ページ)の起動処理。
 * 実際の入力欄はなく、ボタンを押すと「打っている」「選択中」などの状態を強制的に
 * 切り替えられるようになっていて、各モーションの見た目を単体で確認・調整するための
 * 開発者向けツール。本番ビルドの本体(index.html)からは読み込まれない。
 */

function requireEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as unknown as T;
}

const figureEl = requireEl<HTMLElement>('figure');
const svgEl = figureEl.querySelector('svg');
if (!svgEl) throw new Error('#figure 内に svg が見つかりません');

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
const FOOT_BASELINE_OFFSET_RATIO = 8 / 60;

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

for (const { value, label, note } of DEMO_STATES) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'motion-pill';
  btn.dataset.value = value;
  btn.innerHTML = note ? `${label}<span class="note">${note}</span>` : label;
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

function loop(now: number): void {
  const pose = state.computePose(now, demoState);
  figureEl.classList.toggle('composing', demoState === 'composing');
  renderer.draw(pose, boilToggle.checked, textureToggle.checked);
  // キャレットの点滅表現(実エディタと同じ。該当しない時はnullなのでスタイルを外す)
  figureEl.style.opacity = pose.blinkOpacity === null ? '' : String(pose.blinkOpacity);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
