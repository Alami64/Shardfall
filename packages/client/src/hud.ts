/** Thin wrapper over the HTML overlay in index.html. The scene pushes state in; buttons emit toggles out. */

const el = <T extends HTMLElement>(id: string) => {
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
  },

  setToggle(id: 'btn-debug' | 'btn-range', on: boolean) {
    el(id).setAttribute('aria-pressed', String(on));
  },

  onToggle(id: 'btn-debug' | 'btn-range', handler: () => void) {
    el(id).addEventListener('click', (e) => {
      e.preventDefault();
      handler();
    });
  },
};
