/**
 * Conversões de cor e contraste (WCAG), só para o teste do tema.
 *
 * O `styles.css` exige `oklch` em toda cor (comentário no topo dele), mas o
 * contraste do WCAG se calcula em sRGB: este arquivo faz a ponte, para o teste
 * de tema conferir par a par que o texto passa de 4,5:1 sem depender do olho.
 * Funções puras; nada daqui vai para o bundle.
 */

export type Rgb = [number, number, number];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  const v = clamp01(c);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** `#RRGGBB` → componentes sRGB de 0 a 1. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new TypeError(`cor hexadecimal inválida: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as Rgb;
}

/** `oklch(L C H)` (L de 0 a 1, H em graus) → sRGB de 0 a 1. */
export function oklchToRgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    linearToSrgb(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    linearToSrgb(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

/** sRGB de 0 a 1 → `[L, C, H]` do oklch (H em graus). */
export function rgbToOklch([r, g, b]: Rgb): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

/** Luminância relativa do WCAG. */
export function luminance([r, g, b]: Rgb): number {
  return (
    0.2126 * srgbToLinear(clamp01(r)) +
    0.7152 * srgbToLinear(clamp01(g)) +
    0.0722 * srgbToLinear(clamp01(b))
  );
}

/** Razão de contraste do WCAG entre duas cores (1 a 21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `oklch(0.975 0.005 90)` → sRGB. Aceita `/ alfa`, que é ignorado. */
export function parseOklch(text: string): Rgb {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(text.trim());
  if (!m) throw new TypeError(`oklch inválido: ${text}`);
  return oklchToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** `oklch(L C H)` com 3 casas, para colar no `styles.css`. */
export function hexToOklchText(hex: string): string {
  const [l, c, h] = rgbToOklch(hexToRgb(hex));
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
}
