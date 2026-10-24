/**
 * Плавная прокрутка колесом мыши. Обычное колесо листает рывками на ~100 px;
 * здесь шаг тот же, но движение растянуто и сглажено. Трекпад, сенсорный экран и
 * горизонтальная прокрутка не затрагиваются — их браузер и так делает плавно.
 */

const STEP = 0.85; // доля стандартного шага колеса
const EASE = 0.14; // чем меньше, тем мягче и дольше доезжает

interface Run {
  target: number;
  raf: number;
}

const runs = new WeakMap<Element, Run>();

function canScroll(el: Element, dy: number): boolean {
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 1) return false;
  return dy > 0 ? el.scrollTop < max - 1 : el.scrollTop > 1;
}

function scrollableAncestor(start: EventTarget | null, dy: number): Element | null {
  let el = start instanceof Element ? start : null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.hasAttribute('data-native-scroll')) return null; // колёса выбора листаются самим браузером с «прилипанием»
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && canScroll(el, dy)) return el;
    el = el.parentElement;
  }
  const root = document.scrollingElement;
  return root && canScroll(root, dy) && getComputedStyle(document.body).overflow !== 'hidden' ? root : null;
}

function isMouseWheel(e: WheelEvent): boolean {
  if (e.deltaMode !== 0) return true; // строки/страницы — это колесо
  return e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
}

function animate(el: Element, run: Run) {
  const tick = () => {
    const diff = run.target - el.scrollTop;
    if (Math.abs(diff) < 0.5) {
      el.scrollTop = run.target;
      runs.delete(el);
      return;
    }
    // scrollTop целочисленный: шаг меньше пикселя терялся, и прокрутка не доезжала до цели
    const step = diff * EASE;
    el.scrollTop += Math.abs(step) < 1 ? Math.sign(diff) * Math.min(1, Math.abs(diff)) : step;
    run.raf = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(run.raf);
  run.raf = requestAnimationFrame(tick);
}

function onWheel(e: WheelEvent) {
  if (e.defaultPrevented || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || !isMouseWheel(e)) return;

  const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
  const el = scrollableAncestor(e.target, dy);
  if (!el) return;

  e.preventDefault();
  const max = el.scrollHeight - el.clientHeight;
  const run = runs.get(el) ?? { target: el.scrollTop, raf: 0 };
  run.target = Math.max(0, Math.min(max, run.target + dy * STEP));
  runs.set(el, run);
  animate(el, run);
}

/**
 * Плавная прокрутка колесом для одного списка, даже если в системе отключены анимации:
 * без неё колесо перескакивает на целый шаг, и список листается рывками.
 */
export function smoothScrollList(el: HTMLElement): () => void {
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    el.removeEventListener('wheel', onWheel);
    const run = runs.get(el);
    if (run) cancelAnimationFrame(run.raf);
    runs.delete(el);
  };
}

/** Включает плавную прокрутку на всём сайте. Возвращает функцию отключения. */
export function installSmoothWheel(): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  document.addEventListener('wheel', onWheel, { passive: false });
  return () => document.removeEventListener('wheel', onWheel);
}
