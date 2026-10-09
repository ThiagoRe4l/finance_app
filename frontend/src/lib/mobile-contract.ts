/**
 * Detector dos padrões proibidos P1–P6 da reforma mobile-first
 * (`docs/mobile-first.md` → M-7).
 *
 * Heurística sobre strings de classe, não layout medido: pega a volta dos
 * padrões conhecidos, não problema novo. "Sem prefixo" significa sem nenhum
 * variante antes do utilitário (`md:`, `group-hover:`, `[&>*]:`…) — o que vale
 * em toda largura, inclusive a de celular.
 */

export type Rule = "P1" | "P2" | "P3" | "P4" | "P5" | "P6";

export type Violation = { rule: Rule; line: number; match: string };

/** Classe sem variante: nada de `xx:` antes do utilitário. */
const bare = (cls: string) => !cls.includes(":");

/** O utilitário sem as variantes: `md:group-hover:opacity-100` → `opacity-100`. */
const utility = (cls: string) => cls.slice(cls.lastIndexOf(":") + 1);

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

/** Quantas colunas um `grid-cols-*` fixa; 0 quando se adapta à largura. */
function gridTracks(cls: string): number {
  const scale = /^grid-cols-(\d+)$/.exec(cls);
  if (scale) return Number(scale[1]);
  const arbitrary = /^grid-cols-\[(.+)\]$/.exec(cls);
  if (!arbitrary) return 0;
  const repeat = /^repeat\((\d+),/.exec(arbitrary[1]);
  if (repeat) return Number(repeat[1]);
  if (arbitrary[1].startsWith("repeat(")) return 0; // auto-fill / auto-fit
  return arbitrary[1].split("_").length;
}

const P4_HEIGHT =
  /^(?:h|size)-(?:(\d+(?:\.\d+)?)|\[(\d+(?:\.\d+)?)(px|rem)\])$/;
const P5 = /^(?:min-h-screen|h-screen|max-h-screen)$/;
const P5_ARBITRARY_VH = /(?<![dsl])\d+vh\b/;
const P6_ARBITRARY = /^(?:min-)?w-\[(\d+(?:\.\d+)?)(px|rem)\]$/;
const P6_SCALE = /^(?:min-)?w-(?:80|96)$/;

/**
 * Violações de P1–P6 num arquivo `.tsx`.
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

  // P1, P5 e P6 olham classe por classe, em qualquer lugar do arquivo.
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
  }
  // `100vh` cru em `style={{ … }}` também é P5.
  for (const m of source.matchAll(/(?<![dsl\w])100vh\b/g)) {
    add("P5", m.index ?? 0, m[0]);
  }

  // P2: `opacity-0` sem prefixo junto de um `group-hover:opacity-100`, com ou
  // sem breakpoint antes — abaixo dele a ação fica invisível do mesmo jeito.
  for (const unit of classUnits(source)) {
    const t = tokens(unit.text);
    const revealsOnHover = t.some(
      (cls) => cls.includes("group-hover:") && utility(cls) === "opacity-100",
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
