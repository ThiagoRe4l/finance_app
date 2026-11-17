/**
 * Contrato da fatia 4c — nome longo sem quebra e diálogo de exclusão
 * (`docs/mobile-first.md` → M-16).
 *
 * Escrito **antes** da implementação, conforme o processo do CLAUDE.md. Teste
 * sobre arquivo, um por asserção: cada um pode falhar sozinho. A prova de que
 * o documento não transborda é a auditoria Playwright (M-16), não este arquivo.
 *
 * Padrão de quebra: o contêiner do nome é `min-w-0` (item de flex encolhe) e o
 * texto é `wrap-anywhere` (entra no cálculo da largura mínima, ao contrário de
 * `break-words`); o que fica ao lado é `shrink-0`, e dinheiro é
 * `whitespace-nowrap` (M-13).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  classesIn,
  elements,
  fn,
  tagAround,
  tagAt,
  type Element,
} from "./jsx-source.ts";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function read(rel: string): string {
  assert.ok(existsSync(path(rel)), `${rel.replace("../", "")} não existe`);
  return readFileSync(path(rel), "utf8");
}

const CATEGORIES = "../routes/categorias.tsx";
const INSTALLMENTS = "../routes/parcelamentos.tsx";
const REPORTS = "../routes/relatorios.tsx";
const TRANSACTIONS = "../routes/transacoes.tsx";
const CATEGORY_BARS = "../components/dashboard/CategoryBars.tsx";
const CATEGORY_SELECT = "../components/shared/CategorySelect.tsx";
const DELETE_CATEGORY = "../components/categories/DeleteCategoryDialog.tsx";
const DELETE_TRANSACTION =
  "../components/transactions/DeleteTransactionDialog.tsx";
const DELETE_INSTALLMENT =
  "../components/installments/DeleteInstallmentDialog.tsx";
const TRANSACTION_FORM = "../components/transactions/TransactionFormDialog.tsx";

function at(src: string, text: string): number {
  const i = src.indexOf(text);
  assert.ok(i >= 0, `sem ${text}`);
  return i;
}

/**
 * Onde está o texto JSX `text` (entre tags), aceitando a quebra de linha que o
 * Prettier põe quando a linha passa de 80 colunas. Devolve a posição do texto.
 */
function textAt(src: string, text: string): number {
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`>\\s*${esc}\\s*<`).exec(src);
  assert.ok(m, `sem o texto ${text}`);
  return m.index + m[0].indexOf(text);
}

/** Os elementos com `className` em volta de `text`, do mais externo ao mais interno. */
function chain(src: string, text: string): Element[] {
  const i = at(src, text);
  return elements(src)
    .filter((e) => e.start < i && i < e.end)
    .sort((a, b) => a.start - b.start);
}

/** O elemento com `className` mais interno em volta de `text`. */
function inner(src: string, text: string): string {
  const c = chain(src, text);
  assert.ok(c.length > 0, `nada com className em volta de ${text}`);
  return c[c.length - 1].tag;
}

/** O primeiro elemento em volta de `text` que tem o token `marker`. */
function around(src: string, text: string, marker: string): string {
  const e = chain(src, text).find((x) => classesIn(x.tag).includes(marker));
  assert.ok(e, `nenhum elemento com ${marker} em volta de ${text}`);
  return e.tag;
}

function hasTokens(tag: string, tokens: string[]) {
  const cls = classesIn(tag);
  assert.deepEqual(
    tokens.filter((t) => !cls.includes(t)),
    [],
    `faltam em: ${cls.join(" ")}`,
  );
}

const NAME_WRAP = ["min-w-0", "wrap-anywhere"];
const MONEY = ["shrink-0", "whitespace-nowrap"];
const SHEET_ALERT = ["max-sm:w-[calc(100%-2rem)]", "max-sm:rounded-lg"];
const TARGET = ["h-11", "sm:h-9"];
const HEADER_BUTTON = [
  "w-full",
  "justify-center",
  "min-h-11",
  "md:w-auto",
  "lg:min-h-0",
];

// ── Categorias: o cartão ─────────────────────────────────────────────────

const card = () => fn(read(CATEGORIES), "CategoryCard");
// O nome aparece também no aria-label (`Editar ${category.name}`): o texto
// visível é o que vem entre tags.
const NAME = ">{category.name}<";

test("categorias: o cartão (item da grade) tem min-w-0", () => {
  hasTokens(chain(card(), NAME)[0].tag, ["min-w-0"]);
});

test("categorias: o grupo ícone + nome tem min-w-0", () => {
  hasTokens(around(card(), NAME, "items-center"), ["min-w-0"]);
});

