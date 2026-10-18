import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {}
};

const { ComicReader } = await import('../public/reader.js');

class FakeClassList {
  constructor(...names) {
    this.names = new Set(names);
  }

  add(...names) {
    names.forEach((name) => this.names.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.names.delete(name));
  }

  contains(name) {
    return this.names.has(name);
  }

  toggle(name, force) {
    if (force) this.names.add(name);
    else this.names.delete(name);
  }
}

function makePeekPressSubject() {
  return {
    root: { classList: new FakeClassList() },
    viewport: {
      hasPointerCapture: () => false,
      releasePointerCapture: () => {}
    },
    cursorTimer: 0,
    peekPressPointerId: null,
    peekTransitionStage: null,
    peekAnimationFrame: 0,
    peekAnimationResolve: null,
    peekRadius: 112,
    peekRadiusCurrent: 196,
    peekRadiusTarget: 196,
    peekDuration: (duration) => duration,
    updatePeekMask() {},
    animatePeekRadius(target) {
      this.animatedRadius = target;
    }
  };
}

test('Peek press hides the cursor across the reader and restores its radius on release', () => {
  const subject = makePeekPressSubject();

  ComicReader.prototype.beginPeekPress.call(subject, 7);
  assert.equal(subject.peekPressPointerId, 7);
  assert.equal(subject.root.classList.contains('is-peek-pressing'), true);
  assert.equal(subject.root.classList.contains('is-cursor-hidden'), true);

  const ended = ComicReader.prototype.endPeekPress.call(subject, { animateRadius: true });
  assert.equal(ended, true);
  assert.equal(subject.peekPressPointerId, null);
  assert.equal(subject.root.classList.contains('is-peek-pressing'), false);
  assert.equal(subject.animatedRadius, 112);
});

test('programmatic Peek cleanup releases capture and immediately restores its radius', () => {
  const subject = makePeekPressSubject();
  const released = [];
  subject.peekPressPointerId = 9;
  subject.root.classList.add('is-peek-pressing');
  subject.viewport.hasPointerCapture = () => true;
  subject.viewport.releasePointerCapture = (pointerId) => released.push(pointerId);
  subject.peekAnimationResolve = () => { subject.animationResolved = true; };

  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = (frame) => { subject.cancelledFrame = frame; };
  try {
    ComicReader.prototype.endPeekPress.call(subject, { releaseCapture: true });
  } finally {
    if (previousCancelAnimationFrame) globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
    else delete globalThis.cancelAnimationFrame;
  }

  assert.deepEqual(released, [9]);
  assert.equal(subject.peekRadiusCurrent, 112);
  assert.equal(subject.peekRadiusTarget, 112);
  assert.equal(subject.animationResolved, true);
  assert.equal(subject.root.classList.contains('is-peek-pressing'), false);
});

test('pointer cancellation and lost capture request a smooth Peek radius restore', () => {
  const subject = makePeekPressSubject();
  const calls = [];
  subject.peekPressPointerId = 11;
  subject.endPeekPress = (options) => calls.push(options);

  ComicReader.prototype.onPointerUp.call(subject, { pointerId: 11 }, true);
  assert.deepEqual(calls, [{ animateRadius: true }]);

  calls.length = 0;
  subject.peekPressPointerId = 12;
  subject.pageTurnPointer = null;
  subject.drag = null;
  ComicReader.prototype.onLostPointerCapture.call(subject, { pointerId: 12 });
  assert.deepEqual(calls, [{ animateRadius: true }]);
});

test('active Peek press wins over fullscreen chrome and page-zone cursor activity', () => {
  const subject = makePeekPressSubject();
  subject.peekPressPointerId = 3;
  subject.fullscreenEdgeActive = true;
  subject.pageZoneDirection = 1;
  subject.isOpen = () => true;
  subject.isPeekInteractive = () => true;

  ComicReader.prototype.notePointerActivity.call(subject);

  assert.equal(subject.root.classList.contains('is-cursor-hidden'), true);
});

