/**
 * Ícones do app (aba, atalho do iOS) e a marca dentro do app (M-17).
 *
 * Os testes dos `<link>` e da documentação foram escritos **antes** da
 * implementação. Os ✅ já passavam quando o arquivo foi escrito: os arquivos de
 * `public/` estavam no disco, fora do git, e o `BrandMark` já existia (commit
 * `3320a53`, com o próprio `brand-mark.test.ts`). Eles guardam o formato dos
 * arquivos e a igualdade entre os dois desenhos daqui para a frente.
 *
 * Um teste por asserção. Os arquivos de `public/` são lidos como bytes: o teste
 * confere o formato que o browser vai receber, não só que o arquivo existe.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function bytes(rel: string): Buffer {
  assert.ok(
    existsSync(path(rel)),
    `${rel.replace(/^(\.\.\/)+/, "")} não existe`,
  );
  return readFileSync(path(rel));
}

const read = (rel: string) => bytes(rel).toString("utf8");

const ROOT = "../routes/__root.tsx";
const PUBLIC = "../../public/";
const SVG = `${PUBLIC}favicon.svg`;
const ICO = `${PUBLIC}favicon.ico`;
const PNG = `${PUBLIC}apple-touch-icon.png`;
const MARK = "../components/shared/BrandMark.tsx";
const MOBILE_DOC = "../../../docs/mobile-first.md";
const CLAUDE_MD = "../../../CLAUDE.md";

/** Os objetos `{ chave: "valor", … }` do array `links` do `head()` do `__root`. */
function headLinks(): Record<string, string>[] {
  const src = read(ROOT);
  const start = src.indexOf("links: [");
  assert.ok(start >= 0, "sem links: [ no __root");
  const block = src.slice(start, src.indexOf("],", start));
  return [...block.matchAll(/\{([^{}]*)\}/g)].map((m) =>
    Object.fromEntries(
      [...m[1].matchAll(/(\w+):\s*"([^"]*)"/g)].map((p) => [p[1], p[2]]),
    ),
  );
}

const ICON_LINKS = [
  // "32x32", não "any": com "any" o Chrome e o Edge preferem o .ico ao SVG.
  { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

// ── <link> no <head> ─────────────────────────────────────────────────────

for (const expected of ICON_LINKS) {
  test(`__root: links tem ${JSON.stringify(expected)}`, () => {
    const found = headLinks().find((l) => l.href === expected.href);
    assert.deepEqual(found, expected);
  });
}

for (const { href } of ICON_LINKS) {
  test(`✅ ${href} existe em frontend/public/`, () => {
    assert.ok(
      existsSync(path(`${PUBLIC}${href.slice(1)}`)),
      `${href} não existe`,
    );
  });
}

// ── Formato dos arquivos ─────────────────────────────────────────────────

test("✅ apple-touch-icon.png tem 180 × 180 (IHDR)", () => {
  const png = bytes(PNG);
  assert.equal(png.toString("latin1", 12, 16), "IHDR");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [180, 180]);
});

test("✅ favicon.ico começa com 00 00 01 00 e tem 3 imagens", () => {
  const ico = bytes(ICO);
  assert.deepEqual(
    [ico.subarray(0, 4).toString("hex"), ico.readUInt16LE(4)],
    ["00000100", 3],
  );
});

test("✅ favicon.ico tem uma imagem de 32 × 32 (a que o <link> declara)", () => {
  // Diretório do ICO: 6 bytes de cabeçalho e 16 por imagem; largura e altura
  // nos dois primeiros (0 significa 256).
  const ico = bytes(ICO);
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const at = 6 + 16 * i;
    return `${ico[at] || 256}x${ico[at + 1] || 256}`;
  });
  assert.ok(sizes.includes("32x32"), `imagens do .ico: ${sizes.join(", ")}`);
});

test('✅ favicon.svg tem viewBox="0 0 64 64"', () => {
  assert.ok(read(SVG).includes('viewBox="0 0 64 64"'), "viewBox diferente");
});

// O .ico entra porque guarda PNGs dentro, que podem levar o chunk caBX.
for (const file of [SVG, PNG, ICO]) {
  test(`✅ ${file.replace(PUBLIC, "")} sem metadado de proveniência (c2pa, caBX)`, () => {
    const raw = bytes(file).toString("latin1");
    assert.deepEqual(
      ["c2pa", "caBX"].filter((tag) =>
        raw.toLowerCase().includes(tag.toLowerCase()),
      ),
      [],
    );
  });
}

