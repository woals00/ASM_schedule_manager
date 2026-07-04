// Mount React inside an isolated Shadow DOM so SOMA's page CSS cannot leak in
// or out. CSS Modules must be imported with `?inline` and passed via `styles`,
// because Vite's default injection targets <head>, which is outside the shadow root.

import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';

export interface MountHandle {
  rerender(node: ReactNode): void;
  unmount(): void;
}

export interface MountOptions {
  // CSS text to inject into the shadow root. Use `import css from './x.module.css?inline'`.
  styles?: string[];
  // Tag for the host element. Defaults to 'div'.
  hostTag?: string;
  // Class name applied to the host element. Useful for the imperative side to find it.
  hostClass?: string;
  // Place the host immediately before this element when it belongs to `parent`.
  insertBefore?: Element;
  // Place the host immediately after this element when it belongs to `parent`.
  insertAfter?: Element;
  // Where to place the host inside `parent`. Defaults to 'end' (appendChild).
  insertAt?: 'start' | 'end';
}

export function mountReact(
  parent: Element,
  node: ReactNode,
  options: MountOptions = {},
): MountHandle {
  const host = document.createElement(options.hostTag ?? 'div');
  if (options.hostClass) host.className = options.hostClass;
  if (options.insertBefore?.parentElement === parent) {
    parent.insertBefore(host, options.insertBefore);
  } else if (options.insertAfter?.parentElement === parent) {
    parent.insertBefore(host, options.insertAfter.nextSibling);
  } else if (options.insertAt === 'start' && parent.firstChild) {
    parent.insertBefore(host, parent.firstChild);
  } else {
    parent.appendChild(host);
  }

  const shadow = host.attachShadow({ mode: 'open' });

  for (const css of options.styles ?? []) {
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    shadow.appendChild(styleEl);
  }

  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  const root: Root = createRoot(mountPoint);
  root.render(node);

  return {
    rerender(next) {
      root.render(next);
    },
    unmount() {
      root.unmount();
      host.remove();
    },
  };
}