test('reader close delegates to the source page before closing the overlay', () => {
  let closed = false;
  const delegated = {
    onClose: () => true,
    close: () => { closed = true; }
  };
  ComicReader.prototype.requestClose.call(delegated);
  assert.equal(closed, false);

  const local = {
    onClose: () => false,
    close: () => { closed = true; }
  };
  ComicReader.prototype.requestClose.call(local);
  assert.equal(closed, true);
});

test('touch taps page inside the image, but releasing a two-finger Peek never pages', () => {
  const directions = [];
  const subject = {
    touchGesture: { pointerId: 4, x: 300, y: 420 },
    touchPoints: new Map([[4, { x: 300, y: 420 }]]),
    viewport: { getBoundingClientRect: () => ({ left: 0, width: 360 }) },
    animatePeekRadius: () => {},
    peekDuration: (value) => value,
    peekPressPointerId: null,
    pageTurnPointer: null,
    drag: null,
    peekTransitionStage: null,
    root: { classList: new FakeClassList() },
    stepPage: (direction) => directions.push(direction)
  };

  ComicReader.prototype.onPointerUp.call(subject, { pointerType: 'touch', pointerId: 4, clientX: 301, clientY: 425 });

  assert.deepEqual(directions, [1]);
  assert.equal(subject.touchGesture, null);
  subject.touchPeek = true;
  subject.touchPoints.set(5, { x: 40, y: 420 });
  ComicReader.prototype.onPointerUp.call(subject, { pointerType: 'touch', pointerId: 5, clientX: 40, clientY: 420 });
  assert.deepEqual(directions, [1]);
});

test('two touch points determine Peek center and diameter', () => {
  let radius;
  const subject = {
    peekEnabled: true,
    touchPoints: new Map([[1, { x: 40, y: 100 }], [2, { x: 160, y: 100 }]]),
    touchPeekStartDistance: 0,
    touchPeekSpread: false,
    toViewportPoint: (x, y) => ({ x, y }),
    setPeekRadius: (value) => { radius = value; }
  };
  ComicReader.prototype.updateTouchPeek.call(subject);
  assert.deepEqual(subject.pointer, { x: 100, y: 100 });
  assert.equal(radius, 60);
});

test('spreading two fingers while peeking commits like the middle button', () => {
  const calls = [];
  let radius = 0;
  const subject = {
    peekEnabled: true,
    touchPoints: new Map([[1, { x: 0, y: 0 }], [2, { x: 100, y: 0 }]]),
    touchPeekStartDistance: 100,
    touchPeekSpread: false,
    touchPeek: true,
    toViewportPoint: (x, y) => ({ x, y }),
    setPeekRadius: (value) => { radius = value; },
    cycleVariant: () => calls.push('cycle')
  };

  ComicReader.prototype.updateTouchPeek.call(subject);
  assert.deepEqual(calls, []);
  assert.equal(radius, 50);

  // Beyond 2x (and +96px) the gesture commits once.
  subject.touchPoints.set(2, { x: 400, y: 0 });
  ComicReader.prototype.updateTouchPeek.call(subject);
  assert.deepEqual(calls, ['cycle']);
  assert.equal(subject.touchPeek, false);
  assert.equal(subject.touchPeekSpread, true);

  // Further moves of the same gesture must not re-trigger.
  subject.touchPoints.set(2, { x: 460, y: 0 });
  ComicReader.prototype.updateTouchPeek.call(subject);
  assert.deepEqual(calls, ['cycle']);
});

test('two-finger pinch zooms only when Peek is disabled', () => {
  const zoomCalls = [];
  const subject = {
    peekEnabled: false,
    touchPoints: new Map([[1, { x: 0, y: 0 }], [2, { x: 100, y: 0 }]]),
    touchPinch: { distance: 100, x: 50, y: 0 },
    touchPinchState: ComicReader.prototype.touchPinchState,
    updateTouchPinch: ComicReader.prototype.updateTouchPinch,
    zoomAt: (factor, x, y) => zoomCalls.push([factor, x, y])
  };

  subject.touchPoints.set(2, { x: 200, y: 0 });
  ComicReader.prototype.updateTouchPinch.call(subject);
  assert.equal(zoomCalls.length, 1);
  assert.ok(Math.abs(zoomCalls[0][0] - 2) < 1e-9);
  assert.deepEqual(zoomCalls[0].slice(1), [100, 0]);

  // With Peek on, two fingers reveal Peek instead of zooming.
  subject.peekEnabled = true;
  ComicReader.prototype.updateTouchPinch.call(subject);
  assert.equal(zoomCalls.length, 1);
});

