// Drag-to-reorder for a vertical list, by a grip handle. Touch and mouse (pointer events), no library.
//
//   makeDragSortable(container, { itemSel, handleSel, onDone })
//     container   the element holding the rows
//     itemSel     selector for a row (each row carries data-key)
//     handleSel   selector for the grip inside a row - only dragging the grip moves a row, so scrolling the
//                 list and tapping a row still work as usual
//     onDone(keys) called once on release, with every row's data-key in the new order (not called if unmoved)
//
// The row follows the finger; the rows around it slide out of the way by swapping places in the DOM as the
// pointer crosses their middle. Nothing here knows what the rows are.
export function makeDragSortable(container, { itemSel, handleSel, onDone }) {
  const rows = () => [...container.querySelectorAll(itemSel)];
  container.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest(handleSel);
    if (!grip || !container.contains(grip)) return;
    const row = grip.closest(itemSel);
    if (!row) return;
    e.preventDefault();
    const before = rows().map((r) => r.dataset.key);
    const startY = e.clientY;
    let moved = 0, adj = 0;   // adj: what the row's own jumps in the DOM have already moved it by
    row.classList.add('is-dragging');
    try { grip.setPointerCapture(e.pointerId); } catch (_) { /* older browsers: window listeners below still work */ }

    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      moved = Math.max(moved, Math.abs(dy));
      row.style.transform = 'translateY(' + (dy + adj) + 'px)';
      const mine = row.getBoundingClientRect();
      const mid = mine.top + mine.height / 2;
      for (const other of rows()) {
        if (other === row) continue;
        const r = other.getBoundingClientRect();
        const passedDown = other.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING && mid > r.top + r.height / 2;
        const passedUp = other.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING && mid < r.top + r.height / 2;
        if (passedDown || passedUp) {
          // Move the row in the DOM, then take the jump out of the transform so it stays under the finger.
          const before1 = row.getBoundingClientRect().top;
          if (passedDown) other.after(row); else other.before(row);
          const shift = row.getBoundingClientRect().top - before1;
          adj -= shift;
          row.style.transform = 'translateY(' + (dy + adj) + 'px)';
          break;
        }
      }
    };
    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      row.classList.remove('is-dragging');
      row.style.transform = '';
      const after = rows().map((r) => r.dataset.key);
      if (moved > 3 && after.join('|') !== before.join('|') && onDone) onDone(after);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });
}

// The grip itself - three-line handle, sized for a thumb.
export function gripHandle(cls = '') {
  const b = document.createElement('span');
  b.className = 'drag-grip ' + cls;
  b.setAttribute('role', 'img');
  b.setAttribute('aria-label', 'Drag to reorder');
  b.title = 'Drag to reorder';
  b.textContent = '≡'; // ≡
  return b;
}
