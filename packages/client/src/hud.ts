/** Thin wrapper over the HTML overlay in index.html. The scene pushes state in; buttons emit toggles out. */

export const el = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from index.html`);
  return node as T;
};

export interface CellReadout {
  cell: number;
  x: number;
  y: number;
  status: string;
  exit?: string;
  /** A monster group standing there. */
  group?: string;
}

export const hud = {
  setMap(name: string, region: string, worldX: number, worldY: number) {
    el('map-name').textContent = name;
    el('map-region').textContent = region;
    el('map-coords').textContent = `[${worldX}, ${worldY}]`;
  },

  setCell(r: CellReadout | null) {
    const box = el('cell-info');
    if (!r) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    el('cell-id').textContent = String(r.cell);
    el('cell-grid').textContent = `${r.x}, ${r.y}`;
    el('cell-status').textContent = r.status;
    const exit = el('cell-exit');
    exit.hidden = !r.exit;
    exit.textContent = r.exit ?? '';
    const group = el('cell-group');
    group.hidden = !r.group;
    group.textContent = r.group ?? '';
  },

  setToggle(id: 'btn-debug' | 'btn-range', on: boolean) {
    el(id).setAttribute('aria-pressed', String(on));
  },

  /** Sets what a button does. Scenes restart, so this replaces the previous handler rather than adding one. */
  onToggle(id: 'btn-debug' | 'btn-range', handler: () => void) {
    onClick(id, handler);
  },

  /** The tile readout belongs to exploring: hidden as a fight starts. The map tools stay on the bar. */
  showExplore(on: boolean) {
    if (!on) el('cell-info').hidden = true;
    for (const id of ['btn-range', 'btn-debug']) el(id).hidden = !on;
  },
};

const handlers = new Map<string, () => void>();

/** Routes a button's clicks to the latest handler set for it; the DOM listener is added once. */
export function onClick(id: string, handler: () => void): void {
  if (!handlers.has(id)) {
    el(id).addEventListener('click', (e) => {
      e.preventDefault();
      handlers.get(id)?.();
    });
  }
  handlers.set(id, handler);
}