// ── A marca do app é o mesmo desenho do favicon ──────────────────────────

/** Os elementos do desenho, na ordem em que aparecem. */
const DRAWING = ["linearGradient", "stop", "rect", "path"] as const;

/** `strokeWidth` → `stroke-width`; o JSX e o SVG escrevem o mesmo atributo. */
const kebab = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * Cada elemento do desenho com os atributos literais (`nome="valor"`), em
 * kebab-case. Ficam de fora o `id` do gradiente e o `fill="url(#…)"` que aponta
 * para ele: no `BrandMark` os dois vêm do `useId`, de propósito (`{…}` no JSX).
 */
function drawing(source: string): string[] {
  const tag = new RegExp(`<(${DRAWING.join("|")})\\b([^>]*?)\\/?>`, "g");
  return [...source.matchAll(tag)].map((m) => {
    const attrs = [...m[2].matchAll(/([\w-]+)="([^"]*)"/g)]
      .map(([, name, value]) => [kebab(name), value] as const)
      .filter(([name, value]) => name !== "id" && !value.startsWith("url("))
      .map(([name, value]) => `${name}=${value}`)
      .sort();
    return `${m[1]} ${attrs.join(" ")}`;
  });
}

test("✅ BrandMark: o mesmo desenho do favicon.svg, elemento por elemento e na mesma ordem", () => {
  // Nos dois sentidos: um atributo a mais, a menos ou diferente (rx, espessura
  // do traço, cor, ordem das paradas do gradiente) faz os dois diferirem.
  assert.deepEqual(drawing(read(MARK)), drawing(read(SVG)));
});

test("✅ BrandMark: o quadrado é pintado pelo gradiente (fill aponta para o id do useId)", () => {
  // A comparação acima ignora o id e o url(#…), que no BrandMark vêm do useId;
  // sem esta ligação o quadrado ficaria preto e ela continuaria verde.
  const mark = read(MARK);
  const id = /<linearGradient\b[^>]*\bid=\{(\w+)\}/.exec(mark)?.[1];
  const fill = /<rect\b[^>]*\bfill=\{`url\(#\$\{(\w+)\}\)`\}/.exec(mark)?.[1];
  assert.ok(
    id && id === fill,
    `gradiente id={${id}}, quadrado fill=url(#\${${fill}})`,
  );
});

test("✅ BrandMark: o desenho comparado não está vazio", () => {
  // Guarda contra a comparação acima passar com duas listas vazias.
  assert.deepEqual(
    drawing(read(SVG)).map((e) => e.split(" ")[0]),
    ["linearGradient", "stop", "stop", "rect", "path", "path"],
  );
});

// ── Documentação ─────────────────────────────────────────────────────────

test("✅ docs/mobile-first.md: a seção M-17 registra a marca (BrandMark e favicon.svg)", () => {
  const doc = read(MOBILE_DOC);
  const start = doc.indexOf("### M-17");
  assert.ok(start >= 0, "sem a seção ### M-17");
  const end = doc.indexOf("\n### ", start + 1);
  const section = doc.slice(start, end < 0 ? undefined : end);
  assert.deepEqual(
    ["BrandMark", "favicon.svg"].filter((piece) => !section.includes(piece)),
    [],
  );
});

test("CLAUDE.md: a árvore de components/shared/ lista exatamente o que existe na pasta", () => {
  const line = read(CLAUDE_MD)
    .split("\n")
    .find((l) => /├── shared\/\s+#/.test(l));
  assert.ok(line, "sem a linha de shared/ na árvore");
  const listed = line
    .slice(line.indexOf("#") + 1)
    .split(",")
    .map((n) => n.trim())
    .sort();
  const onDisk = readdirSync(path("../components/shared"))
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => f.replace(/\.tsx?$/, ""))
    .sort();
  assert.deepEqual(listed, onDisk);
});

// Da fatia 4 de docs/periodos.md (13/11/2026), mantido na troca pela M-17.
test("✅ favicon.svg não depende de rede (sem fonte nem imagem externa)", () => {
  assert.doesNotMatch(read(SVG), /https?:\/\/(?!www\.w3\.org)/);
});
