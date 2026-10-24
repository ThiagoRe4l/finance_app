/**
 * Teste de contrato da reforma mobile-first — `docs/mobile-first.md` → M-7.
 *
 * Escrito **antes** da implementação da fatia 1a, conforme o processo do
 * CLAUDE.md. Duas partes:
 *
 * 1. **Guardas do detector** (✅ já passam — não contam como cobertura nova):
 *    um caso que tem que ser pego e um que tem que passar, por padrão. Sem
 *    elas, um detector quebrado deixaria a varredura verde por vacuidade.
 * 2. **A varredura** sobre `src/routes/**` e `src/components/**` (menos o
 *    shadcn de `components/ui/`), com a lista de pendências que **só
 *    diminui**. Falha nos dois sentidos: violação fora da lista, e entrada da
 *    lista que já não viola (a fatia que a corrigiu tem que tirá-la daqui).
 *
 * É heurística sobre strings de classe: pega a volta dos padrões conhecidos,
 * não problema novo de layout. P4 só vê altura explícita.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  comparePending,
  EXCLUDED_DIRS,
  findViolations,
  scanDirs,
  scanFiles,
  type FoundCounts,
  type PendingEntry,
  type Rule,
} from "./mobile-contract.ts";

const SRC = fileURLToPath(new URL("..", import.meta.url));

// ── 1. Guardas do detector ───────────────────────────────────────────────

const rules = (src: string) => findViolations(src).map((v) => v.rule);

test("✅ guarda P1: grid-cols-12 sem prefixo é pego; md:grid-cols-12 e grid-cols-4 passam", () => {
  assert.deepEqual(rules(`<div className="grid grid-cols-12" />`), ["P1"]);
  assert.deepEqual(
    rules(`<div className="grid grid-cols-1 md:grid-cols-12" />`),
    [],
  );
  assert.deepEqual(rules(`<div className="grid grid-cols-4" />`), []);
});

test("✅ guarda P2: esconder no hover só passa a partir de breakpoint", () => {
  assert.deepEqual(
    rules(`<div className="opacity-0 group-hover:opacity-100" />`),
    ["P2"],
  );
  assert.deepEqual(
    rules(`<div className="md:opacity-0 md:group-hover:opacity-100" />`),
    [],
  );
});

test("✅ guarda P3: <input> cru com text-sm é pego; text-base md:text-sm e <Input> passam", () => {
  assert.deepEqual(
    rules(`<input\n  type="search"\n  className="text-sm"\n/>`),
    ["P3"],
  );
  assert.deepEqual(rules(`<input className="text-base md:text-sm" />`), []);
  assert.deepEqual(rules(`<Input className="text-sm" />`), []);
});

test("✅ guarda P4: alvo de toque abaixo de 44 px é pego; h-11, md:h-8 e ícone dentro passam", () => {
  assert.deepEqual(
    rules(`<button onClick={() => x > 1} className="h-7 w-7">`),
    ["P4"],
  );
  assert.deepEqual(rules(`<Link to="/" className="h-[40px]">`), ["P4"]);
  assert.deepEqual(rules(`<button className="h-11 md:h-8">`), []);
  // A altura do ícone filho não é a do botão.
  assert.deepEqual(
    rules(`<button className="p-3">\n  <Pencil className="h-4 w-4" />`),
    [],
  );
});

test("✅ guarda P5: min-h-screen, h-screen, [90vh] e 100vh são pegos; dvh passa", () => {
  assert.deepEqual(rules(`<div className="min-h-screen" />`), ["P5"]);
  assert.deepEqual(rules(`<div className="lg:h-screen" />`), ["P5"]);
  assert.deepEqual(rules(`<div className="max-h-[90vh]" />`), ["P5"]);
  assert.deepEqual(rules(`<div style={{ height: "100vh" }} />`), ["P5"]);
  assert.deepEqual(rules(`<div className="min-h-dvh max-h-[90dvh]" />`), []);
});

test("✅ guarda P6: largura fixa de 320 px ou mais sem prefixo é pega; md:w-96 e max-w passam", () => {
  assert.deepEqual(rules(`<div className="w-80" />`), ["P6"]);
  assert.deepEqual(rules(`<div className="min-w-[360px]" />`), ["P6"]);
  assert.deepEqual(
    rules(`<div className="w-full md:w-96 max-w-[1400px]" />`),
    [],
  );
  assert.deepEqual(rules(`<div className="w-[319px]" />`), []);
});

// ── 1b. Endurecimento (revisão da 1a) — escritos antes da implementação ──

test("P2 com prefixo no hover: opacity-0 + md:group-hover:opacity-100 é pego", () => {
  // Abaixo de `md` a ação fica invisível e não há hover: é o mesmo defeito.
  assert.deepEqual(
    rules(`<div className="opacity-0 md:group-hover:opacity-100" />`),
    ["P2"],
  );
  assert.deepEqual(
    rules(
      `<div className="opacity-0 group-focus-within:opacity-100 lg:group-hover:opacity-100" />`,
    ),
    ["P2"],
  );
  // Escondido só a partir do breakpoint continua permitido.
  assert.deepEqual(
    rules(`<div className="md:opacity-0 md:group-hover:opacity-100" />`),
    [],
  );
});

test("P1 com grid-cols arbitrário: 5 trilhas ou mais é pego", () => {
  assert.deepEqual(
    rules(`<div className="grid grid-cols-[repeat(6,minmax(0,1fr))]" />`),
    ["P1"],
  );
  assert.deepEqual(
    rules(`<div className="grid grid-cols-[80px_1fr_1fr_1fr_80px]" />`),
    ["P1"],
  );
  assert.deepEqual(rules(`<div className="grid grid-cols-[1fr_2fr]" />`), []);
  assert.deepEqual(
    rules(`<div className="grid md:grid-cols-[repeat(6,1fr)]" />`),
    [],
  );
  // auto-fill/auto-fit se adapta à largura: não é coluna fixa.
  assert.deepEqual(
    rules(
      `<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))]" />`,
    ),
    [],
  );
});

test("P4 em rem: h-[2rem] é pego; h-[2.75rem] (44 px) passa", () => {
  assert.deepEqual(rules(`<button className="h-[2rem]">`), ["P4"]);
  assert.deepEqual(rules(`<Button className="size-[2.5rem]">`), ["P4"]);
  assert.deepEqual(rules(`<button className="h-[2.75rem]">`), []);
});

test("P6 em rem: w-[20rem] e min-w-[22rem] são pegos; w-[19.5rem] e md:w-[30rem] passam", () => {
  assert.deepEqual(rules(`<div className="w-[20rem]" />`), ["P6"]);
  assert.deepEqual(rules(`<div className="min-w-[22rem]" />`), ["P6"]);
  assert.deepEqual(rules(`<div className="w-[19.5rem]" />`), []);
  assert.deepEqual(rules(`<div className="md:w-[30rem]" />`), []);
});

test("✅ uma violação por padrão por linha: vh dentro de calc() conta uma vez", () => {
  // Com o `CLASS_TOKEN` respeitando colchetes, a classe inteira e o `100vh`
  // cru batem na mesma linha; sem a chave por linha, contariam dois.
  // (Escrito quando passava por acaso: o tokenizador antigo quebrava no `(`.)
  assert.deepEqual(rules(`<div className="h-[calc(100vh-4rem)]" />`), ["P5"]);
});

const counts = (entries: [string, Rule, number][]): FoundCounts => {
  const m: FoundCounts = new Map();
  for (const [file, rule, n] of entries) {
    const byRule = m.get(file) ?? new Map<Rule, number>();
    byRule.set(rule, n);
    m.set(file, byRule);
  }
  return m;
};

test("comparePending: uma ocorrência a mais que a lista falha", () => {
  const pending: Record<string, PendingEntry[]> = {
    "routes/a.tsx": [{ rule: "P4", count: 2, slice: "2" }],
  };
  const r = comparePending(counts([["routes/a.tsx", "P4", 3]]), pending);
  assert.equal(r.extra.length, 1, JSON.stringify(r));
  assert.match(r.extra[0], /P4 routes\/a\.tsx: 3 \(lista permite 2\)/);
  assert.deepEqual(r.stale, []);
});

test("comparePending: padrão ou arquivo fora da lista falha", () => {
  const r = comparePending(
    counts([
      ["routes/a.tsx", "P1", 1],
      ["routes/b.tsx", "P4", 1],
    ]),
    { "routes/a.tsx": [{ rule: "P4", count: 1, slice: "2" }] },
  );
  assert.deepEqual(r.extra.sort(), [
    "P1 routes/a.tsx: 1 (lista permite 0)",
    "P4 routes/b.tsx: 1 (lista permite 0)",
  ]);
  assert.deepEqual(r.stale, ["P4 routes/a.tsx: 0 (lista diz 1, fatia 2)"]);
});

test("comparePending: contagem menor que a lista também falha (a lista só diminui)", () => {
  const r = comparePending(counts([["routes/a.tsx", "P4", 1]]), {
    "routes/a.tsx": [{ rule: "P4", count: 2, slice: "4" }],
  });
  assert.deepEqual(r.extra, []);
  assert.deepEqual(r.stale, ["P4 routes/a.tsx: 1 (lista diz 2, fatia 4)"]);
});

test("✅ comparePending: contagem igual à lista não acusa nada", () => {
  const r = comparePending(counts([["routes/a.tsx", "P4", 2]]), {
    "routes/a.tsx": [{ rule: "P4", count: 2, slice: "2" }],
  });
  assert.deepEqual(r, { extra: [], stale: [] });
});

// ── Trilhas mistas, P2 com grupo nomeado e `!`, escopo único da varredura ──

test("P1 com trilhas mistas: repeat(3,1fr)_1fr_1fr são 5 colunas", () => {
  assert.deepEqual(
    rules(`<div className="grid grid-cols-[repeat(3,1fr)_1fr_1fr]" />`),
    ["P1"],
  );
  assert.deepEqual(
    rules(`<div className="grid grid-cols-[repeat(2,1fr)_repeat(4,1fr)]" />`),
    ["P1"],
  );
  assert.deepEqual(
    rules(`<div className="grid grid-cols-[repeat(2,1fr)_1fr]" />`),
    [],
  );
  // `_` dentro de parênteses é espaço do valor, não separador de trilha.
  assert.deepEqual(
    rules(`<div className="grid grid-cols-[minmax(0,_1fr)_minmax(0,_2fr)]" />`),
    [],
  );
});

test("P2 com grupo nomeado e com !: group-hover/row: e !opacity-100 são pegos", () => {
  assert.deepEqual(
    rules(`<div className="opacity-0 group-hover/row:opacity-100" />`),
    ["P2"],
  );
  assert.deepEqual(
    rules(`<div className="opacity-0 group-hover:!opacity-100" />`),
    ["P2"],
  );
  // Tailwind v4 escreve o `!` no fim; o do começo ainda é aceito.
  assert.deepEqual(
    rules(`<div className="opacity-0 md:group-hover/row:opacity-100!" />`),
    ["P2"],
  );
  assert.deepEqual(
    rules(`<div className="md:opacity-0 md:group-hover/row:!opacity-100" />`),
    [],
  );
});

// ── P7: rolagem horizontal (M-11, fatia 1d) ─────────────────────────────
// Escritos antes da implementação: vermelhos até o detector conhecer o P7.

test("P7: overflow-x-auto/-scroll e overflow-auto/-scroll são pegos, com ou sem prefixo", () => {
  for (const cls of [
    "overflow-x-auto",
    "overflow-x-scroll",
    "overflow-auto",
    "overflow-scroll",
    "md:overflow-x-auto",
    "[&>div]:overflow-auto",
    "!overflow-x-auto",
    "overflow-x-auto!",
  ]) {
    assert.deepEqual(rules(`<div className="${cls}" />`), ["P7"], cls);
  }
  // Fora de `className` também: o detector olha classe em qualquer lugar.
  assert.deepEqual(rules(`cn("flex", "overflow-x-auto")`), ["P7"]);
});

test("✅ P7: rolagem vertical e corte não são rolagem horizontal", () => {
  // Já passa antes do P7 existir (nada é pego). Vale como trava contra um P7
  // largo demais — os formulários em Dialog usam overflow-y-auto.
  for (const cls of [
    "overflow-y-auto",
    "overflow-y-scroll",
    "overflow-hidden",
    "overflow-x-hidden",
    "overflow-x-clip",
    "overflow-visible",
    "overscroll-x-contain",
  ]) {
    assert.deepEqual(rules(`<div className="${cls}" />`), [], cls);
  }
});

test("P7: components/ui/ fica fora porque está excluído, não porque o detector o ignora", () => {
  // O `Table` do shadcn usa `overflow-auto` (ver o item (b) da 1d). Se a
  // exclusão de `components/ui` sumir, a varredura o acusa — este teste prova
  // que o detector o vê e que só a exclusão o tira.
  const table = readFileSync(join(SRC, "components/ui/table.tsx"), "utf8");
  assert.ok(
    findViolations(table).some((v) => v.rule === "P7"),
    "o detector não vê o overflow-auto do ui/table.tsx",
  );
  assert.ok(
    !scanFiles(SRC).includes("components/ui/table.tsx"),
    "ui/table.tsx entrou na varredura",
  );
});

/** Monta uma árvore `src/` descartável no diretório temporário do SO. */
function fixture(paths: string[]): string {
  const src = mkdtempSync(join(tmpdir(), "mobile-contract-"));
  for (const p of paths) {
    const full = join(src, p);
    if (p.endsWith("/")) mkdirSync(full, { recursive: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, "");
    }
  }
  return src;
}

