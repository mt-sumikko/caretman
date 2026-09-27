import rough from 'roughjs';
import type { RoughSVG } from 'roughjs/bin/svg';
import { jitter } from './utils';
import type { Point, Pose } from './types';

const JITTER_AMOUNT = 0.5;

// rough.js: 比較検証ツール(5倍スケール)で調整した値を、このプロトタイプの座標系(1/5)に換算した値
const ROUGH_ROUGHNESS = 0.34;
const ROUGH_BOWING = 0.3;
const ROUGH_STROKE_WIDTH = 1.1;
const ROUGH_SEED = 7; // 固定シード(line boilとの二重ゆらぎを避けるため、毎ティックは変えない)

export interface RendererElements {
  svg: SVGSVGElement;
  cleanGroup: SVGGElement;
  roughGroup: SVGGElement;
  pHead: SVGPathElement;
  pBody: SVGPathElement;
  pArms: SVGPathElement;
  pLegs: SVGPathElement;
}

function jitterPoint(p: Point, amount: number): Point {
  return { x: p.x + jitter(amount), y: p.y + jitter(amount) };
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`;
}

export class StickmanRenderer {
  private readonly els: RendererElements;
  private readonly rc: RoughSVG | null;
  private lastSignature: string | null = null;

  constructor(els: RendererElements) {
    this.els = els;
    try {
      this.rc = rough.svg(els.svg);
    } catch {
      this.rc = null;
    }
  }

  get roughAvailable(): boolean {
    return this.rc !== null;
  }

  draw(pose: Pose, focused: boolean, useTexture: boolean): void {
    const a = focused ? JITTER_AMOUNT : 0;

    // line boil(jitter)は毎ティック新しい乱数を使うため、フォーカス中は常に再描画が必要。
    // フォーカスが外れてjitterが0になっている時だけ、前回と同一ポーズなら再描画をスキップできる
    if (a === 0) {
      const signature = JSON.stringify([pose, useTexture]);
      if (signature === this.lastSignature) return;
      this.lastSignature = signature;
    } else {
      this.lastSignature = null;
    }

    const neck = jitterPoint(pose.neck, a);
    const hip = jitterPoint(pose.hip, a);
    const armL = jitterPoint(pose.armL, a);
    const armR = jitterPoint(pose.armR, a);
    const kneeL = jitterPoint(pose.kneeL, a);
    const kneeR = jitterPoint(pose.kneeR, a);
    const legL = jitterPoint(pose.legL, a);
    const legR = jitterPoint(pose.legR, a);

    // 肩(胴の30%地点)を起点に、肘・膝を制御点にしてQ/curveで滑らかに繋ぐ
    const shoulder: Point = {
      x: neck.x + (hip.x - neck.x) * 0.3,
      y: neck.y + (hip.y - neck.y) * 0.3,
    };
    const elbowL: Point = { x: (shoulder.x + armL.x) / 2, y: (shoulder.y + armL.y) / 2 + pose.elbowBend };
    const elbowR: Point = { x: (shoulder.x + armR.x) / 2, y: (shoulder.y + armR.y) / 2 + pose.elbowBend };

    const headCx = pose.head.cx + jitter(a);
    const headCy = pose.head.cy + jitter(a * 0.6);
    const headRy = pose.head.r + jitter(a * 0.3);
    const headRx = Math.max(1.2, headRy * (0.88 - pose.squashAmt * 0.73)); // squash=0でも少し縦長の楕円に

    const { cleanGroup, roughGroup, pHead, pBody, pArms, pLegs } = this.els;
    const useRough = useTexture && this.rc !== null;
    cleanGroup.style.display = useRough ? 'none' : '';
    roughGroup.style.display = useRough ? '' : 'none';

    if (useRough && this.rc) {
      while (roughGroup.firstChild) roughGroup.removeChild(roughGroup.firstChild);
      const opts = {
        roughness: ROUGH_ROUGHNESS,
        bowing: ROUGH_BOWING,
        stroke: getComputedStyle(document.body).color,
        strokeWidth: ROUGH_STROKE_WIDTH,
        seed: ROUGH_SEED,
      };
      try {
        roughGroup.appendChild(this.rc.ellipse(headCx, headCy, headRx * 2, Math.max(3, headRy) * 2, opts));
        roughGroup.appendChild(this.rc.line(neck.x, neck.y, hip.x, hip.y, opts));
        roughGroup.appendChild(
          this.rc.curve(
            [
              [armL.x, armL.y],
              [elbowL.x, elbowL.y],
              [shoulder.x, shoulder.y],
              [elbowR.x, elbowR.y],
              [armR.x, armR.y],
            ],
            opts,
          ),
        );
        roughGroup.appendChild(
          this.rc.curve(
            [
              [legL.x, legL.y],
              [kneeL.x, kneeL.y],
              [hip.x, hip.y],
              [kneeR.x, kneeR.y],
              [legR.x, legR.y],
            ],
            opts,
          ),
        );
      } catch {
        // 描画中に失敗しても次のティックで再試行するだけにする(クリーン版へはフォールバックしない)
      }
    } else {
      pHead.setAttribute('d', ellipsePath(headCx, headCy, headRx, Math.max(3, headRy)));
      pBody.setAttribute('d', `M ${neck.x} ${neck.y} L ${hip.x} ${hip.y}`);
      pArms.setAttribute(
        'd',
        `M ${armL.x} ${armL.y} Q ${elbowL.x} ${elbowL.y} ${shoulder.x} ${shoulder.y} Q ${elbowR.x} ${elbowR.y} ${armR.x} ${armR.y}`,
      );
      pLegs.setAttribute(
        'd',
        `M ${legL.x} ${legL.y} Q ${kneeL.x} ${kneeL.y} ${hip.x} ${hip.y} Q ${kneeR.x} ${kneeR.y} ${legR.x} ${legR.y}`,
      );
    }
  }
}