test('snapToNearest recentres free scrolls but skips already-centred pages', () => {
  const calls = [];
  const subject = {
    isContinuous: () => false,
    layout: { horizontal: true },
    pages: [{}, {}, {}],
    zoom: 1,
    scroll: { scrollLeft: 50, scrollTop: 0 },
    indexAtViewportCenter: () => 1,
    pageCenterOffset: () => 200,
    suppressSnapUntil: 0,
    scrollToIndex: (index, smooth) => calls.push([index, smooth])
  };

  ComicReader.prototype.snapToNearest.call(subject);
  assert.deepEqual(calls, [[1, true]]);

  calls.length = 0;
  subject.scroll.scrollLeft = 200.4;
  ComicReader.prototype.snapToNearest.call(subject);
  assert.deepEqual(calls, []);

  // A zoom in flight suppresses snapping (its scroll move is intentional).
  subject.suppressSnapUntil = performance.now() + 1000;
  subject.scroll.scrollLeft = 50;
  ComicReader.prototype.snapToNearest.call(subject);
  assert.deepEqual(calls, []);
});

function makeMaskSubject() {
  return {
    peekPlane: { style: makeStyle() },
    peekTransitionStage: null,
    peekEnabled: true,
    currentPeekEntry: () => ({ page: 1 }),
    pointer: { x: 100, y: 80 },
    peekRadiusCurrent: 160,
    peekRadius: 112,
    peekFeather: 24,
    peekOpacity: 100,
    peekPressPointerId: null,
    peekForceOpaque: false,
    // A non-trivial camera, to prove the mask ignores it.
    transform: { x: -9999, y: -8888, scale: 4 }
  };
}

function makeStyle() {
  const values = {};
  return {
    values,
    opacity: '',
    setProperty(name, value) { values[name] = value; },
    getPropertyValue(name) { return values[name] ?? ''; },
    removeProperty(name) { delete values[name]; }
  };
}

test('Peek mask variables are expressed in viewport coordinates and ignore the camera', () => {
  const subject = makeMaskSubject();
  ComicReader.prototype.updatePeekMask.call(subject);
  const style = subject.peekPlane.style;
  assert.equal(style.opacity, '1');
  assert.equal(style.getPropertyValue('--peek-x'), '100px');
  assert.equal(style.getPropertyValue('--peek-y'), '80px');
  // radius/feather are used as-is (no division by the camera scale).
  assert.equal(style.getPropertyValue('--peek-radius'), '160px');
  assert.equal(style.getPropertyValue('--peek-feather'), '24px');
});

test('a configured Peek opacity is applied while hovering and restored to 100% while pressed', () => {
  const subject = makeMaskSubject();
  subject.peekOpacity = 40;
  ComicReader.prototype.updatePeekMask.call(subject);
  assert.equal(subject.peekPlane.style.opacity, '0.4');

  subject.peekPressPointerId = 7;
  ComicReader.prototype.updatePeekMask.call(subject);
  assert.equal(subject.peekPlane.style.opacity, '1');

  subject.peekPressPointerId = null;
  ComicReader.prototype.updatePeekMask.call(subject);
  assert.equal(subject.peekPlane.style.opacity, '0.4');

  // The middle-click transition forces the same full opacity for its duration.
  subject.peekForceOpaque = true;
  ComicReader.prototype.updatePeekMask.call(subject);
  assert.equal(subject.peekPlane.style.opacity, '1');
});