const tree = fixture([
  "routes/a.tsx",
  "routes/nested/b.tsx",
  "components/x/c.tsx",
  "components/x/helper.ts",
  "components/ui/d.tsx",
  "components/ui/inner/e.tsx",
  "components/empty/",
]);

test("scanFiles: os .tsx das raízes, sem components/ui/", () => {
  assert.deepEqual(scanFiles(tree), [
    "components/x/c.tsx",
    "routes/a.tsx",
    "routes/nested/b.tsx",
  ]);
});

test("scanDirs: as raízes e suas pastas, sem components/ui/ nem o que está dentro", () => {
  assert.deepEqual(scanDirs(tree), [
    "components",
    "components/empty",
    "components/x",
    "routes",
    "routes/nested",
  ]);
});

// ── 2. A varredura ───────────────────────────────────────────────────────

/**
 * Pendências: arquivo × padrão × **quantidade**, cada uma com a fatia que a
 * remove. **Só diminui.** Uma ocorrência a mais falha; uma a menos também, para
 * a fatia que corrigiu baixar a contagem aqui. Mexer nesta lista é mudança
 * visível no diff. A contagem é de linhas: uma violação por padrão por linha.
 *
 * P5 não aparece de propósito: a fatia 1a trocou todo `vh` por `dvh`.
 */
