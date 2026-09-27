import { DemoStickmanState, DEMO_STATES, type DemoState } from './state';
import { StickmanRenderer } from '../render';

/**
 * このファイルの役割(ざっくり):
 * motion-review.htmlの「モーション図鑑」を描く。各モーションを一定の時間間隔で切り出したコマを横に並べ、
 * 1モーション=1枚の帯(フィルムストリップ)として表示する。
 * 保存済みの画像を貼るのではなく、開くたびにstate.tsの実際の計算から描くので、モーションを調整すると
 * 図鑑も自動的に最新になる。
 */

interface StripSpec {
  /** 切り出し開始時刻(ピルを押してからのms) */
  start: number;
  /** 切り出す長さ(ms)。静止ポーズは0 */
  duration: number;
  frames: number;
  caption?: string;
}

// 各モーションの見どころを切り出す時間帯。ワンショット系は1回分、繰り返し系は1周期分
const SPECS: Record<DemoState, StripSpec> = {
  base: { start: 0, duration: 0, frames: 1 },
  shortIdle: { start: 3000, duration: 200, frames: 5, caption: '3秒待ってから腕を上げる(以降はキャレットのように点滅)' },
  shortIdleBetween: { start: 3000, duration: 200, frames: 5, caption: '文字の間では体を細く潰す' },
  walk: { start: 0, duration: 560, frames: 9, caption: '1周期=左右1歩ずつ' },
  longIdle: { start: 2000, duration: 1800, frames: 9, caption: '1周期=左右に1往復' },
  givenUp: { start: 0, duration: 1500, frames: 7, caption: '立ち姿からあぐらへ' },
  jump: { start: 0, duration: 700, frames: 11, caption: '助走→跳躍→着地' },
  throw: { start: 0, duration: 380, frames: 11, caption: '溜め→振り抜き→余韻→戻り' },
  confirmHop: { start: 0, duration: 240, frames: 9, caption: '右へ移動する場合(左へは左右反転)' },
  composing: { start: 0, duration: 0, frames: 1, caption: '実際は半透明で表示' },
  selecting: { start: 0, duration: 0, frames: 1 },
  pasting: { start: 0, duration: 0, frames: 1 },
};

const SIM_STEP_MS = 16; // 実際の描画間隔(60fps)と同じ刻みで状態を進める(なめらかに変化する値があるため)
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** 1コマ分のsvg(地面の線+棒人間)を作って描く */
function buildFrame(): { svg: SVGSVGElement; renderer: StickmanRenderer } {
  // ジャンプの頂点(頭がy≒-58)や放り投げの腕(x≒±22)まで収まる範囲。地面はy=8
  const svg = svgEl('svg', { viewBox: '-30 -64 60 76', class: 'strip-frame', 'aria-hidden': 'true' });
  svg.append(svgEl('line', { x1: -30, x2: 30, y1: 8, y2: 8, class: 'strip-ground' }));
  const cleanGroup = svgEl('g');
  const paths = [0, 1, 2, 3].map(() => {
    const p = svgEl('path', { class: 'stroke' });
    cleanGroup.append(p);
    return p;
  });
  const roughGroup = svgEl('g');
  svg.append(cleanGroup, roughGroup);
  const renderer = new StickmanRenderer({
    svg,
    cleanGroup,
    roughGroup,
    pHead: paths[0],
    pBody: paths[1],
    pArms: paths[2],
    pLegs: paths[3],
  });
  return { svg, renderer };
}

function buildStrip(value: DemoState, label: string, spec: StripSpec): HTMLElement {
  const card = document.createElement('figure');
  card.className = 'strip';

  const header = document.createElement('figcaption');
  header.className = 'strip-header';
  const title = document.createElement('span');
  title.className = 'strip-title';
  title.textContent = label;
  const meta = document.createElement('span');
  meta.className = 'strip-meta';
  meta.textContent =
    spec.duration === 0 ? '静止ポーズ' : `${(spec.duration / 1000).toFixed(2)}秒 / ${spec.frames}コマ`;
  header.append(title, meta);
  if (spec.caption) {
    const cap = document.createElement('span');
    cap.className = 'strip-caption';
    cap.textContent = spec.caption;
    header.append(cap);
  }

  const row = document.createElement('div');
  row.className = 'strip-row';

  const state = new DemoStickmanState();
  state.restart(0);
  let t = 0;
  let pose = state.computePose(t, value);
  for (let i = 0; i < spec.frames; i++) {
    const offset = spec.frames === 1 ? 0 : (spec.duration * i) / (spec.frames - 1);
    const target = spec.start + offset;
    while (t < target) {
      t += SIM_STEP_MS;
      pose = state.computePose(t, value);
    }

    const cell = document.createElement('div');
    cell.className = 'strip-cell';
    const { svg, renderer } = buildFrame();
    if (value === 'composing') svg.style.opacity = '0.4';
    // 図鑑は見比べやすさ優先で、line boil(ゆらぎ)なし・手描き風の線で描く
    renderer.draw(pose, false, renderer.roughAvailable);
    const time = document.createElement('span');
    time.className = 'strip-time';
    time.textContent = spec.duration === 0 ? '' : `${Math.round(offset)}ms`;
    cell.append(svg, time);
    row.append(cell);
  }

  card.append(header, row);
  return card;
}

export function renderFilmstrips(container: HTMLElement): void {
  for (const { value, label } of DEMO_STATES) {
    container.append(buildStrip(value, label, SPECS[value]));
  }
}