test('Peek mask collapses to opacity 0 when Peek is unavailable', () => {
  const subject = makeMaskSubject();
  subject.peekEnabled = false;
  ComicReader.prototype.updatePeekMask.call(subject);
  assert.equal(subject.peekPlane.style.opacity, '0');
});

function makeClassList(...names) {
  return {
    values: new Set(names),
    add(name) { this.values.add(name); },
    remove(...list) { list.forEach((name) => this.values.delete(name)); },
    contains(name) { return this.values.has(name); },
    toggle(name, force) {
      const on = force === undefined ? !this.values.has(name) : force;
      if (on) this.values.add(name); else this.values.delete(name);
    }
  };
}

test('remounting the Peek layer keeps the current page marked current', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ style: {}, dataset: {}, addEventListener() {} }) };
  try {
    const entry = { page: 1, variant: 'a', index: 0, file: { assetKey: 'a1' } };
    const peekTarget = { page: 1, variant: 'c', index: 0, file: { assetKey: 'c1' } };
    const makeSlot = (slotEntry) => ({
      entry: slotEntry,
      peekKey: 'b:1',
      type: 'page',
      peekElement: {
        classList: makeClassList('reader-peek-page'),
        style: {},
        firstElementChild: {},
        replaceChildren() {}
      }
    });
    const subject = {
      stripToken: 1,
      episodeId: 'ep',
      readingMode: 'single',
      pageAnimation: true,
      entry,
      pendingLoads: 0,
      queueDecode() {},
      settleLoad() {},
      shouldFadePageOnLoad: () => true,
      resolvePeekTarget: () => ({ entry: peekTarget })
    };

    const current = makeSlot(entry);
    ComicReader.prototype.mountPeek.call(subject, current);
    assert.equal(current.peekElement.classList.contains('is-current'), true);
    assert.equal(current.peekElement.classList.contains('reader-peek-page'), true);
    assert.equal(current.peekElement.classList.contains('reader-peek-span'), false);

    const neighbor = makeSlot({ page: 2, variant: 'a', index: 1, file: { assetKey: 'a2' } });
    ComicReader.prototype.mountPeek.call(subject, neighbor);
    assert.equal(neighbor.peekElement.classList.contains('is-current'), false);
  } finally {
    if (previousDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
  }
});

test('animatePeekRadius drives the radius and duration through CSS variables', async () => {
  const previousCancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const subject = {
      peekPlane: { style: makeStyle(), addEventListener() {}, removeEventListener() {}, getAnimations() { return []; } },
      peekAnimationFrame: 0,
      peekAnimationResolve: null,
      peekRadiusCurrent: 112,
      peekRadiusTarget: 112,
      peekRadius: 112,
      peekFeather: 14,
      peekOpacity: 100,
      peekTransitionStage: null,
      peekEnabled: true,
      pointer: { x: 10, y: 10 },
      peekPressPointerId: null,
      peekForceOpaque: false,
      currentPeekEntry: () => ({ page: 1 }),
      updatePeekMask() { ComicReader.prototype.updatePeekMask.call(this); },
      waitForPeekRadius() { return ComicReader.prototype.waitForPeekRadius.call(this); },
      nextPaint() { return Promise.resolve(); }
    };
    await ComicReader.prototype.animatePeekRadius.call(subject, 300, 200);
    assert.equal(subject.peekPlane.style.getPropertyValue('--peek-radius'), '300px');
    assert.equal(subject.peekPlane.style.getPropertyValue('--peek-radius-duration'), '200ms');
    assert.equal(subject.peekRadiusCurrent, 300);

    // An instant change (duration 0) does not wait for a transition.
    await ComicReader.prototype.animatePeekRadius.call(subject, 112, 0);
    assert.equal(subject.peekPlane.style.getPropertyValue('--peek-radius'), '112px');
    assert.equal(subject.peekPlane.style.getPropertyValue('--peek-radius-duration'), '0ms');
  } finally {
    if (previousCancel) globalThis.cancelAnimationFrame = previousCancel;
    else delete globalThis.cancelAnimationFrame;
  }
});

