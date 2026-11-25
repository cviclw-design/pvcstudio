import { Window } from 'happy-dom';

let initialized = false;
let happyWindow: Window | null = null;

export function setupTestDom(): Window {
  if (!initialized || !happyWindow) {
    happyWindow = new Window({ url: 'http://localhost:3000/' });
    const win = happyWindow as unknown as Record<string, unknown>;
    const g = globalThis as unknown as Record<string, unknown>;

    g.window = happyWindow;
    g.document = happyWindow.document;
    Object.defineProperty(globalThis, 'navigator', {
      value: happyWindow.navigator,
      configurable: true,
      writable: true,
    });
    g.localStorage = happyWindow.localStorage;
    g.sessionStorage = happyWindow.sessionStorage;
    g.HTMLElement = win.HTMLElement;
    g.HTMLInputElement = win.HTMLInputElement;
    g.HTMLSelectElement = win.HTMLSelectElement;
    g.HTMLTextAreaElement = win.HTMLTextAreaElement;
    g.HTMLButtonElement = win.HTMLButtonElement;
    g.Element = win.Element;
    g.Node = win.Node;
    g.Event = win.Event;
    g.MouseEvent = win.MouseEvent;
    g.KeyboardEvent = win.KeyboardEvent;
    g.CustomEvent = win.CustomEvent;
    g.MutationObserver = win.MutationObserver;
    g.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
    g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0);
    g.cancelAnimationFrame = (id: number) => clearTimeout(id);

    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = () => 'blob:mock-url';
      URL.revokeObjectURL = () => {};
    }

    initialized = true;
  }

  happyWindow.localStorage.clear();
  happyWindow.history.replaceState({}, '', '/');
  return happyWindow;
}

// Auto-initialize immediately so ESM imports of @testing-library/react see global document
setupTestDom();