const PENDING: Record<string, PendingEntry[]> = {
  "routes/transacoes.tsx": [
    { rule: "P1", count: 2, slice: "2" },
    { rule: "P2", count: 1, slice: "2" },
    { rule: "P3", count: 1, slice: "2" },
    { rule: "P4", count: 2, slice: "2" },
  ],
  "routes/categorias.tsx": [
    { rule: "P2", count: 1, slice: "4" },
    { rule: "P4", count: 2, slice: "4" },
  ],
  "routes/parcelamentos.tsx": [{ rule: "P4", count: 2, slice: "4" }],
  "components/categories/CategoryFormDialog.tsx": [
    { rule: "P4", count: 2, slice: "4" },
  ],
};

/** Exceções justificadas da tabela P1–P7. */
const EXCEPTIONS: Record<string, Rule[]> = {
  // A tabela M-7 a isenta porque ela só renderiza a partir de `lg`, com mouse
  // (`hidden lg:flex` desde a fatia 1c).
  "components/dashboard/Sidebar.tsx": ["P4"],
  // M-11: a única rolagem horizontal permitida, numa região focável
  // (`month-scroller.test.ts` confere `role`, `tabIndex` e `aria-label`).
  "components/shared/MonthScroller.tsx": ["P7"],
};

const files = scanFiles(SRC);
const found: FoundCounts = new Map();
const hitsOf = new Map<string, string[]>();
for (const rel of files) {
  for (const v of findViolations(readFileSync(join(SRC, rel), "utf8"))) {
    if (EXCEPTIONS[rel]?.includes(v.rule)) continue;
    const byRule = found.get(rel) ?? new Map<Rule, number>();
    byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
    found.set(rel, byRule);
    const key = `${v.rule} ${rel}`;
    hitsOf.set(key, [...(hitsOf.get(key) ?? []), `L${v.line} ${v.match}`]);
  }
}
const comparison = comparePending(found, PENDING);
const withHits = (lines: string[]) =>
  lines.map((l) => {
    const key = l.split(":")[0];
    return `${l} — ${(hitsOf.get(key) ?? []).join(", ")}`;
  });