test('cancelling an in-flight Peek transition re-enables Peek', () => {
  const subject = {
    peekTransitionStage: 'expanding',
    peekForceOpaque: true,
    peekPlane: { style: { removed: false, removeProperty() { this.removed = true; } } },
    root: { classList: { removed: [], remove(...names) { this.removed.push(...names); } } },
    syncPeekInteractionState() { this.synced = true; },
    updatePeekMask() { this.masked = true; }
  };

  ComicReader.prototype.cancelPeekTransition.call(subject);

  assert.equal(subject.peekTransitionStage, null);
  assert.equal(subject.peekForceOpaque, false);
  assert.equal(subject.peekPlane.style.removed, true);
  assert.deepEqual(subject.root.classList.removed, ['is-peek-transitioning']);
  assert.equal(subject.synced, true);
  assert.equal(subject.masked, true);

  // Idempotent: a second cancel without a transition does nothing.
  ComicReader.prototype.cancelPeekTransition.call(subject);
  assert.equal(subject.synced, true);
});

function makeLayoutSubject(readingOrder = 'ltr') {
  return {
    readingOrder,
    pages: [
      { width: 100, height: 200 },
      { width: 100, height: 200 },
      { width: 100, height: 200 }
    ],
    transform: { x: 0, y: 0, scale: 1 },
    windowOrigin: null
  };
}

test('page layout accumulates offsets along the reading axis', () => {
  const horizontal = makeLayoutSubject('ltr');
  ComicReader.prototype.computeLayout.call(horizontal);
  assert.deepEqual(horizontal.layout.offsets, [0, 108, 216]);
  assert.deepEqual(horizontal.layout.sizes, [100, 100, 100]);
  assert.equal(horizontal.layout.dir, 1);
  assert.equal(horizontal.layout.horizontal, true);

  const rtl = makeLayoutSubject('rtl');
  ComicReader.prototype.computeLayout.call(rtl);
  assert.equal(rtl.layout.dir, -1);

  const ttb = makeLayoutSubject('ttb');
  ComicReader.prototype.computeLayout.call(ttb);
  assert.deepEqual(ttb.layout.offsets, [0, 208, 416]);
  assert.equal(ttb.layout.horizontal, false);
});

test('nearest-page lookup uses page centers, not DOM geometry', () => {
  const subject = makeLayoutSubject('ltr');
  ComicReader.prototype.computeLayout.call(subject);
  assert.equal(ComicReader.prototype.findNearestIndex.call(subject, 10), 0);
  assert.equal(ComicReader.prototype.findNearestIndex.call(subject, 150), 1);
  assert.equal(ComicReader.prototype.findNearestIndex.call(subject, 260), 2);
});

test('page slots are placed at content coordinates and mirror for RTL', () => {
  const ltr = makeLayoutSubject('ltr');
  ComicReader.prototype.computeLayout.call(ltr);
  ltr.contentCross = 260;
  assert.deepEqual(ComicReader.prototype.slotPosition.call(ltr, 0), { left: 0, top: 30 });
  assert.deepEqual(ComicReader.prototype.slotPosition.call(ltr, 2), { left: 216, top: 30 });

  const rtl = makeLayoutSubject('rtl');
  ComicReader.prototype.computeLayout.call(rtl);
  rtl.contentCross = 260;
  // RTL mirrors on the axis: last page is left-most, first page is right-most.
  assert.deepEqual(ComicReader.prototype.slotPosition.call(rtl, 0), { left: rtl.layout.total - 100, top: 30 });
  assert.deepEqual(ComicReader.prototype.slotPosition.call(rtl, 2), { left: 0, top: 30 });
});

