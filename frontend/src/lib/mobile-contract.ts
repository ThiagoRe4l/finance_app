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

/** Quebra um trecho de código em candidatos a classe. */
function tokens(text: string): string[] {
  return text.split(/[\s"'`{}()<>,;=+]+/).filter(Boolean);
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * Tags de abertura de um elemento JSX: do `<Nome` até o `>` que fecha a tag,
 * pulando o que estiver dentro de `{...}` e de strings (setas `=>` e
 * comparações em expressões não encerram a tag).
 */
function openingTags(
  source: string,
  names: readonly string[],
): { name: string; text: string; index: number }[] {
  const found: { name: string; text: string; index: number }[] = [];
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
    found.push({
      name: m[1],
      text: source.slice(m.index, i + 1),
      index: m.index,
    });
  }
  return found;
}

/** Unidades onde duas classes "andam juntas": cada tag de abertura e cada string. */
function classUnits(source: string): { text: string; index: number }[] {
  const units: { text: string; index: number }[] = openingTags(source, [
    "[A-Za-z][\\w.]*",
  ]);
  const str = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (let m = str.exec(source); m; m = str.exec(source)) {
    units.push({ text: m[2], index: m.index });
  }
  return units;
}

const P1 = /^grid-cols-(\d+)$/;
const P4_HEIGHT = /^(?:h|size)-(?:(\d+(?:\.\d+)?)|\[(\d+)px\])$/;
const P5 = /^(?:min-h-screen|h-screen|max-h-screen)$/;
const P5_ARBITRARY_VH = /(?<![dsl])\d+vh\b/;
const P6_ARBITRARY = /^(?:min-)?w-\[(\d+)px\]$/;
const P6_SCALE = /^(?:min-)?w-(?:80|96)$/;

export function findViolations(source: string): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();
  const add = (rule: Rule, index: number, match: string) => {
    const line = lineOf(source, index);
    const key = `${rule}:${line}:${match}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ rule, line, match });
    }
  };

  // P1, P5 e P6 olham classe por classe, em qualquer lugar do arquivo.
  const tok = /[^\s"'`{}()<>,;=+]+/g;
  for (let m = tok.exec(source); m; m = tok.exec(source)) {
    const cls = m[0];
    const n = P1.exec(cls);
    if (n && Number(n[1]) >= 5) add("P1", m.index, cls);
    // P5 não tem exceção por breakpoint: vale o utilitário depois do último `:`.
    if (P5.test(cls.split(":").pop() ?? "")) add("P5", m.index, cls);
    if (P5_ARBITRARY_VH.test(cls) && cls.includes("[")) add("P5", m.index, cls);
    const w = P6_ARBITRARY.exec(cls);
    if (w && Number(w[1]) >= 320) add("P6", m.index, cls);
    if (P6_SCALE.test(cls)) add("P6", m.index, cls);
  }
  // `100vh` cru em `style={{ … }}` também é P5.
  const rawVh = /(?<![dsl\w])100vh\b/g;
  for (let m = rawVh.exec(source); m; m = rawVh.exec(source)) {
    add("P5", m.index, m[0]);
  }

  // P2: `opacity-0` sem prefixo junto de `group-hover:opacity-100`.
  for (const unit of classUnits(source)) {
    const t = tokens(unit.text);
    if (t.includes("opacity-0") && t.includes("group-hover:opacity-100")) {
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
      const h = P4_HEIGHT.exec(cls);
      if (!h) continue;
      const px = h[1] !== undefined ? Number(h[1]) * 4 : Number(h[2]);
      if (px < 44) add("P4", tag.index, cls);
    }
  }

  return out.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}
