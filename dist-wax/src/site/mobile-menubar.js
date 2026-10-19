/** Presentation only: the original controls, events and audio owners stay intact. */
export const MOBILE_MENUBAR_QUERY = '(max-width: 720px), (max-width: 960px) and (max-height: 560px) and (orientation: landscape)';
const installations = new WeakMap();
const CORE = '.wordmark, .tabs, .mobile-instrument-nav, .header-settings-menu, .header-output-meter-shell, .output-recording-control, .header-level, .audio-button, .audio-toggle';

export function mobileMenubarSettingsHost(header) {
  const panel = header?.querySelector('.header-settings-panel');
  if (!panel) return null;
  let section = panel.querySelector('[data-mobile-menubar-extras]');
  if (!section) {
    const doc = header.ownerDocument;
    section = doc.createElement('section');
    section.className = 'header-settings-section mobile-menubar-extras';
    section.setAttribute('data-mobile-menubar-extras', '');
    const title = doc.createElement('h2');
    title.className = 'header-settings-section-title';
    title.textContent = 'Instrument controls';
    const host = doc.createElement('div');
    host.className = 'mobile-menubar-extra-controls';
    section.append(title, host);
    panel.prepend(section);
  }
  section.hidden = false;
  return section.lastElementChild;
}

function moveControl(node, parent, before = null) {
  if (node.parentNode === parent && node.nextSibling === before) return;
  const focus = node.contains(node.ownerDocument.activeElement) ? node.ownerDocument.activeElement : null;
  // Keeping focus may require revealing its new Settings home after rotation.
  if (focus) {
    const details = parent.closest('details.header-settings-menu');
    if (details) details.open = true;
  }
  if (parent.moveBefore && node.isConnected && parent.isConnected) parent.moveBefore(node, before);
  else parent.insertBefore(node, before);
  focus?.focus({ preventScroll: true });
}

export function initializeMobileMenubars(doc = globalThis.document, runtime = globalThis) {
  if (!doc?.querySelectorAll || !runtime.matchMedia || !runtime.MutationObserver) return null;
  if (installations.has(doc)) return installations.get(doc);
  const media = runtime.matchMedia(MOBILE_MENUBAR_QUERY);
  const removers = [];
  for (const header of doc.querySelectorAll('.masthead')) {
    const moved = new Map();
    const wrappers = new Set();
    let addedBrand = null;
    let disposed = false;
    const restore = () => {
      for (const [node, marker] of moved) {
        // An instrument may remove or relocate a control during its own teardown.
        // Do not resurrect it or override its new owner when returning to desktop.
        if (marker.isConnected && node.parentElement?.matches('.mobile-menubar-extra-controls')) {
          moveControl(node, marker.parentNode, marker);
        }
        marker.remove();
      }
      moved.clear();
      for (const wrapper of wrappers) wrapper.classList.remove('mobile-menubar-contents');
      wrappers.clear();
    };
    const bounds = () => {
      if (!media.matches || disposed) return;
      const viewport = runtime.visualViewport;
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? runtime.innerHeight) - 8;
      const top = Math.max(viewport?.offsetTop ?? 0, Math.min(header.getBoundingClientRect().bottom + 4, bottom));
      header.style.setProperty('--mobile-menubar-panel-top', `${top}px`);
      header.style.setProperty('--mobile-menubar-panel-height', `${Math.max(0, bottom - top)}px`);
    };
    const reconcile = () => {
      if (disposed) return;
      // Pages with their own navigation are inventoried, not silently rewritten.
      if (!header.querySelector('.tabs .instrument-picker')) return;
      header.classList.add('has-mobile-menubar');
      const wordmark = header.querySelector('.wordmark');
      if (wordmark && !wordmark.querySelector('.brand-mark')) {
        addedBrand = doc.createElement('span');
        addedBrand.className = 'brand-mark mobile-menubar-brand';
        addedBrand.setAttribute('aria-hidden', 'true');
        wordmark.append(addedBrand);
      }
      if (!media.matches) restore();
      else {
        // Some instruments fill an initially empty output host asynchronously.
        // A former extra that acquires core controls must return to the bar.
        for (const [node, marker] of moved) {
          if (node.isConnected && marker.isConnected && (node.matches(CORE) || node.querySelector(CORE))) {
            moveControl(node, marker.parentNode, marker);
            marker.remove(); moved.delete(node);
          }
        }
        const panel = header.querySelector('.header-settings-panel');
        const visit = parent => {
          for (const node of [...parent.children]) {
            if (node.matches(CORE)) continue;
            // Output hosts can be empty or replaced before their engine mounts.
            if (node.matches('.header-io-controls, .audio-strip, .header-actions, #audioHost') || node.querySelector(CORE)) {
              if (!node.matches('.header-io-controls')) {
                node.classList.add('mobile-menubar-contents'); wrappers.add(node);
              }
              visit(node);
            } else if (panel && !node.matches('[data-mobile-menubar-extras]')) {
              const marker = doc.createComment('mobile menubar control');
              parent.insertBefore(marker, node);
              moved.set(node, marker);
              moveControl(node, mobileMenubarSettingsHost(header));
            }
          }
        };
        visit(header);
      }
      const section = header.querySelector('[data-mobile-menubar-extras]');
      if (section) section.hidden = !section.lastElementChild.childElementCount;
      bounds();
    };
    const observer = new runtime.MutationObserver(records => {
      // Meter text, MIDI lights and picker results are not layout structure.
      // Never run a header traversal for every audio-meter update.
      if (records.some(record => {
        if (!header.classList.contains('has-mobile-menubar')) return [...record.addedNodes].some(node => node.nodeType === 1);
        if (record.target.closest?.('.mobile-menubar-extra-controls')) {
          return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1);
        }
        if (record.target.closest?.(CORE)) return record.target === header;
        return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1);
      })) reconcile();
    });
    observer.observe(header, { childList: true, subtree: true });
    const resize = runtime.ResizeObserver ? new runtime.ResizeObserver(bounds) : null;
    resize?.observe(header);
    media.addEventListener('change', reconcile);
    runtime.visualViewport?.addEventListener('resize', bounds);
    runtime.visualViewport?.addEventListener('scroll', bounds);
    runtime.addEventListener('resize', bounds);
    reconcile();
    removers.push(() => {
      disposed = true; observer.disconnect(); resize?.disconnect();
      media.removeEventListener('change', reconcile);
      runtime.visualViewport?.removeEventListener('resize', bounds);
      runtime.visualViewport?.removeEventListener('scroll', bounds);
      runtime.removeEventListener('resize', bounds);
      restore(); addedBrand?.remove(); header.classList.remove('has-mobile-menubar');
      header.style.removeProperty('--mobile-menubar-panel-top');
      header.style.removeProperty('--mobile-menubar-panel-height');
    });
  }
  const pagehide = event => { if (!event.persisted) controller.destroy(); };
  const controller = { destroy() {
    for (const remove of removers.splice(0)) remove();
    runtime.removeEventListener('pagehide', pagehide);
    installations.delete(doc);
  } };
  runtime.addEventListener('pagehide', pagehide);
  installations.set(doc, controller);
  return controller;
}