test('single-mode page alpha is a function of the scroll position', () => {
  const makeSlot = (index) => ({
    index,
    width: 100,
    height: 200,
    element: { parentNode: {}, style: makeStyle() },
    peekElement: { parentNode: {}, style: makeStyle() }
  });
  const subject = {
    readingMode: 'single',
    layout: { horizontal: true, dir: 1, offsets: [0, 108, 216], sizes: [100, 100, 100], total: 316 },
    zoom: 1,
    scroll: { scrollLeft: 50, clientWidth: 100 },
    mountedRange: [0, 3],
    pages: [makeSlot(0), makeSlot(1), makeSlot(2)],
    setPageAlpha: ComicReader.prototype.setPageAlpha,
    clearPageAlpha: ComicReader.prototype.clearPageAlpha,
    visibleRange() { return [0, 3]; }
  };

  ComicReader.prototype.applyScrollOpacity.call(subject);
  assert.equal(subject.pages[0].alpha, 1);
  assert.equal(subject.pages[1].alpha, 0);
  assert.equal(subject.pages[0].element.style.getPropertyValue('--reader-page-alpha'), '1');

  // Halfway between page 0 (centre 50) and page 1 (centre 158): both cross-fade.
  subject.scroll.scrollLeft = 104;
  ComicReader.prototype.applyScrollOpacity.call(subject);
  assert.equal(subject.pages[0].alpha, 0.5);
  assert.equal(subject.pages[1].alpha, 0.5);

  // Continuous/other modes clear the variable so tiles stay fully opaque.
  subject.readingMode = 'continuous';
  ComicReader.prototype.applyScrollOpacity.call(subject);
  assert.equal(subject.pages[0].element.style.getPropertyValue('--reader-page-alpha'), '');
});

test('zoomTo keeps the point under the cursor fixed on both axes', () => {
  const scroll = { scrollLeft: 100, scrollTop: 30, clientWidth: 500, clientHeight: 400 };
  const subject = {
    zoom: 1,
    readingOrder: 'ltr',
    scroll,
    contentCross: 400,
    viewport: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 400 }) },
    crossPadFor: ComicReader.prototype.crossPadFor,
    applyViewTransform() {},
    markZooming() { this.marked = true; },
    refreshWindow() {},
    updateCurrentFromScroll() {}
  };

  ComicReader.prototype.zoomTo.call(subject, 2, 100, 150);
  assert.equal(subject.zoom, 2);
  assert.equal(scroll.scrollLeft, 50);
  assert.equal(scroll.scrollTop, 210);
});

test('queueZoom accumulates toward one target and clamps to the zoom range', () => {
  const previousRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  try {
    const subject = { zoom: 1, zoomTarget: null, zoomFrame: 0, zoomScrollLastTime: 0, zoomAnchor: null };
    ComicReader.prototype.queueZoom.call(subject, 1.5, 10, 20);
    assert.ok(Math.abs(subject.zoomTarget - 1.5) < 1e-9);
    ComicReader.prototype.queueZoom.call(subject, 1.5, 10, 20);
    assert.ok(Math.abs(subject.zoomTarget - 2.25) < 1e-9);
    ComicReader.prototype.queueZoom.call(subject, 1e6, 10, 20);
    assert.equal(subject.zoomTarget, 12);
  } finally {
    if (previousRaf) globalThis.requestAnimationFrame = previousRaf;
    else delete globalThis.requestAnimationFrame;
  }
});

test('all page-turn sources share one lock and coalesce rapid input', () => {
  const moves = [];
  const subject = {
    pageStepLocked: false,
    pageStepLockTimer: 0,
    peekTransitionStage: null,
    isOpen: () => true,
    beginPageStep: ComicReader.prototype.beginPageStep,
    releasePageStep: ComicReader.prototype.releasePageStep,
    movePage: (direction) => { moves.push(direction); return true; }
  };

  assert.equal(ComicReader.prototype.stepPage.call(subject, 1, 'keyboard'), true);
  // A second request while the first turn is in flight is dropped.
  assert.equal(ComicReader.prototype.stepPage.call(subject, 1, 'wheel'), false);
  assert.deepEqual(moves, [1]);
  assert.equal(subject.pageStepLocked, true);
  ComicReader.prototype.releasePageStep.call(subject);

  // The lock also waits out an active wheel/touchpad gesture and decoding.
  subject.pageStepLocked = true;
  subject.wheelGestureActive = true;
  subject.drag = null;
  subject.scrollStepActive = false;
  subject.decodeActive = 0;
  subject.decodeQueue = [];
  subject.pendingLoads = 0;
  ComicReader.prototype.maybeReleasePageStep.call(subject);
  assert.equal(subject.pageStepLocked, true);
  subject.wheelGestureActive = false;
  ComicReader.prototype.maybeReleasePageStep.call(subject);
  assert.equal(subject.pageStepLocked, false);
});

