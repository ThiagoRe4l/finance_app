/**
 * Ambiente dos testes de componente (Vitest + jsdom).
 *
 * O jsdom não tem algumas APIs de browser que o Radix e os diálogos usam; aqui
 * entram versões mínimas. Nenhuma simula comportamento de layout — teste de
 * largura continua sendo o Playwright (M-15).
 */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

// `onOpenAutoFocus` dos formulários consulta `(pointer: coarse)` (M-12).
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Radix (Checkbox, Popover) mede elementos com ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

// Radix Select usa pointer capture e scrollIntoView, ausentes no jsdom.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