test("categorias: o ícone de 40 px não encolhe", () => {
  const src = card();
  hasTokens(tagAround(src, at(src, "h-10 w-10")), ["shrink-0"]);
});

test("categorias: o invólucro do nome tem min-w-0", () => {
  const src = card();
  hasTokens(tagAt(src, src.lastIndexOf("<div", at(src, NAME))), ["min-w-0"]);
});

test("categorias: o nome quebra em qualquer ponto (wrap-anywhere)", () => {
  const src = card();
  hasTokens(tagAround(src, at(src, NAME) + 1), ["wrap-anywhere"]);
});

test("categorias: o percentual ao lado do nome não encolhe", () => {
  const src = card();
  hasTokens(tagAround(src, at(src, "{progress.percent")), ["shrink-0"]);
});

test('categorias: "sem orçamento" ao lado do nome não encolhe', () => {
  const src = card();
  hasTokens(tagAround(src, textAt(src, "sem orçamento")), ["shrink-0"]);
});

test("categorias: o gasto não quebra", () => {
  const src = card();
  hasTokens(tagAround(src, at(src, "{formatBRL(progress.spent)}")), [
    "whitespace-nowrap",
  ]);
});

test('categorias: "de R$ …" não encolhe', () => {
  const src = card();
  hasTokens(tagAround(src, at(src, "de {formatBRL(progress.budget)}")), [
    "shrink-0",
  ]);
});

test('categorias: "sem orçamento definido" não encolhe', () => {
  const src = card();
  hasTokens(tagAround(src, at(src, "sem orçamento definido")), ["shrink-0"]);
});

test("categorias: a linha do gasto quebra quando não cabe (a 320, 234 > 222 px)", () => {
  hasTokens(around(card(), "{formatBRL(progress.spent)}", "items-baseline"), [
    "flex-wrap",
    "gap-x-2",
  ]);
});

// ── Relatórios e Dashboard: listas nome × valor ──────────────────────────

const topCategories = () => fn(read(REPORTS), "TopCategories");

test('relatórios: "Maiores categorias", o nome com min-w-0 e wrap-anywhere', () => {
  const src = topCategories();
  hasTokens(tagAround(src, at(src, ">{row.name}<") + 1), NAME_WRAP);
});

test('relatórios: "Maiores categorias", o valor sem encolher nem quebrar', () => {
  const src = topCategories();
  hasTokens(tagAround(src, at(src, "{formatBRL(row.value)}")), MONEY);
});

test('relatórios: "Maiores categorias", a linha com espaço entre nome e valor', () => {
  hasTokens(around(topCategories(), ">{row.name}<", "justify-between"), [
    "gap-3",
  ]);
});

test("dashboard: distribuição por categoria, o nome com min-w-0 e wrap-anywhere", () => {
  const src = read(CATEGORY_BARS);
  hasTokens(tagAround(src, textAt(src, "{row.name}")), NAME_WRAP);
});

test("dashboard: distribuição por categoria, o valor sem encolher nem quebrar", () => {
  const src = read(CATEGORY_BARS);
  hasTokens(tagAround(src, at(src, "{formatBRL(row.spent)}")), MONEY);
});

test("dashboard: distribuição por categoria, a linha com espaço entre nome e valor", () => {
  hasTokens(around(read(CATEGORY_BARS), "{row.name}", "justify-between"), [
    "gap-3",
  ]);
});

// ── Parcelamentos e Transações: o que a varredura achou ──────────────────

test('parcelamentos: "Categoria · termina em …" quebra o nome longo', () => {
  const src = read(INSTALLMENTS);
  hasTokens(
    tagAround(src, at(src, "{installment.category.name} · termina em")),
    ["wrap-anywhere"],
  );
});

test("transações (tabela, a partir de lg): a célula do título quebra", () => {
  const src = fn(read(TRANSACTIONS), "TransactionRow");
  hasTokens(tagAround(src, textAt(src, "{transaction.title}")), NAME_WRAP);
});

test("transações (tabela, a partir de lg): a célula da categoria quebra", () => {
  const src = fn(read(TRANSACTIONS), "TransactionRow");
  hasTokens(tagAround(src, at(src, "{transaction.category.name}")), NAME_WRAP);
});

test("CategorySelect: o item da lista quebra o nome longo", () => {
  hasTokens(inner(read(CATEGORY_SELECT), "{category.name}"), NAME_WRAP);
});

