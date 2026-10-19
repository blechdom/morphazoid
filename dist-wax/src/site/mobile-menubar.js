/** Presentation only: the original controls, events and audio owners stay intact. */
export const MOBILE_MENUBAR_QUERY = '(max-width: 720px), (max-width: 960px) and (max-height: 560px) and (orientation: landscape)';
const installations = new WeakMap();
const LABEL_CLASSES = ['has-mobile-wordmark-text', 'has-mobile-picker-text'];
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
    let outputGroup = null;
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
    const fitLabels = () => {
      header.classList.remove(...LABEL_CLASSES);
      if (disposed || !media.matches || !header.classList.contains('has-mobile-menubar') || !runtime.getComputedStyle) return;
      // Try real, unshrunk labels against the current controls and safe-area
      // padding. No clones, viewport guesses, or per-frame/meter measurements.
      const box = header.getBoundingClientRect();
      const style = runtime.getComputedStyle(header);
      const left = box.left + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0);
      const right = box.right - (parseFloat(style.paddingRight) || 0) - (parseFloat(style.borderRightWidth) || 0);
      const controls = [...header.querySelectorAll(`${CORE}, .header-io-controls`)]
        .filter(node => !node.closest('.header-settings-panel, .instrument-picker-panel'));
      const fits = () => controls.every(node => {
        const rect = node.getBoundingClientRect();
        return !rect.width || (rect.left >= left - .1 && rect.right <= right + .1);
      });
      // Prefer the wordmark, then use any remaining space for the selector's
      // existing label. A short selector can still fit when the name cannot.
      for (const name of LABEL_CLASSES) {
        header.classList.add(name);
        if (!fits()) header.classList.remove(name);
      }
    };
    const bounds = () => {
      if (!media.matches || disposed) return;
      const viewport = runtime.visualViewport;
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? runtime.innerHeight) - 8;
      const top = Math.max(viewport?.offsetTop ?? 0, Math.min(header.getBoundingClientRect().bottom + 4, bottom));
      header.style.setProperty('--mobile-menubar-panel-top', `${top}px`);
      header.style.setProperty('--mobile-menubar-panel-height', `${Math.max(0, bottom - top)}px`);
    };
    const layout = () => { fitLabels(); bounds(); };
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
      const nextOutputGroup = header.querySelector('.header-io-controls');
      if (nextOutputGroup !== outputGroup) {
        if (outputGroup) resize?.unobserve(outputGroup);
        outputGroup = nextOutputGroup;
        if (outputGroup) resize?.observe(outputGroup);
      }
      const section = header.querySelector('[data-mobile-menubar-extras]');
      if (section) section.hidden = !section.lastElementChild.childElementCount;
      layout();
    };
    const observer = new runtime.MutationObserver(records => {
      // Meter text, MIDI lights and picker results are not layout structure.
      // Never run a header traversal for every audio-meter update.
      if (records.some(record => {
        if (!header.classList.contains('has-mobile-menubar')) return [...record.addedNodes].some(node => node.nodeType === 1);
        if (record.target.closest?.('.mobile-menubar-extra-controls')) {
          return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1);
        }
        if (record.target.closest?.('.wordmark, .tabs .instrument-picker-current')) return true;
        if (record.target.closest?.(CORE)) return record.target === header;
        return [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1);
      })) reconcile();
    });
    observer.observe(header, { childList: true, subtree: true });
    const resize = runtime.ResizeObserver ? new runtime.ResizeObserver(layout) : null;
    resize?.observe(header);
    media.addEventListener('change', reconcile);
    runtime.visualViewport?.addEventListener('resize', layout);
    runtime.visualViewport?.addEventListener('scroll', bounds);
    runtime.addEventListener('resize', layout);
    doc.fonts?.addEventListener('loadingdone', layout);
    doc.fonts?.ready.then(() => { if (!disposed) layout(); });
    reconcile();
    removers.push(() => {
      disposed = true; observer.disconnect(); resize?.disconnect();
      media.removeEventListener('change', reconcile);
      runtime.visualViewport?.removeEventListener('resize', layout);
      runtime.visualViewport?.removeEventListener('scroll', bounds);
      runtime.removeEventListener('resize', layout);
      doc.fonts?.removeEventListener('loadingdone', layout);
      restore(); addedBrand?.remove(); header.classList.remove('has-mobile-menubar', ...LABEL_CLASSES);
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