test('edge cues stay disabled while dragging', () => {
  const subject = {
    isScrolling: false,
    drag: { pointerId: 1 },
    pageZoneDirection: 1,
    root: { classList: new FakeClassList('is-page-zone-prev') },
    widths: null,
    setPageZoneWidths(previous, next) { this.widths = [previous, next]; },
    updatePageZoneWidths: ComicReader.prototype.updatePageZoneWidths
  };

  ComicReader.prototype.updatePageZone.call(subject, 500);
  assert.equal(subject.pageZoneDirection, 0);
  assert.equal(subject.root.classList.contains('is-page-zone-prev'), false);

  ComicReader.prototype.updatePageZoneWidths.call(subject);
  assert.deepEqual(subject.widths, [0, 0]);
});

function makeWheelSubject(readingOrder = 'ltr') {
  return {
    readingMode: 'continuous',
    readingOrder,
    scroll: { clientWidth: 800, clientHeight: 600, scrollLeft: 100, scrollTop: 40 },
    isContinuous() { return this.readingMode === 'continuous'; },
    wheelDeltaPixels(event, axisSize) { return ComicReader.prototype.wheelDeltaPixels.call(this, event, axisSize); },
    zoomFactorForWheel(pixels) { return ComicReader.prototype.zoomFactorForWheel.call(this, pixels); },
    stepWheelScroll(time) { return ComicReader.prototype.stepWheelScroll.call(this, time); },
    queueWheelScroll(delta) { this.queuedWheelDelta = delta; },
    queueZoom(...args) { this.zoomArgs = args; }
  };
}

function makeWheelEvent({ deltaX = 0, deltaY = 0, deltaMode = 0, ctrlKey = false, metaKey = false } = {}) {
  return {
    deltaX,
    deltaY,
    deltaMode,
    ctrlKey,
    metaKey,
    clientX: 30,
    clientY: 40,
    prevented: false,
    preventDefault() { this.prevented = true; }
  };
}

test('continuous horizontal mode maps an unmodified mouse wheel to horizontal scrolling', () => {
  const subject = makeWheelSubject();
  const event = makeWheelEvent({ deltaY: 3, deltaMode: 1 });

  ComicReader.prototype.onWheel.call(subject, event);

  assert.equal(event.prevented, true);
  assert.equal(subject.queuedWheelDelta, 100);
});

test('continuous RTL horizontal mode maps vertical wheel input toward the next page', () => {
  const subject = makeWheelSubject('rtl');
  const event = makeWheelEvent({ deltaY: 3, deltaMode: 1 });

  ComicReader.prototype.onWheel.call(subject, event);

  assert.equal(event.prevented, true);
  assert.equal(subject.queuedWheelDelta, -100);
});

test('continuous horizontal mode leaves native precision horizontal scrolling untouched', () => {
  const subject = makeWheelSubject();
  const event = makeWheelEvent({ deltaX: 24, deltaY: 3 });

  ComicReader.prototype.onWheel.call(subject, event);

  assert.equal(event.prevented, false);
  assert.equal(subject.scroll.scrollLeft, 100);
});

test('continuous vertical mode leaves wheel scrolling to the browser', () => {
  const subject = makeWheelSubject('ttb');
  const event = makeWheelEvent({ deltaY: 24 });

  ComicReader.prototype.onWheel.call(subject, event);

  assert.equal(event.prevented, false);
  assert.equal(subject.scroll.scrollTop, 40);
});

