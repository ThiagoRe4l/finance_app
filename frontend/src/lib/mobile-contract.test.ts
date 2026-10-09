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
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { findViolations, type Rule } from "./mobile-contract.ts";

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

// ── 2. A varredura ───────────────────────────────────────────────────────

/**
 * Pendências: arquivo × padrão, cada uma com a fatia que a remove. **Só
 * diminui.** Acrescentar uma entrada é mudança visível neste diff.
 *
 * P5 não aparece de propósito: a fatia 1a troca todo `vh` por `dvh`.
 */
const PENDING: Record<string, { rule: Rule; slice: string }[]> = {
  "routes/transacoes.tsx": [
    { rule: "P1", slice: "2" },
    { rule: "P2", slice: "2" },
    { rule: "P3", slice: "2" },
    { rule: "P4", slice: "2" },
  ],
  "routes/categorias.tsx": [
    { rule: "P2", slice: "4" },
    { rule: "P4", slice: "4" },
  ],
  "routes/parcelamentos.tsx": [{ rule: "P4", slice: "4" }],
  "components/categories/CategoryFormDialog.tsx": [{ rule: "P4", slice: "4" }],
};

/** Exceções justificadas da tabela P1–P6. */
const EXCEPTIONS: Record<string, Rule[]> = {
  // Só renderiza a partir de `lg`, com mouse.
  "components/dashboard/Sidebar.tsx": ["P4"],
};

function scannedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (relative(SRC, full) !== join("components", "ui")) walk(full);
      } else if (entry.name.endsWith(".tsx")) out.push(full);
    }
  };
  walk(join(SRC, "routes"));
  walk(join(SRC, "components"));
  return out.sort();
}

const files = scannedFiles();
const found = new Map<string, Map<Rule, string[]>>();
for (const full of files) {
  const rel = relative(SRC, full).split("\\").join("/");
  for (const v of findViolations(readFileSync(full, "utf8"))) {
    if (EXCEPTIONS[rel]?.includes(v.rule)) continue;
    const byRule = found.get(rel) ?? new Map<Rule, string[]>();
    byRule.set(v.rule, [
      ...(byRule.get(v.rule) ?? []),
      `L${v.line} ${v.match}`,
    ]);
    found.set(rel, byRule);
  }
}

test("a varredura leu os arquivos que devia (guarda contra varredura vazia)", () => {
  // 21 em 08/10/2026. Crescer é normal; cair para perto de zero quer dizer
  // que o caminho mudou e a varredura passou a não ver nada.
  assert.ok(files.length >= 21, `só ${files.length} arquivos lidos`);
  assert.ok(
    !files.some((f) => f.includes(join("components", "ui"))),
    "components/ui/ (shadcn gerado) não entra na varredura",
  );
});

test("nenhum padrão proibido fora da lista de pendências", () => {
  const unexpected: string[] = [];
  for (const [file, byRule] of found) {
    for (const [rule, hits] of byRule) {
      if (!PENDING[file]?.some((p) => p.rule === rule)) {
        unexpected.push(`${rule} ${file}: ${hits.join(", ")}`);
      }
    }
  }
  assert.deepEqual(
    unexpected,
    [],
    `violações novas:\n${unexpected.join("\n")}`,
  );
});

test("toda pendência ainda viola (a lista só diminui)", () => {
  const stale: string[] = [];
  for (const [file, entries] of Object.entries(PENDING)) {
    for (const { rule, slice } of entries) {
      if (!found.get(file)?.has(rule))
        stale.push(`${rule} ${file} (fatia ${slice})`);
    }
  }
  assert.deepEqual(
    stale,
    [],
    `pendências já resolvidas — remova da lista:\n${stale.join("\n")}`,
  );
});