test("todo diretório varrido contribui com pelo menos um arquivo", () => {
  // Substitui o piso de 21 arquivos: um piso não pega uma pasta inteira que
  // deixe de ser lida. Pastas e arquivos vêm das mesmas raízes e exclusões
  // (`SCANNED_ROOTS`, `EXCLUDED_DIRS`), mas por caminhos de código separados.
  const dirs = scanDirs(SRC);
  const empty = dirs.filter((d) => !files.some((f) => f.startsWith(`${d}/`)));
  assert.ok(dirs.length >= 7, `só ${dirs.length} pastas: ${dirs.join(", ")}`);
  assert.deepEqual(
    empty,
    [],
    `pastas sem nenhum .tsx lido: ${empty.join(", ")}`,
  );
  for (const excluded of EXCLUDED_DIRS) {
    assert.ok(
      !files.some((f) => f.startsWith(`${excluded}/`)),
      `${excluded}/ não entra na varredura`,
    );
  }
});

test("P7: a exceção do MonthScroller cobre exatamente uma rolagem horizontal", () => {
  // Sem isto a exceção valeria para o arquivo inteiro: uma segunda área
  // rolável ali passaria calada, e um MonthScroller sem rolagem também.
  const rel = "components/shared/MonthScroller.tsx";
  assert.ok(files.includes(rel), `${rel} não está na varredura`);
  // Conta classes, não linhas: o detector acusa uma violação por padrão por
  // linha, e uma segunda rolagem na mesma linha passaria pela contagem dele.
  const classes = (
    readFileSync(join(SRC, rel), "utf8").match(/[^\s"'`{}]+/g) ?? []
  ).filter((t) =>
    findViolations(`<div className="${t}" />`).some((v) => v.rule === "P7"),
  );
  assert.deepEqual(classes, ["overflow-x-auto"]);
});

test("nenhuma violação além da lista de pendências (arquivo, padrão e quantidade)", () => {
  assert.deepEqual(
    comparison.extra,
    [],
    `violações a mais:\n${withHits(comparison.extra).join("\n")}`,
  );
});

test("toda pendência ainda tem a contagem da lista (a lista só diminui)", () => {
  assert.deepEqual(
    comparison.stale,
    [],
    `pendências que diminuíram — atualize a lista:\n${comparison.stale.join("\n")}`,
  );
});
