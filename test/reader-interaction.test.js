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
    movePage: (direction) => directions.push(direction)
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
    toViewportPoint: (x, y) => ({ x, y }),
    animatePeekRadius: (value) => { radius = value; },
    peekDuration: (value) => value
  };
  ComicReader.prototype.updateTouchPeek.call(subject);
  assert.deepEqual(subject.pointer, { x: 100, y: 100 });
  assert.equal(radius, 60);
});