test("CategorySelect: o ícone do item não encolhe", () => {
  const src = read(CATEGORY_SELECT);
  hasTokens(tagAround(src, at(src, "<Icon") + 1), ["shrink-0"]);
});

test("formulário de transação: o título do parcelamento na lista quebra", () => {
  const src = read(TRANSACTION_FORM);
  const item = at(src, "<SelectItem key={it.id}");
  hasTokens(tagAt(src, src.indexOf("<", item + 1)), ["wrap-anywhere"]);
});

// ── Exclusão de categoria: o padrão dos outros dois diálogos ─────────────

test("excluir categoria: margem lateral e cantos abaixo de sm", () => {
  const src = read(DELETE_CATEGORY);
  hasTokens(tagAt(src, at(src, "<AlertDialogContent")), SHEET_ALERT);
});

test("excluir categoria: Cancelar/Entendi com 44 px abaixo de sm", () => {
  const src = read(DELETE_CATEGORY);
  hasTokens(tagAt(src, at(src, "<AlertDialogCancel")), TARGET);
});

test("excluir categoria: Excluir com 44 px abaixo de sm", () => {
  const src = read(DELETE_CATEGORY);
  hasTokens(tagAt(src, at(src, "<AlertDialogAction")), TARGET);
});

test("excluir categoria: o nome no título quebra", () => {
  const src = read(DELETE_CATEGORY);
  hasTokens(tagAt(src, at(src, "<AlertDialogTitle")), ["wrap-anywhere"]);
});

test("excluir transação: o título no título do diálogo quebra", () => {
  const src = read(DELETE_TRANSACTION);
  hasTokens(tagAt(src, at(src, "<AlertDialogTitle")), ["wrap-anywhere"]);
});

test("excluir parcelamento: o título no título do diálogo quebra", () => {
  const src = read(DELETE_INSTALLMENT);
  hasTokens(tagAt(src, at(src, "<AlertDialogTitle")), ["wrap-anywhere"]);
});

