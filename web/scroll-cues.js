import { ViewPlugin } from '@codemirror/view';

function makeCue(document, edge) {
  const cue = document.createElement('span');
  cue.className = `note-scroll-cue note-scroll-${edge}`;
  cue.hidden = true;
  return cue;
}

export const noteScrollCues = ViewPlugin.fromClass(class {
  constructor(view) {
    const document = view.dom.ownerDocument;
    const viewport = view.dom.closest('main') ?? view.dom;
    this.overlay = document.createElement('div');
    this.overlay.className = 'note-scroll-cues';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.above = makeCue(document, 'above');
    this.below = makeCue(document, 'below');
    this.overlay.append(this.above, this.below);
    viewport.append(this.overlay);
    this.measure = {
      key: this,
      read(view) {
        const { scrollHeight, scrollTop, clientHeight } = view.scrollDOM;
        const padding = view.documentPadding;
        const bounds = viewport.getBoundingClientRect();
        const scrollBounds = view.scrollDOM.getBoundingClientRect();
        // Padding on its own can scroll after the last line is already visible.
        return {
          above: scrollTop > padding.top + 1,
          below: scrollHeight - clientHeight - Math.max(0, scrollTop) > padding.bottom + 1,
          top: scrollBounds.top - bounds.top,
          bottom: bounds.bottom - scrollBounds.bottom,
        };
      },
      write: ({ above, below, top, bottom }) => {
        this.above.hidden = !above;
        this.below.hidden = !below;
        this.overlay.style.top = `${top}px`;
        this.overlay.style.bottom = `${bottom}px`;
      },
    };
    this.resizeObserver = new ResizeObserver(() => this.measure.write(this.measure.read(view)));
    this.resizeObserver.observe(view.scrollDOM);
    view.requestMeasure(this.measure);
  }
  update(update) {
    if (update.geometryChanged || update.viewportChanged) update.view.requestMeasure(this.measure);
  }
  destroy() {
    this.resizeObserver.disconnect();
    this.overlay.remove();
  }
}, {
  eventObservers: { scroll(_, view) { view.requestMeasure(this.measure); } },
});
