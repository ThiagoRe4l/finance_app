/**
 * Detector dos padrões proibidos P1–P7 da reforma mobile-first
 * (`docs/mobile-first.md` → M-7).
 *
 * Heurística sobre strings de classe, não layout medido: pega a volta dos
 * padrões conhecidos, não problema novo. "Sem prefixo" significa sem nenhum
 * variante antes do utilitário (`md:`, `group-hover:`, `[&>*]:`…) — o que vale
 * em toda largura, inclusive a de celular.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

export type Rule = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7";

export type Violation = { rule: Rule; line: number; match: string };

/** Classe sem variante: nada de `xx:` antes do utilitário. */
const bare = (cls: string) => !cls.includes(":");

/** O utilitário sem as variantes: `md:group-hover:opacity-100` → `opacity-100`. */
const utility = (cls: string) => cls.slice(cls.lastIndexOf(":") + 1);

/** As variantes antes do utilitário: `md:group-hover/row:x` → `["md", "group-hover/row"]`. */
const variants = (cls: string) => cls.split(":").slice(0, -1);

/** `!opacity-100` (v3) e `opacity-100!` (v4) → `opacity-100`. */
const withoutImportant = (util: string) => util.replace(/^!|!$/g, "");

/**
 * Um candidato a classe. Respeita colchetes: dentro de `[...]` valem `(`, `,`
 * e `>` (`grid-cols-[repeat(6,1fr)]`, `[&>*]:p-2`); fora, eles separam código.
 * É a única definição de "classe" do detector — todas as regras a usam.
 */
const CLASS_TOKEN = /(?:\[[^\]\s"'`]*\]|[^\s"'`{}()<>,;=+[\]])+/g;

function tokens(text: string): string[] {
  return text.match(CLASS_TOKEN) ?? [];
}

/** Um trecho do arquivo e onde ele começa. */
type Unit = { text: string; index: number };

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * Tags de abertura de um elemento JSX: do `<Nome` até o `>` que fecha a tag,
 * pulando o que estiver dentro de `{...}` e de strings (setas `=>` e
 * comparações em expressões não encerram a tag).
 */
function openingTags(source: string, names: readonly string[]): Unit[] {
  const found: Unit[] = [];
  const re = new RegExp(`<(${names.join("|")})(?=[\\s/>])`, "g");
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === quote && source[i - 1] !== "\\") quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    found.push({ text: source.slice(m.index, i + 1), index: m.index });
  }
  return found;
}

/** Unidades onde duas classes "andam juntas": cada tag de abertura e cada string. */
function classUnits(source: string): Unit[] {
  const units = openingTags(source, ["[A-Za-z][\\w.]*"]);
  const str = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (let m = str.exec(source); m; m = str.exec(source)) {
    units.push({ text: m[2], index: m.index });
  }
  return units;
}

/** Valor arbitrário em px ou rem, convertido para px (1 rem = 16 px). */
const toPx = (value: string, unit: string) =>
  unit === "rem" ? Number(value) * 16 : Number(value);

/** Divide por `_` só no nível de cima: dentro de `(...)` o `_` é espaço do valor. */
function topLevelPieces(value: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "_" && depth === 0) {
      pieces.push(current);
      current = "";
    } else current += ch;
  }
  pieces.push(current);
  return pieces.filter(Boolean);
}

