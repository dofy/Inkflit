import { app, $ } from './app.js';

const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const duration = 280;
const travel = 'cubic-bezier(.24,.72,.26,1)';
const settle = 'ease-in-out';
let activeSlide;

export function cancelPageSlide() { activeSlide?.(); }
reducedMotion?.addEventListener('change', event => { if (event.matches) cancelPageSlide(); });

export function replaceNotePage(direction, replace) {
  cancelPageSlide();
  if (!direction || !app.editor || reducedMotion?.matches) { replace(); return; }

  // The departing page is a visual copy. Only the new CodeMirror view receives input.
  const page = $('note-page');
  const { scrollLeft, scrollTop } = app.editor.scrollDOM;
  const outgoing = page.cloneNode(true);
  outgoing.classList.add('note-page-outgoing');
  outgoing.inert = true;
  outgoing.setAttribute('aria-hidden', 'true');
  outgoing.removeAttribute('id');
  for (const element of outgoing.querySelectorAll('[id]')) element.removeAttribute('id');

  replace();
  page.after(outgoing);
  outgoing.querySelector('.cm-scroller').scrollTo(scrollLeft, scrollTop);

  const options = { duration, fill: 'both' };
  const leaving = { transform: `translateX(${-direction * 100}%)` };
  const exit = outgoing.animate([
    { transform: 'translateX(0)', easing: travel },
    { ...leaving, offset: .72 },
    leaving,
  ], options);
  const enter = page.animate([
    { transform: `translateX(${direction * 100}%)`, easing: travel },
    { transform: `translateX(${-direction * 6}px)`, offset: .72, easing: settle },
    { transform: `translateX(${direction * 2}px)`, offset: .88, easing: settle },
    { transform: 'translateX(0)' },
  ], options);

  const cleanUp = () => {
    if (activeSlide !== cleanUp) return;
    activeSlide = null;
    enter.cancel();
    exit.cancel();
    outgoing.remove();
  };
  activeSlide = cleanUp;
  enter.onfinish = cleanUp;
}