test('continuous wheel zoom still intercepts Ctrl or Meta input', () => {
  const subject = makeWheelSubject();
  const event = makeWheelEvent({ deltaY: -20, ctrlKey: true });

  ComicReader.prototype.onWheel.call(subject, event);

  assert.equal(event.prevented, true);
  assert.deepEqual(subject.zoomArgs, [Math.exp(20 * 0.008), 30, 40]);
});

test('mapped horizontal wheel input eases to its target over animation frames', () => {
  const subject = makeWheelSubject();
  const frames = [];
  subject.wheelScrollPending = 0;
  subject.wheelScrollFrame = 0;
  subject.wheelScrollLastTime = 0;
  subject.prefersReducedMotion = () => false;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };

  try {
    ComicReader.prototype.queueWheelScroll.call(subject, 100);
    let timestamp = 16.67;
    while (frames.length) {
      frames.shift()(timestamp);
      timestamp += 16.67;
    }
  } finally {
    if (previousRequestAnimationFrame) globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    else delete globalThis.requestAnimationFrame;
  }

  assert.ok(subject.scroll.scrollLeft > 100);
  assert.ok(subject.scroll.scrollLeft < 200);
  assert.equal(subject.wheelScrollPending, 0);
});

test('scrolling pauses background prefetch decode but still starts a visible-page decode', () => {
  const currentEntry = {};
  let started = 0;
  const subject = {
    isScrolling: true,
    entry: currentEntry,
    decodeLimit: 1,
    decodeActive: 0,
    decodePromises: new WeakMap(),
    decodeImage(image) { return ComicReader.prototype.decodeImage.call(this, image); },
    decodeQueue: [{ priority: 2, image: { decode: () => { started += 1; return new Promise(() => {}); } }, slot: null }],
    maybeReleasePageStep() {}
  };

  ComicReader.prototype.pumpDecode.call(subject);
  assert.equal(started, 0);
  assert.equal(subject.decodeQueue.length, 1);

  subject.decodeQueue.push({
    priority: 2,
    image: { decode: () => { started += 1; return new Promise(() => {}); } },
    slot: { type: 'page', entry: currentEntry, prefetch: false }
  });
  ComicReader.prototype.pumpDecode.call(subject);

  assert.equal(started, 1);
  assert.equal(subject.decodeActive, 1);
  assert.equal(subject.decodeQueue.length, 1);
});

test('Focus mode animation setting controls page reveal fades without affecting other modes', () => {
  const subject = {
    noFadeEntry: null,
    readingMode: 'focus',
    pageAnimation: false
  };
  const entry = {};

  assert.equal(ComicReader.prototype.shouldFadePageOnLoad.call(subject, entry), false);

  subject.pageAnimation = true;
  assert.equal(ComicReader.prototype.shouldFadePageOnLoad.call(subject, entry), true);

  subject.readingMode = 'single';
  subject.pageAnimation = false;
  assert.equal(ComicReader.prototype.shouldFadePageOnLoad.call(subject, entry), true);

  subject.noFadeEntry = entry;
  assert.equal(ComicReader.prototype.shouldFadePageOnLoad.call(subject, entry), false);
});

test('Focus mode without animations disables opacity transitions on mounted pages', () => {
  const makePage = () => ({
    style: {},
    classList: new FakeClassList('is-loading')
  });
  const slot = { element: makePage(), peekElement: makePage() };
  const subject = {
    root: { classList: new FakeClassList(), dataset: {} },
    pages: [slot],
    readingMode: 'focus',
    readingOrder: 'ltr',
    pageFit: 'screen',
    pageAnimation: false,
    focusDim: true,
    scroll: { classList: new FakeClassList() },
    isContinuous() { return false; }
  };

  ComicReader.prototype.syncModeClasses.call(subject);

  for (const page of [slot.element, slot.peekElement]) {
    assert.equal(page.style.transition, 'none');
    assert.equal(page.classList.contains('is-loading'), false);
  }

  subject.pageAnimation = true;
  ComicReader.prototype.syncModeClasses.call(subject);
  assert.equal(slot.element.style.transition, '');
});
