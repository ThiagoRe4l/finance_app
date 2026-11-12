/**
 * `jsx-source.ts` — leitura de JSX por texto, para os testes de contrato.
 *
 * Item N do backlog (12/11/2026): os auxiliares estavam copiados em 5 arquivos
 * de teste. A extração é refatoração; os testes de `tagAt`, `classesIn`,
 * `elementEnd` e `fn` são **regressão** (o comportamento é o de antes). Os
 * dois marcados com 🆕 cobrem as fragilidades registradas no backlog e foram
 * escritos antes da correção:
 *
 * * 🆕 `elements` tratava o genérico `useState<Transaction>` como uma tag;
 * * 🆕 a conferência do `<PageHeader>` usava `header.includes(...)`, que
 *   casava a prop também **dentro** da expressão de `action`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classesIn,
  elementEnd,
  elements,
  fn,
  propValue,
  tagAt,
} from "./jsx-source.ts";

test("tagAt pula expressões e strings: `=>` não fecha a tag", () => {
  const src = `<button onClick={() => go(a > b)} className="h-11">x</button>`;
  assert.equal(
    tagAt(src, 0),
    `<button onClick={() => go(a > b)} className="h-11">`,
  );
});

test("classesIn lê className literal e template, sem os ${…}", () => {
  assert.deepEqual(classesIn(`<p className="a  b">`), ["a", "b"]);
  assert.deepEqual(classesIn("<p className={`a ${x ? 'y' : ''} b`}>"), [
    "a",
    "b",
  ]);
});

test("elementEnd conta aninhados e ignora auto-fechados", () => {
  const src = `<div className="o"><div className="i" /><div>t</div></div><p/>`;
  assert.equal(
    src.slice(0, elementEnd(src, 0)),
    `<div className="o"><div className="i" /><div>t</div></div>`,
  );
});

test("fn devolve o corpo até a próxima função de topo", () => {
  const src = `function A() {\n  return 1;\n}\nfunction B() {}\n`;
  assert.equal(fn(src, "A"), "function A() {\n  return 1;\n}");
});

test("🆕 elements não confunde genérico TypeScript com tag", () => {
  const src = `const [x] = useState<Transaction | undefined>();\nreturn <div className="a">ok</div>;`;
  assert.deepEqual(
    elements(src).map((e) => e.tag),
    [`<div className="a">`],
  );
});

test("🆕 propValue só lê a prop no nível da tag, não dentro de expressão", () => {
  const nested = `<PageHeader title="T" action={<X actionClassName="hidden lg:flex" />}>`;
  assert.equal(propValue(nested, "actionClassName"), null);
  const top = `<PageHeader actionClassName="hidden lg:flex" action={<X />}>`;
  assert.equal(propValue(top, "actionClassName"), "hidden lg:flex");
});