/** Quantas colunas um `grid-cols-*` fixa; 0 quando se adapta à largura. */
function gridTracks(cls: string): number {
  const scale = /^grid-cols-(\d+)$/.exec(cls);
  if (scale) return Number(scale[1]);
  const arbitrary = /^grid-cols-\[(.+)\]$/.exec(cls);
  if (!arbitrary) return 0;
  let tracks = 0;
  for (const piece of topLevelPieces(arbitrary[1])) {
    const repeat = /^repeat\((\d+),/.exec(piece);
    if (repeat) tracks += Number(repeat[1]);
    else if (piece.startsWith("repeat("))
      return 0; // auto-fill / auto-fit
    else tracks += 1;
  }
  return tracks;
}

const P4_HEIGHT =
  /^(?:h|size)-(?:(\d+(?:\.\d+)?)|\[(\d+(?:\.\d+)?)(px|rem)\])$/;
const P5 = /^(?:min-h-screen|h-screen|max-h-screen)$/;
const P5_ARBITRARY_VH = /(?<![dsl])\d+vh\b/;
const P6_ARBITRARY = /^(?:min-)?w-\[(\d+(?:\.\d+)?)(px|rem)\]$/;
const P6_SCALE = /^(?:min-)?w-(?:80|96)$/;
/** Rolagem horizontal (M-11); `overflow-y-*` é livre. */
const P7 = /^overflow-(?:x-)?(?:auto|scroll)$/;

/**
 * Violações de P1–P7 num arquivo `.tsx`.
 *
 * ⚠️ **Uma violação por padrão por linha.** Uma segunda violação do mesmo
 * padrão na mesma linha não é contada (é o que a lista de pendências mede).
 */
export function findViolations(source: string): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();
  const add = (rule: Rule, index: number, match: string) => {
    const line = lineOf(source, index);
    const key = `${rule}:${line}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ rule, line, match });
    }
  };

  // P1, P5, P6 e P7 olham classe por classe, em qualquer lugar do arquivo.
  for (const m of source.matchAll(CLASS_TOKEN)) {
    const cls = m[0];
    const index = m.index ?? 0;
    if (bare(cls) && gridTracks(cls) >= 5) add("P1", index, cls);
    // P5 não tem exceção por breakpoint: vale o utilitário depois do último `:`.
    if (P5.test(utility(cls))) add("P5", index, cls);
    if (P5_ARBITRARY_VH.test(cls) && cls.includes("[")) add("P5", index, cls);
    const width = P6_ARBITRARY.exec(cls);
    if (width && toPx(width[1], width[2]) >= 320) add("P6", index, cls);
    if (P6_SCALE.test(cls)) add("P6", index, cls);
    // P7, como o P5, vale com ou sem prefixo.
    if (P7.test(withoutImportant(utility(cls)))) add("P7", index, cls);
  }
  // `100vh` cru em `style={{ … }}` também é P5.
  for (const m of source.matchAll(/(?<![dsl\w])100vh\b/g)) {
    add("P5", m.index ?? 0, m[0]);
  }

  // P2: `opacity-0` sem prefixo junto de um `group-hover:opacity-100`, com ou
  // sem breakpoint antes — abaixo dele a ação fica invisível do mesmo jeito.
  // Vale também grupo nomeado (`group-hover/row:`) e `!` no começo ou no fim.
  for (const unit of classUnits(source)) {
    const t = tokens(unit.text);
    const revealsOnHover = t.some(
      (cls) =>
        variants(cls).some(
          (v) => v === "group-hover" || v.startsWith("group-hover/"),
        ) && withoutImportant(utility(cls)) === "opacity-100",
    );
    if (t.includes("opacity-0") && revealsOnHover) {
      add("P2", unit.index, "opacity-0 + group-hover:opacity-100");
    }
  }

  // P3: `<input>` cru com fonte < 16 px sem prefixo.
  for (const tag of openingTags(source, ["input"])) {
    for (const cls of tokens(tag.text)) {
      if (cls === "text-xs" || cls === "text-sm") add("P3", tag.index, cls);
    }
  }

  // P4: alvo de toque com altura base explícita abaixo de h-11 (44 px).
  for (const tag of openingTags(source, ["button", "Button", "a", "Link"])) {
    for (const cls of tokens(tag.text)) {
      if (!bare(cls)) continue;
      const height = P4_HEIGHT.exec(cls);
      if (!height) continue;
      const px =
        height[1] !== undefined
          ? Number(height[1]) * 4
          : toPx(height[2], height[3]);
      if (px < 44) add("P4", tag.index, cls);
    }
  }

  return out.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

export type PendingEntry = { rule: Rule; count: number; slice: string };

/** Contagem achada na varredura: arquivo → padrão → quantas violações. */
export type FoundCounts = Map<string, Map<Rule, number>>;

/**
 * Compara a varredura com a lista de pendências por **contagem**.
 * `extra`: violação além do que a lista permite (arquivo novo, padrão novo ou
 * uma ocorrência a mais). `stale`: entrada que já caiu (a fatia que corrigiu
 * tem que baixar ou tirar a entrada).
 *
 */
export function comparePending(
  found: FoundCounts,
  pending: Record<string, PendingEntry[]>,
): { extra: string[]; stale: string[] } {
  const extra: string[] = [];
  const stale: string[] = [];
  const allowed = (file: string, rule: Rule) =>
    pending[file]?.find((p) => p.rule === rule);
  for (const [file, byRule] of found) {
    for (const [rule, n] of byRule) {
      const limit = allowed(file, rule)?.count ?? 0;
      if (n > limit)
        extra.push(`${rule} ${file}: ${n} (lista permite ${limit})`);
    }
  }
  for (const [file, entries] of Object.entries(pending)) {
    for (const { rule, count, slice } of entries) {
      const n = found.get(file)?.get(rule) ?? 0;
      if (n < count) {
        stale.push(
          `${rule} ${file}: ${n} (lista diz ${count}, fatia ${slice})`,
        );
      }
    }
  }
  return { extra, stale };
}

// ── Escopo da varredura ──────────────────────────────────────────────────

/** Raízes varridas, relativas a `src/`. Fonte única: varredura e guarda usam esta lista. */
export const SCANNED_ROOTS = ["routes", "components"] as const;

/** Pastas fora da varredura (shadcn gerado, não se edita à mão). */
export const EXCLUDED_DIRS = ["components/ui"] as const;

const isExcluded = (rel: string) =>
  EXCLUDED_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`));

/** Todo `.tsx` das raízes, menos as pastas excluídas, relativo a `src` e com `/`. */
export function scanFiles(src: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(src, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!isExcluded(child)) walk(child);
      } else if (entry.name.endsWith(".tsx")) out.push(child);
    }
  };
  for (const root of SCANNED_ROOTS) walk(root);
  return out.sort();
}

/**
 * Toda pasta das raízes (as próprias raízes inclusive), menos as excluídas e o
 * que está dentro delas, relativa a `src` e com `/`. Caminho de código separado
 * de `scanFiles` de propósito: a guarda compara um com o outro.
 */
export function scanDirs(src: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    out.push(rel);
    for (const entry of readdirSync(join(src, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory() && !isExcluded(child)) walk(child);
    }
  };
  for (const root of SCANNED_ROOTS) walk(root);
  return out.sort();
}