test("✅ excluir categoria: bloqueada, o Excluir continua sumindo", () => {
  // Regressão: já passa hoje (M-14). O 409 troca o conteúdo; repetir daria o
  // mesmo 409.
  assert.match(
    read(DELETE_CATEGORY),
    /\{!isBlocked && \(\s*<AlertDialogAction/,
  );
});

// ── Cabeçalho: "Nova categoria" e "Novo parcelamento" ────────────────────

for (const [file, label] of [
  [CATEGORIES, "Nova categoria"],
  [INSTALLMENTS, "Novo parcelamento"],
] as const) {
  test(`cabeçalho: "${label}" com largura total e 44 px abaixo de md/lg`, () => {
    const src = read(file);
    hasTokens(
      tagAt(src, src.lastIndexOf("<button", at(src, `/> ${label}`))),
      HEADER_BUTTON,
    );
  });
}

// ── Listas dos seletores: a largura fica na tela ─────────────────────────
//
// O Radix põe `min-width: max-content` no invólucro do conteúdo: o
// `wrap-anywhere` do item não basta, e a lista mediu 415 e 805 px a 360
// (auditoria da 4c). O limite é a largura disponível que o próprio Radix
// calcula.
const AVAILABLE_WIDTH = ["max-w-(--radix-select-content-available-width)"];

test("CategorySelect: a lista não passa da largura disponível", () => {
  const src = read(CATEGORY_SELECT);
  hasTokens(tagAt(src, at(src, "<SelectContent")), AVAILABLE_WIDTH);
});

test("formulário de transação: a lista de parcelamentos não passa da largura disponível", () => {
  const src = read(TRANSACTION_FORM);
  const content = src.lastIndexOf(
    "<SelectContent",
    at(src, "<SelectItem value={NONE}>"),
  );
  hasTokens(tagAt(src, content), AVAILABLE_WIDTH);
});

// ── Review da 4c ─────────────────────────────────────────────────────────

// Ponto 1: durante a animação de fechar, `category` já é undefined e o título
// piscava `Excluir "undefined"?`. O padrão do DeleteInstallmentDialog guarda
// a última categoria aberta.
test("excluir categoria: guarda a última categoria aberta (shown)", () => {
  assert.ok(
    /useState\(category\)/.test(read(DELETE_CATEGORY)),
    "padrão do shown/gatilho ausente: ver o teste",
  );
});

test("excluir categoria: o shown acompanha a categoria aberta", () => {
  assert.ok(
    /if \(category\) setShown\(category\)/.test(read(DELETE_CATEGORY)),
    "padrão do shown/gatilho ausente: ver o teste",
  );
});

test("excluir categoria: o título lê o shown, não a prop", () => {
  assert.ok(
    /Excluir "\$\{shown\?\.name\}"\?/.test(read(DELETE_CATEGORY)),
    "padrão do shown/gatilho ausente: ver o teste",
  );
});

test("excluir categoria: o DELETE usa o shown", () => {
  assert.ok(
    /\/categories\/\$\{shown!\.id\}/.test(read(DELETE_CATEGORY)),
    "padrão do shown/gatilho ausente: ver o teste",
  );
});

// Ponto 2: o nome quebrado não encosta no percentual / "sem orçamento".
test("categorias: a linha do nome tem espaço entre o nome e o que fica ao lado", () => {
  hasTokens(around(card(), NAME, "items-start"), ["gap-3"]);
});

// Ponto 3: a 320, o "de R$ …" desce sozinho; fica à direita e com folga.
test('categorias: "de R$ …" fica à direita quando desce', () => {
  const src = card();
  hasTokens(tagAround(src, at(src, "de {formatBRL(progress.budget)}")), [
    "ml-auto",
  ]);
});

test("categorias: a linha do gasto tem folga vertical quando quebra", () => {
  hasTokens(around(card(), "{formatBRL(progress.spent)}", "items-baseline"), [
    "gap-y-1",
  ]);
});

// Ponto 4 (medido: o gatilho crescia para 407 px a 360 e cortava o nome sem
// reticências): o gatilho não cresce além da coluna, e o nome tem reticências
// só dentro dele — na lista, continua quebrando.
test("CategorySelect: o gatilho não cresce além da coluna (min-w-0)", () => {
  const src = read(CATEGORY_SELECT);
  assert.ok(
    /className=\{cn\("[^"]*\bmin-w-0\b[^"]*", triggerClassName\)\}/.test(
      tagAt(src, at(src, "<SelectTrigger")),
    ),
    'o gatilho sem cn("min-w-0", triggerClassName)',
  );
});

test("CategorySelect: o nome tem reticências no gatilho", () => {
  hasTokens(inner(read(CATEGORY_SELECT), "{category.name}"), [
    "min-w-0",
    "in-[[role=combobox]]:truncate",
  ]);
});

// ── Review final da 4c (medido a 360 px) ─────────────────────────────────
//
// O gatilho da lista de parcelamentos cresceu para 797 px com o título longo
// selecionado (o mesmo mecanismo do de categoria), e a seta dos dois gatilhos
// era espremida para 6–11 px: ela é filha direta do gatilho, em `ui/`, e só
// dá para protegê-la pelo ponto de uso (`[&>svg]:shrink-0`).

test("formulário de transação: o gatilho de parcelamento não cresce e a seta não encolhe", () => {
  const src = read(TRANSACTION_FORM);
  hasTokens(
    tagAt(
      src,
      src.lastIndexOf("<SelectTrigger", at(src, 'id="tx-installment"')),
    ),
    ["min-w-0", "[&>svg]:shrink-0"],
  );
});

test("formulário de transação: o título do parcelamento tem reticências no gatilho", () => {
  const src = read(TRANSACTION_FORM);
  const item = at(src, "<SelectItem key={it.id}");
  hasTokens(tagAt(src, src.indexOf("<", item + 1)), [
    "in-[[role=combobox]]:block",
    "in-[[role=combobox]]:truncate",
  ]);
});

test("CategorySelect: a seta do gatilho não encolhe", () => {
  const src = read(CATEGORY_SELECT);
  assert.ok(
    tagAt(src, at(src, "<SelectTrigger")).includes("[&>svg]:shrink-0"),
    "o gatilho sem [&>svg]:shrink-0",
  );
});

// Durante a animação de fechar, `transaction` já é undefined: o título
// piscava `Excluir ""?` e o valor, R$ 0,00 — o caso que o `shown` resolveu nos
// diálogos de categoria e de parcelamento.
test("excluir transação: guarda a última transação aberta (shown)", () => {
  assert.ok(
    /useState\(transaction\)/.test(read(DELETE_TRANSACTION)),
    "sem useState(transaction)",
  );
});

test("excluir transação: o título lê o shown", () => {
  assert.ok(
    read(DELETE_TRANSACTION).includes('Excluir "{shown?.title}"?'),
    "o título não lê shown",
  );
});

test("excluir transação: o valor e o DELETE leem o shown", () => {
  const src = read(DELETE_TRANSACTION);
  assert.ok(
    src.includes("signedAmount(shown)") &&
      src.includes("/transactions/${shown!.id}"),
    "valor ou DELETE sem shown",
  );
});
