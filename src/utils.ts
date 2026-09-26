export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function jitter(amount: number): number {
  return (Math.random() - 0.5) * 2 * amount;
}
