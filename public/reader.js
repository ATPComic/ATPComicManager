import {
  createEpisodeReaderModel,
  findNearestPageEntry,
  findPageEntry,
  getAdjacentEntry,
  getImageUrl,
  getLogicalPageStep,
  getPeekTargetVariant,
  isHorizontalReadingOrder,
  normalizePeekSettings,
  normalizeReaderPreferences,
  READING_MODES,
  READING_ORDERS,
  resolvePeekTarget as resolveModelPeekTarget,
  getSequencePosition,
  getWheelIntent
} from './reader-model.js';
import { t } from './i18n.js';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const DEFAULT_ASPECT = 0.7;
const DRAG_THRESHOLD = 8;
// Gap between pages along the reading axis. Must match .reader-plane's old gap.
const LAYOUT_GAP = 8;
// Shared timing for page and Peek fade animations.
const TIMING_MS = 250;
// Extra pages mounted on each side of the visible range and decoded ahead of
// time, so a page turn does not have to decode on demand.
const PREFETCH_PAGES = 1;
// Chromium converts a line-mode wheel delta to pixels at 100/3 px per line
// (WHEEL_DELTA 120 -> 3 lines -> 100 px).
const PX_PER_LINE = 100 / 3;
// Horizontal mouse-wheel input has no browser-native momentum path. Follow its
// accumulated target with a short exponential ease instead of issuing a new
// smooth-scroll animation for every wheel event (which continually restarts it).
const WHEEL_SCROLL_TAU_MS = 48;
const WHEEL_SCROLL_EPSILON = 0.5;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 12;
// Wheel/pinch zoom: discrete mouse notches step by a fixed factor (like browser
// zoom), while continuous trackpad/pinch deltas accumulate with a per-pixel
// sensitivity so a full gesture feels responsive.
const ZOOM_WHEEL_SENSITIVITY = 0.008;
const ZOOM_NOTCH_MIN_PIXELS = 48;
const ZOOM_NOTCH_FACTOR = 1.2;
const ZOOM_TAU_MS = 48;
const ZOOM_EPSILON = 0.004;
// Pixels of wheel delta that amount to one page turn in snap modes.
const PAGE_TURN_WHEEL_THRESHOLD = 40;
// Middle-click Peek transition: expand to full screen, then shrink back (ms).
const PEEK_EXPAND_MS = 500;
const PEEK_REVEAL_MS = 300;
// Peek interaction animation timings (ms), on the same 8ms grid as TIMING_MS.
const PEEK_PRESS_MS = 168;
const PEEK_RELEASE_MS = 208;
const PEEK_TOUCH_HIDE_MS = 160;
// Spreading two fingers by this ratio/px commits the Peek target (like the
// middle mouse button). Deliberately large so growing the circle does not
// commit by accident.
const PEEK_SPREAD_RATIO = 2;
const PEEK_SPREAD_MIN_PX = 96;
// Wheel gesture idle before a snap-mode turn is allowed again (ms).
const WHEEL_GESTURE_IDLE_MS = 160;
// Idle time before a scroll is considered finished (ms).
const SCROLL_IDLE_MS = 144;
// Fallback in case `scrollend` never fires for a page turn (ms).
const PAGE_STEP_FALLBACK_MS = 3000;
// How far the Peek circle grows while the left mouse button is held.
const PEEK_PRESS_SCALE = 1.75;
// Cursor auto-hide and fullscreen chrome auto-hide (ms).
const CURSOR_HIDE_MS = 896;
const FULLSCREEN_CHROME_MS = 320;

export class ComicReader {
  constructor(root, {
    getEpisode,
    getSequence,
    getCollection,
    settings,
    onPageProgress,
    onCollectionProgress,
    onVariants,
    onEditEpisodeTags,
    onClose
  }) {
    this.root = root;
    this.getEpisode = getEpisode;
    this.getSequence = getSequence;
    this.getCollection = getCollection;
    this.onPageProgress = onPageProgress;
    this.onCollectionProgress = onCollectionProgress;
    this.onVariants = onVariants;
    this.onEditEpisodeTags = onEditEpisodeTags;
    this.onClose = onClose;
    this.viewport = root.querySelector('[data-reader-viewport]');
    this.plane = root.querySelector('[data-reader-plane]');
    // A native scroll container drives panning for every mode; the plane is its
    // content. Zoom is a CSS transform on the content layers, so the scroll
    // extent follows the scaled bounds.
    this.scroll = root.querySelector('[data-reader-scroll]');
    if (!this.scroll) {
      this.scroll = document.createElement('div');
      this.scroll.className = 'reader-scroll';
      this.scroll.dataset.readerScroll = '';
      this.viewport.insertBefore(this.scroll, this.plane);
      this.scroll.append(this.plane);
    }
    this.collectionCrumb = root.querySelector('[data-reader-collection]');
    this.breadcrumbSeparator = root.querySelector('[data-reader-breadcrumb-separator]');
    this.title = root.querySelector('[data-reader-title]');
    this.meta = root.querySelector('[data-reader-meta]');
    this.peekButton = root.querySelector('[data-reader-peek-toggle]');
    this.episodeId = null;
    this.model = null;
    this.entry = null;
    this.pages = [];
    this.aspectCache = new Map();
    this.naturalCache = new Map();
    this.variantAspect = null;
    this.naturalWidth = null;
    this.naturalHeight = null;
    this.stripToken = 0;
    this.peekTargetOverrides = new Map();
    this.peekEnabled = true;
    const preferences = normalizeReaderPreferences(settings);
    this.readingMode = preferences.mode;
    this.readingOrder = preferences.order;
    this.pageFit = preferences.fit;
    this.pageAnimation = preferences.pageAnimation;
    this.focusDim = preferences.focusDim;
    const peekSettings = normalizePeekSettings(settings);
    this.peekRadius = peekSettings.radius;
    this.peekFeather = peekSettings.feather;
    this.peekAnimationSpeed = peekSettings.animationSpeed;
    this.peekOpacity = peekSettings.opacity;
    this.syncPeekFadeDuration();
    this.peekRadiusCurrent = this.touchMode ? 0 : this.peekRadius;
    this.peekRadiusTarget = this.touchMode ? 0 : this.peekRadius;
    this.peekAnimationResolve = null;
    this.peekTransitionStage = null;
    this.peekForceOpaque = false;
    this.peekPlane = null;
    this.peekTrack = null;
    this.peekVariant = null;
    // Cache of the last written mask opacity so pointer moves do not rewrite it.
    this.peekMaskOpacity = '';
    this.peekVisible = false;
    this.peekMirrorTransform = null;
    this.peekRange = null;
    this.pointerUpdateFrame = 0;
    this.pendingZoneX = null;
    this.cursorTimer = 0;
    this.pointer = { x: 0, y: 0 };
    this.hasPointerPosition = false;
    // Native-scroll navigation state: the tile layout is in fit units and the
    // scroller supplies both the camera offset and the zoom transform.
    this.zoom = 1;
    this.baseFitScale = 1;
    this.zoomTarget = null;
    this.zoomFrame = 0;
    this.zoomAnchor = null;
    this.zoomScrollLastTime = 0;
    // Zooming deliberately moves the scroll offset; suppress snap-to-page for a
    // moment so scrollend does not yank the anchored zoom back to centre.
    this.suppressSnapUntil = 0;
    this.windowFrame = 0;
    this.scrollMirrorFrame = 0;
    this.isScrolling = false;
    this.scrollIdleTimer = 0;
    // Cumulative layout: page offsets/sizes along the reading axis. The native
    // scroller supplies the camera offset, so no window-origin bookkeeping is
    // needed any more. See computeLayout.
    this.layout = null;
    this.contentCross = 0;
    this.mountedRange = null;
    this.positionsDirty = true;
    this.drag = null;
    this.pointerDown = null;
    this.suppressClick = false;
    this.pageTurnPointer = null;
    this.touchGesture = null;
    this.touchPoints = new Map();
    this.touchPeek = false;
    this.touchPinch = null;
    this.touchPeekStartDistance = 0;
    this.touchPeekSpread = false;
    this.touchMode = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (this.touchMode) this.peekRadiusCurrent = this.peekRadiusTarget = 0;
    this.resizeFrame = 0;
    this.pageZoneDirection = 0;
    this.peekPressPointerId = null;
    this.wheelAccumulator = 0;
    this.wheelResetTimer = 0;
    this.wheelScrollPending = 0;
    this.wheelScrollFrame = 0;
    this.wheelScrollLastTime = 0;
    this.scrollStepActive = false;
    this.noFadeEntry = null;
    this.suppressCurrentUntil = 0;
    // Single entry point gate for every relative page turn (wheel, keyboard,
    // page zones, taps, trackpad). Only one turn may be in flight.
    this.pageStepLocked = false;
    this.pageStepLockTimer = 0;
    this.wheelGestureActive = false;
    // Serialize image decoding: large pages decoded back-to-back compete for
    // CPU and show up as dropped frames.
    this.decodeQueue = [];
    this.decodeActive = 0;
    this.decodeLimit = 1;
    this.decodeSession = 0;
    this.decodePromises = new WeakMap();
    this.pendingLoads = 0;
    this.fullscreenRequested = false;
    this.fullscreenEdgeActive = false;
    this.fullscreenChromeTimer = 0;
    this.fullscreenFitFrame = 0;
    this.syncModeClasses();
    this.bind();
    this.syncPeekInteractionState();
  }

  bind() {
    this.root.querySelector('[data-reader-close]').addEventListener('click', () => this.requestClose());
    this.root.querySelector('[data-reader-fit]').addEventListener('click', () => this.fit());
    this.root.querySelector('[data-reader-zoom-out]').addEventListener('click', () => this.zoomAt(0.8));
    this.root.querySelector('[data-reader-zoom-in]').addEventListener('click', () => this.zoomAt(1.25));
    this.peekButton.addEventListener('click', () => this.setPeekEnabled(!this.peekEnabled));
    this.root.querySelector('[data-reader-fullscreen]').addEventListener('click', () => this.toggleFullscreen());
    this.root.querySelector('[data-reader-tags]')?.addEventListener('click', () => {
      if (this.episodeId) this.onEditEpisodeTags?.(this.episodeId);
    });

    this.root.addEventListener('pointermove', (event) => this.onFullscreenPointerMove(event));
    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true });
    // Native scroll animations (wheel steps, smooth page turns) end here; the
    // wheel lock is released on scrollend instead of a fixed delay.
    this.scroll.addEventListener('scrollend', () => this.onScrollEnd(), { passive: true });
    this.viewport.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.viewport.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.viewport.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.viewport.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.viewport.addEventListener('pointercancel', (event) => this.onPointerUp(event, true));
    this.viewport.addEventListener('lostpointercapture', (event) => this.onLostPointerCapture(event));
    this.viewport.addEventListener('pointerleave', () => { if (!this.pageTurnPointer) this.updatePageZone(); });
    this.viewport.addEventListener('auxclick', (event) => { if (event.button === 1) event.preventDefault(); });
    // Two-finger touches are always ours (Peek or pinch-zoom), so stop the
    // browser from also panning/zooming while both fingers are down.
    this.viewport.addEventListener('touchmove', (event) => {
      if (event.touches.length >= 2) event.preventDefault();
    }, { passive: false });
    window.addEventListener('resize', () => {
      if (!this.isOpen()) return;
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => this.fit());
    });
    document.addEventListener('keydown', (event) => this.onKeyDown(event));
    document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
  }

  isOpen() {
    return !this.root.hidden;
  }

  isContinuous() {
    return this.readingMode === 'continuous';
  }

  requestClose() {
    if (this.onClose?.() === true) return;
    this.close();
  }

  async open(episodeId, preferredIndex = 0) {
    const episode = this.getEpisode(episodeId);
    if (!episode) return;
    this.episodeId = episodeId;
    this.model = createEpisodeReaderModel(episode);
    const entry = this.model.entries.find((candidate) => candidate.index === preferredIndex) ?? this.model.entries[0] ?? null;
    if (!entry) return;
    this.root.hidden = false;
    document.body.classList.add('reader-open');
    if (!this.hasPointerPosition) {
      const rect = this.viewport.getBoundingClientRect();
      this.pointer = { x: rect.width / 2, y: rect.height / 2 };
    }
    this.syncModeClasses();
    await this.preloadEntryImage(entry);
    this.renderStrip(entry);
    this.root.querySelector('[data-reader-close]').focus();
  }

  close() {
    this.endPeekPress({ releaseCapture: true });
    this.stripToken += 1;
    this.peekTargetOverrides.clear();
    this.root.hidden = true;
    document.body.classList.remove('reader-open');
    this.plane.replaceChildren();
    this.plane.style.transform = '';
    this.plane.style.opacity = '';
    this.plane.style.transition = '';
    this.pages = [];
    this.peekPlane?.remove();
    this.peekPlane = null;
    this.peekTrack = null;
    this.resetDecodeQueue();
    this.pendingLoads = 0;
    this.scrollStepActive = false;
    this.layout = null;
    this.mountedRange = null;
    this.positionsDirty = true;
    this.zoom = 1;
    this.baseFitScale = 1;
    this.zoomTarget = null;
    cancelAnimationFrame(this.zoomFrame);
    this.zoomFrame = 0;
    this.zoomAnchor = null;
    this.suppressSnapUntil = 0;
    this.peekMaskOpacity = '';
    this.peekVisible = false;
    this.peekMirrorTransform = null;
    cancelAnimationFrame(this.pointerUpdateFrame);
    cancelAnimationFrame(this.windowFrame);
    this.pointerUpdateFrame = 0;
    this.windowFrame = 0;
    clearTimeout(this.cursorTimer);
    clearTimeout(this.fullscreenChromeTimer);
    clearTimeout(this.wheelResetTimer);
    clearTimeout(this.scrollIdleTimer);
    this.isScrolling = false;
    clearTimeout(this.pageStepLockTimer);
    this.pageStepLocked = false;
    this.pageStepLockTimer = 0;
    this.wheelGestureActive = false;
    cancelAnimationFrame(this.fullscreenFitFrame);
    cancelAnimationFrame(this.wheelScrollFrame);
    this.wheelScrollPending = 0;
    this.wheelScrollFrame = 0;
    this.wheelScrollLastTime = 0;
    this.peekAnimationResolve?.();
    this.peekAnimationResolve = null;
    this.peekRadiusCurrent = this.touchMode ? 0 : this.peekRadius;
    this.peekRadiusTarget = this.touchMode ? 0 : this.peekRadius;
    this.peekTransitionStage = null;
    this.peekForceOpaque = false;
    this.root.classList.remove('is-cursor-hidden', 'is-dragging', 'is-fullscreen', 'is-chrome-visible', 'is-scrolling', 'is-page-zone-prev', 'is-page-zone-next');
    this.fullscreenEdgeActive = false;
    this.pageTurnPointer = null;
    this.pointerDown = null;
    this.drag = null;
    this.touchGesture = null;
    this.updatePageZone();
    this.touchPoints.clear();
    this.touchPeek = false;
    this.touchPinch = null;
    this.touchPeekStartDistance = 0;
    this.touchPeekSpread = false;
    this.setPageZoneWidths(0, 0);
    const shouldExitFullscreen = this.fullscreenRequested
      && document.fullscreenElement === document.documentElement;
    this.fullscreenRequested = false;
    if (shouldExitFullscreen) document.exitFullscreen().catch(() => {});
  }

  // ---------------------------------------------------------------- settings

  getReaderSettings() {
    return {
      radius: this.peekRadius,
      feather: this.peekFeather,
      animationSpeed: this.peekAnimationSpeed,
      opacity: this.peekOpacity,
      mode: this.readingMode,
      order: this.readingOrder,
      fit: this.pageFit,
      pageAnimation: this.pageAnimation,
      focusDim: this.focusDim
    };
  }

  setReaderSettings(settings) {
    const peek = normalizePeekSettings(settings);
    this.peekRadius = peek.radius;
    this.peekFeather = peek.feather;
    this.peekAnimationSpeed = peek.animationSpeed;
    this.peekOpacity = peek.opacity;
    this.syncPeekFadeDuration();
    if (this.peekPressPointerId == null && !this.peekTransitionStage) {
      this.peekRadiusCurrent = this.touchMode ? 0 : this.peekRadius;
      this.peekRadiusTarget = this.touchMode ? 0 : this.peekRadius;
    }
    const preferences = normalizeReaderPreferences(settings);
    if (preferences.mode !== this.readingMode || preferences.order !== this.readingOrder) {
      cancelAnimationFrame(this.wheelScrollFrame);
      this.wheelScrollFrame = 0;
      this.wheelScrollPending = 0;
      this.wheelScrollLastTime = 0;
    }
    this.readingMode = preferences.mode;
    this.readingOrder = preferences.order;
    this.pageFit = preferences.fit;
    this.pageAnimation = preferences.pageAnimation;
    this.focusDim = preferences.focusDim;
    this.syncModeClasses();
    if (this.isOpen()) {
      this.resetPageStyles();
      // Mode/order change the axis layout; re-fit and re-center in one pass.
      this.suppressCurrentUntil = performance.now() + 200;
      this.applyModeLayout(this.entry, false);
    }
    this.updatePeekMask();
    return this.getReaderSettings();
  }

  syncModeClasses() {
    for (const mode of READING_MODES) this.root.classList.toggle(`is-mode-${mode}`, this.readingMode === mode);
    for (const order of READING_ORDERS) this.root.classList.toggle(`is-order-${order}`, this.readingOrder === order);
    this.root.dataset.readerMode = this.readingMode;
    this.root.dataset.readerOrder = this.readingOrder;
    this.root.dataset.readerFit = this.pageFit;
    this.root.classList.toggle('is-focus-dim', this.focusDim !== false);
    const disableFocusFade = this.readingMode === 'focus' && !this.pageAnimation;
    for (const slot of this.pages) {
      for (const element of [slot.element, slot.peekElement]) {
        element.style.transition = disableFocusFade ? 'none' : '';
        if (disableFocusFade) element.classList.remove('is-loading');
      }
    }
    // Continuous mode lets the scroller handle touch natively.
    if (this.scroll) this.scroll.classList.toggle('is-native-pan', this.isContinuous());
  }

  shouldFadePageOnLoad(entry) {
    return entry !== this.noFadeEntry && !(this.readingMode === 'focus' && !this.pageAnimation);
  }

  // ---------------------------------------------------------------- model

  currentPages() {
    return this.model?.variants.get(this.entry?.variant) ?? [];
  }

  resolvePeekTarget(entry = this.entry) {
    if (!entry || !this.model) return { variant: null, entry: null };
    const target = resolveModelPeekTarget(this.model, entry.variant, entry.page, this.getPeekTargetOverride(entry));
    // Mounting falls back to the nearest page when the target variant lacks the
    // current page number; availability and the header must do the same so the
    // Peek layer is not declared empty while it is actually showing an image.
    if (!target.variant || target.entry) return target;
    return { variant: target.variant, entry: findNearestPageEntry(this.model, target.variant, entry.page) ?? null };
  }

  peekOverrideKey(variant = this.entry?.variant, episodeId = this.episodeId) {
    return episodeId && variant ? `${episodeId}:${variant}` : null;
  }

  getPeekTargetOverride(entry = this.entry) {
    const key = this.peekOverrideKey(entry?.variant);
    return key && this.peekTargetOverrides.has(key) ? this.peekTargetOverrides.get(key) : undefined;
  }

  // ---------------------------------------------------------------- strip

  renderStrip(entry, { animate = false } = {}) {
    if (!this.model || !this.plane) return;
    // A rebuilt strip invalidates any in-flight Peek transition (its slots and
    // plane are replaced), so abort it rather than leaving Peek disabled.
    this.cancelPeekTransition();
    this.stripToken += 1;
    this.resetDecodeQueue();
    this.pendingLoads = 0;
    const token = this.stripToken;
    this.endPeekPress({ releaseCapture: true });
    // A new strip starts at fit; drop any zoom from the previous strip.
    this.zoom = 1;
    this.entry = entry ?? this.model.entries[0] ?? null;
    const cacheKey = `${this.episodeId}:${this.entry.index}`;
    this.variantAspect = this.aspectCache.get(cacheKey) ?? null;
    const natural = this.naturalCache.get(cacheKey) ?? null;
    this.naturalWidth = natural?.width ?? null;
    this.naturalHeight = natural?.height ?? null;
    this.pages = this.currentPages().map((pageEntry, index) => {
      const element = document.createElement('div');
      const peekElement = document.createElement('div');
      return { entry: pageEntry, index, element, peekElement, peekKey: null, type: null, width: 0, height: 0 };
    });
    this.plane.replaceChildren();
    // Peek lives in its own viewport-sized mask layer that is a sibling of the
    // strip. A transformed track inside it mirrors the whole strip (so Peek
    // stays continuous across page boundaries), while the radial mask itself is
    // applied in viewport coordinates. Keeping the masked element viewport-sized
    // means the mask never has to rasterize a strip-sized (pageCount * zoom)
    // surface, which is what broke the feather on long / zoomed-in strips.
    this.peekPlane?.remove();
    this.peekPlane = document.createElement('div');
    this.peekPlane.className = 'reader-peek-mask';
    this.peekPlane.dataset.readerPeekPlane = '';
    // The Peek content lives in a viewport-fixed layer under the mask. Its offset
    // mirrors the base scroller via a CSS scroll-driven animation (compositor
    // thread), so there is no JS per-frame sync and no one-frame lag.
    this.peekMover = document.createElement('div');
    this.peekMover.className = 'reader-peek-mover';
    this.peekMover.dataset.readerPeekMover = '';
    this.peekTrack = document.createElement('div');
    this.peekTrack.className = 'reader-peek-track';
    this.peekMover.append(this.peekTrack);
    this.peekPlane.replaceChildren(this.peekMover);
    this.viewport.append(this.peekPlane);
    this.peekMaskOpacity = '';
    this.peekVisible = false;
    this.peekMirrorTransform = null;
    cancelAnimationFrame(this.pointerUpdateFrame);
    this.pointerUpdateFrame = 0;
    this.plane.style.transform = '';
    this.plane.style.opacity = '';
    // Sizes drive the cumulative layout; rebuild it for this strip.
    this.applyAllSizes();
    this.refreshWindow();
    this.applyModeVisibility();
    this.peekVariant = this.resolvePeekTarget(this.entry).variant ?? null;
    this.updateHeaderForEntry();
    if (this.variantAspect) {
      // Aspect already known (preloaded): lay out immediately at the correct size.
      this.applyModeLayout(this.entry, animate);
    } else {
      // First reveal without a cached aspect: wait for the current page to
      // decode so there is no default-ratio letterboxing or reflow.
      this.resolveInitialAspect().then(() => {
        if (token !== this.stripToken || !this.isOpen()) return;
        this.applyModeLayout(this.entry, animate);
      });
    }
    this.updatePeekMask();
    this.preloadNeighbors();
  }

  resolveInitialAspect() {
    const slot = this.pageFor(this.entry);
    if (!slot) return Promise.resolve();
    if (slot.type !== 'page') this.mountPage(slot);
    const image = slot.element.querySelector('[data-reader-page-image]');
    return this.waitForDecode(image).then(() => {
      const width = image?.naturalWidth || 0;
      const height = image?.naturalHeight || 0;
      if (!width || !height) return;
      const aspect = width / height;
      const key = `${this.episodeId}:${this.entry.index}`;
      this.aspectCache.set(key, aspect);
      this.naturalCache.set(key, { width, height });
      this.variantAspect = aspect;
      this.naturalWidth = width;
      this.naturalHeight = height;
      this.applyAllSizes();
    });
  }

  // Pages kept mounted are the strictly visible ones plus the current page
  // (see mountWindow). Off-window content is released after a small buffer.
  releaseRadius() {
    return 2;
  }

  currentIndex() {
    return this.pages.findIndex((slot) => slot.entry === this.entry);
  }

  // ---- logical layout: cumulative offsets along the reading axis ----------
  computeLayout() {
    const horizontal = isHorizontalReadingOrder(this.readingOrder);
    const offsets = [];
    const sizes = [];
    let cursor = 0;
    let maxCross = 0;
    for (const slot of this.pages) {
      const size = horizontal ? slot.width : slot.height;
      const cross = horizontal ? slot.height : slot.width;
      offsets.push(cursor);
      sizes.push(size || 0);
      cursor += (size || 0) + LAYOUT_GAP;
      if (cross > maxCross) maxCross = cross;
    }
    // Cross axis is just the largest page cross in fit units; the cross-axis
    // viewport centring is applied by applyViewTransform (like the axis pad),
    // so it stays correct at any zoom without re-positioning tiles.
    this.contentCross = Math.max(maxCross, 1);
    // The layout is kept in "fit" units (baseFitScale); `zoom` is applied later
    // as a CSS transform, so tiles never need re-sizing or re-positioning when
    // the user zooms. The half-viewport leading pad comes from the transform
    // translate (see applyViewTransform) so the first/last page can centre.
    // total excludes the trailing gap; offsets stay 0-based and monotonic.
    const total = Math.max(0, cursor - LAYOUT_GAP);
    this.layout = { horizontal, dir: this.readingOrder === 'rtl' ? -1 : 1, offsets, sizes, total };
    // The scroll content must span the whole strip so native scroll has a
    // correct extent even though only a few tiles are mounted.
    if (this.plane) {
      const width = horizontal ? `${total}px` : `${this.contentCross}px`;
      const height = horizontal ? `${this.contentCross}px` : `${total}px`;
      this.plane.style.width = width;
      this.plane.style.height = height;
      if (this.peekTrack) {
        this.peekTrack.style.width = width;
        this.peekTrack.style.height = height;
      }
    }
    this.mountedRange = null;
    this.positionsDirty = true;
  }

  // Half the viewport along the reading axis, in rendered pixels, expressed as
  // the plane's leading transform translate. It lets native scroll centre the
  // first and last page (which plain scrollTo cannot).
  viewPad() {
    const horizontal = isHorizontalReadingOrder(this.readingOrder);
    const half = horizontal
      ? (this.scroll?.clientWidth || 0) / 2
      : (this.scroll?.clientHeight || 0) / 2;
    return horizontal ? { x: half, y: 0 } : { x: 0, y: half };
  }

  // Cross-axis pad (margin) that centres the strip when it is smaller than the
  // viewport; 0 once zoomed past it so the user can pan.
  crossPadFor(zoom = this.zoom || 1) {
    const horizontal = isHorizontalReadingOrder(this.readingOrder);
    const crossViewport = horizontal
      ? (this.scroll?.clientHeight || 0)
      : (this.scroll?.clientWidth || 0);
    return Math.max(0, (crossViewport - zoom * (this.contentCross || 0)) / 2);
  }

  // Zoom is a transform on the content layers only: tiles stay at their fit
  // layout positions/sizes, so changing zoom is a compositor-friendly update.
  // The axis pad is a (scroller-space) margin on the plane so the first/last
  // page can be centred; the Peek layer replicates it in its own transform.
  applyViewTransform() {
    const zoom = this.zoom || 1;
    const pad = this.viewPad();
    const horizontal = isHorizontalReadingOrder(this.readingOrder);
    const crossPad = this.crossPadFor(zoom);
    if (this.plane) {
      this.plane.style.transformOrigin = '0 0';
      this.plane.style.transform = `scale(${zoom})`;
      this.plane.style.marginLeft = horizontal ? `${pad.x}px` : `${crossPad}px`;
      this.plane.style.marginRight = horizontal ? `${pad.x}px` : `${crossPad}px`;
      this.plane.style.marginTop = horizontal ? `${crossPad}px` : `${pad.y}px`;
      this.plane.style.marginBottom = horizontal ? `${crossPad}px` : `${pad.y}px`;
    }
    if (this.peekTrack) {
      this.peekTrack.style.transformOrigin = '0 0';
      this.peekTrack.style.transform = `translate(${pad.x + (horizontal ? 0 : crossPad)}px, ${pad.y + (horizontal ? crossPad : 0)}px) scale(${zoom})`;
    }
  }

  // First index whose span ends at or after `lo` (binary search; offsets grow).
  firstIntersecting(lo) {
    const { offsets, sizes } = this.layout;
    let left = 0;
    let right = this.pages.length;
    while (left < right) {
      const mid = (left + right) >> 1;
      if (offsets[mid] + sizes[mid] < lo) left = mid + 1;
      else right = mid;
    }
    return left;
  }

  findNearestIndex(play) {
    const { offsets, sizes } = this.layout;
    const n = this.pages.length;
    let left = 0;
    let right = n;
    while (left < right) {
      const mid = (left + right) >> 1;
      if (offsets[mid] + sizes[mid] / 2 < play) left = mid + 1;
      else right = mid;
    }
    let best = -1;
    let bestDistance = Infinity;
    for (const index of [left - 1, left]) {
      if (index < 0 || index >= n) continue;
      const distance = Math.abs(offsets[index] + sizes[index] / 2 - play);
      if (distance < bestDistance) { bestDistance = distance; best = index; }
    }
    return best;
  }

  // Fit-unit content coordinate of a page; RTL mirrors the axis so the next
  // page sits to the left. The leading viewport pad is applied by the plane
  // transform, not here, so this is stable across zoom changes.
  slotPosition(index) {
    const { horizontal, dir, offsets, sizes, total } = this.layout;
    const slot = this.pages[index];
    if (horizontal) {
      const base = dir < 0 ? total - offsets[index] - sizes[index] : offsets[index];
      return { left: base, top: (this.contentCross - slot.height) / 2 };
    }
    return { left: (this.contentCross - slot.width) / 2, top: offsets[index] };
  }

  // Logical range [start, end) of pages that intersect the scroller viewport.
  visibleRange() {
    const n = this.pages.length;
    const { horizontal, dir, total } = this.layout;
    const scrollOffset = horizontal ? this.scroll.scrollLeft : this.scroll.scrollTop;
    const viewSize = horizontal ? this.scroll.clientWidth : this.scroll.clientHeight;
    const zoom = this.zoom || 1;
    // Convert the rendered visible window back to fit units (the plane starts at
    // scrollOffset - halfViewport because of the leading transform pad).
    const s = (scrollOffset - viewSize / 2) / zoom;
    const span = viewSize / zoom;
    let lo;
    let hi;
    if (dir < 0) { lo = total - (s + span); hi = total - s; }
    else { lo = s; hi = s + span; }
    const start = this.firstIntersecting(lo);
    let end = start;
    while (end < n && this.layout.offsets[end] <= hi) end += 1;
    return [start, end];
  }

  setSlotPosition(slot, index) {
    const { left, top } = this.slotPosition(index);
    if (slot.placedLeft === left && slot.placedTop === top) return;
    slot.placedLeft = left;
    slot.placedTop = top;
    for (const element of [slot.element, slot.peekElement]) {
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    }
  }

  ensureAttached(slot) {
    if (slot.element.parentNode !== this.plane) this.plane.append(slot.element);
    if (this.peekTrack && slot.peekElement.parentNode !== this.peekTrack) this.peekTrack.append(slot.peekElement);
  }

  detachSlot(slot) {
    slot.element.remove();
    slot.peekElement.remove();
  }

  releaseSlot(slot) {
    this.mountSpan(slot);
    this.detachSlot(slot);
  }

  mountWindow() {
    if (!this.pages.length) return;
    // While a page-turn scroll / opacity animation runs, defer mounting (and
    // therefore any image loading) of new pages until it ends. The current page
    // is already preloaded/mounted; prefetch resumes afterwards.
    if (this.scrollStepActive) return;
    if (!this.layout) this.computeLayout();
    const center = this.currentIndex();
    if (center < 0) return;
    // Mount the visible pages plus one page on each side as a decode/prefetch
    // buffer, always including the current page.
    const [vStart, vEnd] = this.visibleRange();
    const start = Math.max(0, Math.min(vStart, center) - PREFETCH_PAGES);
    const end = Math.min(this.pages.length, Math.max(vEnd, center + 1) + PREFETCH_PAGES);
    // Peek content mirrors the base window exactly.
    const peekStart = start;
    const peekEnd = end;
    const range = this.mountedRange;
    const rangeChanged = !range || range[0] !== start || range[1] !== end;
    if (rangeChanged) {
      this.mountedRange = [start, end];
      for (let index = 0; index < this.pages.length; index += 1) {
        const slot = this.pages[index];
        if (index >= start && index < end) {
          slot.prefetch = index < vStart || index >= vEnd;
          if (slot.type !== 'page') this.mountPage(slot);
          this.ensureAttached(slot);
        } else if (Math.abs(index - center) <= this.releaseRadius()) {
          if (slot.element.parentNode) this.detachSlot(slot);
        } else if (slot.element.parentNode || slot.type === 'page') {
          this.releaseSlot(slot);
        }
      }
      this.positionsDirty = true;
      this.peekRange = null;
    }
    // Sync Peek content for the mounted window (only when the peek set changes).
    const peekRange = this.peekRange;
    if (!peekRange || peekRange[0] !== peekStart || peekRange[1] !== peekEnd || rangeChanged) {
      this.peekRange = [peekStart, peekEnd];
      for (let index = start; index < end; index += 1) {
        const slot = this.pages[index];
        if (slot.type !== 'page') continue;
        if (index >= peekStart && index < peekEnd) this.mountPeek(slot);
        else this.clearPeekSlot(slot);
      }
    }
    // Position writes only happen when the range or the origin changed; every
    // other frame is a pure transform update on the plane/track.
    if (this.positionsDirty) {
      for (let index = start; index < end; index += 1) this.setSlotPosition(this.pages[index], index);
      this.positionsDirty = false;
    }
  }

  // Serialize image decoding. `image.decode()` is off the critical path, but
  // decoding several large pages at once still competes for CPU and surfaces as
  // dropped frames. Lower priority jobs (prefetch) wait for current/visible.
  queueDecode(image, priority, done, slot = null) {
    let resolve;
    const promise = new Promise((finish) => { resolve = finish; });
    this.decodeQueue.push({ image, priority, done, slot, promise, resolve, priorityBoost: false });
    this.decodeQueue.sort((a, b) => a.priority - b.priority);
    this.pumpDecode();
    return promise;
  }

  pumpDecode() {
    for (const job of this.decodeQueue) {
      if (job.priorityBoost) continue;
      if (job.slot) {
        job.priority = job.slot.type !== 'page'
          ? 3
          : job.slot.entry === this.entry ? 0 : job.slot.prefetch ? 2 : 1;
      }
    }
    this.decodeQueue.sort((a, b) => a.priority - b.priority);
    while (this.decodeActive < this.decodeLimit && this.decodeQueue.length) {
      // Prefetch decodes are useful only while idle; let visible/current pages
      // win during scrolling so background work cannot compete with animation.
      if ((this.isScrolling || this.scrollStepActive) && this.decodeQueue[0].priority >= 2) return;
      const job = this.decodeQueue.shift();
      if (job.slot && job.slot.type !== 'page') {
        job.resolve();
        continue;
      }
      this.decodeActive += 1;
      const session = this.decodeSession;
      const finish = () => {
        this.decodeActive = Math.max(0, this.decodeActive - 1);
        job.resolve();
        if (session === this.decodeSession) job.done?.();
        this.pumpDecode();
        this.maybeReleasePageStep();
      };
      this.decodeImage(job.image).then(finish);
    }
    if (!this.decodeActive && !this.decodeQueue.length) this.maybeReleasePageStep();
  }

  resetDecodeQueue() {
    this.decodeSession += 1;
    for (const job of this.decodeQueue) job.resolve();
    this.decodeQueue.length = 0;
    this.decodePromises = new WeakMap();
  }

  decodeImage(image) {
    if (!image?.decode) return Promise.resolve();
    let promise = this.decodePromises.get(image);
    if (!promise) {
      try {
        promise = Promise.resolve(image.decode()).catch(() => {});
      } catch {
        promise = Promise.resolve();
      }
      this.decodePromises.set(image, promise);
    }
    return promise;
  }

  refreshWindow() {
    const center = this.currentIndex();
    if (center < 0) return;
    if (!this.layout) this.computeLayout();
    this.mountWindow();
    this.syncScrollMirror();
    this.updatePageZoneWidths();
    this.updatePeekMask();
    this.applyScrollOpacity();
  }

  // Keep the Peek layer at the same offset as the base scroller. The mirror is a
  // plain compositor transform written in the same frame as the scroll/zoom, so
  // it can never drift from the (transform-based) base layer.
  syncScrollMirror() {
    if (!this.peekVisible || !this.peekMover) return;
    const transform = `translate3d(${-this.scroll.scrollLeft}px, ${-this.scroll.scrollTop}px, 0)`;
    if (this.peekMirrorTransform === transform) return;
    this.peekMirrorTransform = transform;
    this.peekMover.style.transform = transform;
  }

  // The Peek mover is driven purely by `syncScrollMirror`; nothing to set up
  // beyond clearing any legacy mirror state.
  setupPeekTimeline() {
    if (!this.peekMover) return;
    this.peekMover.classList.remove('is-mirror');
    this.peekMover.style.width = '';
    this.peekMover.style.height = '';
    this.peekMirrorTransform = null;
    this.syncScrollMirror();
  }

  scrollTo(left, top, smooth) {
    const behavior = smooth && !this.prefersReducedMotion() ? 'smooth' : 'auto';
    this.scroll.scrollTo({ left, top, behavior });
  }

  queueWheelScroll(delta) {
    const horizontal = isHorizontalReadingOrder(this.readingOrder);
    if (this.prefersReducedMotion()) {
      if (horizontal) this.scroll.scrollLeft += delta;
      else this.scroll.scrollTop += delta;
      return;
    }
    this.wheelScrollPending += delta;
    if (!this.wheelScrollFrame) {
      this.wheelScrollLastTime = 0;
      this.wheelScrollFrame = requestAnimationFrame((time) => this.stepWheelScroll(time));
    }
  }

  stepWheelScroll(time) {
    this.wheelScrollFrame = 0;
    const horizontal = isHorizontalReadingOrder(this.readingOrder);
    if (!this.isContinuous() || !horizontal) {
      this.wheelScrollPending = 0;
      this.wheelScrollLastTime = 0;
      return;
    }
    if (Math.abs(this.wheelScrollPending) < WHEEL_SCROLL_EPSILON) {
      this.wheelScrollPending = 0;
      this.wheelScrollLastTime = 0;
      return;
    }
    const elapsed = this.wheelScrollLastTime
      ? clamp(time - this.wheelScrollLastTime, 1, 32)
      : 16.67;
    this.wheelScrollLastTime = time;
    const portion = 1 - Math.exp(-elapsed / WHEEL_SCROLL_TAU_MS);
    const step = this.wheelScrollPending * portion;
    this.wheelScrollPending -= step;
    const before = this.scroll.scrollLeft;
    this.scroll.scrollLeft += step;
    // Drop remaining momentum at the end of the strip instead of spinning RAFs.
    if (this.scroll.scrollLeft === before) {
      this.wheelScrollPending = 0;
      this.wheelScrollLastTime = 0;
      return;
    }
    this.wheelScrollFrame = requestAnimationFrame((nextTime) => this.stepWheelScroll(nextTime));
  }

  // Absolute scroll to a target page index (used by wheel stepping and by
  // click/keyboard page turns). Also remembers the wheel target index.
  scrollToIndex(index, smooth) {
    if (index < 0 || index >= this.pages.length) return;
    const { horizontal } = this.layout;
    const target = Math.max(0, this.pageCenterOffset(index));
    if (horizontal) this.scrollTo(target, this.scroll.scrollTop, smooth);
    else this.scrollTo(this.scroll.scrollLeft, target, smooth);
  }

  // Rendered scroll offset that centres a page. The leading transform pad
  // cancels the half-viewport term, so it is just the fit centre * zoom.
  pageCenterOffset(index) {
    const { horizontal } = this.layout;
    const pos = this.slotPosition(index);
    const center = horizontal
      ? pos.left + this.pages[index].width / 2
      : pos.top + this.pages[index].height / 2;
    return center * (this.zoom || 1);
  }

  // rAF-coalesced window refresh driven by scroll. Deliberately avoids layout
  // reads (page-zone widths are only refreshed on pointer move / at rest) and
  // coalesces the Peek-scroll sync to one write per frame.
  scheduleWindow() {
    if (this.windowFrame) return;
    this.windowFrame = requestAnimationFrame(() => {
      this.windowFrame = 0;
      if (!this.isOpen()) return;
      this.updateCurrentFromScroll({ scheduleWindow: false });
      this.syncScrollMirror();
      this.mountWindow();
      this.pumpDecode();
      this.updatePeekMask();
      this.applyScrollOpacity();
    });
  }

  onScroll() {
    this.isScrolling = true;
    this.root.classList.add('is-scrolling');
    clearTimeout(this.scrollIdleTimer);
    this.scrollIdleTimer = setTimeout(() => this.finishScrollActivity(), SCROLL_IDLE_MS);
    this.scheduleWindow();
  }

  finishScrollActivity() {
    clearTimeout(this.scrollIdleTimer);
    this.scrollIdleTimer = 0;
    if (!this.isScrolling) return;
    this.isScrolling = false;
    this.root.classList.remove('is-scrolling');
    this.pumpDecode();
    this.maybeReleasePageStep();
  }

  mountPage(slot) {
    const element = slot.element;
    const pageEntry = slot.entry;
    const token = this.stripToken;
    // Every mounted page is hidden until it has decoded, then fades in, so no
    // progressive/partial decode is ever visible. Slider-seek targets skip the
    // fade (but still wait for decode).
    const fadeIn = this.shouldFadePageOnLoad(pageEntry);
    element.className = fadeIn ? 'reader-page is-loading' : 'reader-page';
    element.dataset.readerPage = '';
    element.dataset.page = String(pageEntry.page);
    element.classList.toggle('is-current', pageEntry === this.entry);
    element.style.opacity = '';
    element.style.visibility = '';
    element.style.transition = this.readingMode === 'focus' && !this.pageAnimation ? 'none' : '';
    const base = document.createElement('img');
    base.className = 'reader-page-image';
    base.dataset.readerPageImage = '';
    base.alt = '';
    base.draggable = false;
    base.decoding = 'async';
    base.loading = 'eager';
    base.fetchPriority = pageEntry === this.entry ? 'high' : slot.prefetch ? 'low' : 'auto';
    base.src = getImageUrl(this.episodeId, pageEntry.index, pageEntry.file.assetKey);
    element.replaceChildren(base);
    slot.type = 'page';
    this.applySlotSize(slot);
    this.mountPeek(slot);
    const key = `${this.episodeId}:${pageEntry.index}`;
    // Reveal on the next frame so the `is-loading` (opacity 0) state is committed
    // first and the fade always plays (a cached image can decode before the first
    // paint, which would otherwise skip the transition).
    const reveal = () => { if (fadeIn) requestAnimationFrame(() => element.classList.remove('is-loading')); };
    const handleLoaded = () => {
      if (token !== this.stripToken) return;
      const width = base.naturalWidth || 0;
      const height = base.naturalHeight || 0;
      if (width && height) {
        this.aspectCache.set(key, width / height);
        if (!this.naturalCache.has(key)) this.naturalCache.set(key, { width, height });
      }
      // Current page first, then visible, then prefetch.
      this.queueDecode(base, fadeIn ? 0 : (slot.prefetch ? 2 : 1), reveal, slot);
      this.settleLoad(token);
    };
    const handleError = () => {
      if (token !== this.stripToken) return;
      element.classList.remove('is-loading');
      this.settleLoad(token);
    };
    this.pendingLoads += 1;
    if (base.complete && base.naturalWidth) {
      handleLoaded();
    } else {
      base.addEventListener('load', handleLoaded, { once: true });
      base.addEventListener('error', handleError, { once: true });
    }
  }

  // Track in-flight image loads so the next page turn is only accepted once the
  // next page has both loaded and decoded.
  settleLoad(token = this.stripToken) {
    if (token !== this.stripToken) return;
    this.pendingLoads -= 1;
    this.maybeReleasePageStep();
  }

  mountSpan(slot) {
    const element = slot.element;
    element.className = 'reader-span';
    element.removeAttribute('data-reader-page');
    element.removeAttribute('data-page');
    element.removeAttribute('title');
    element.style.opacity = '';
    element.style.visibility = '';
    element.replaceChildren();
    slot.type = 'span';
    this.applySlotSize(slot);
    this.clearPeekSlot(slot);
  }

  mountPeek(slot, peekEntryOverride) {
    const peekElement = slot.peekElement;
    const token = this.stripToken;
    const peekEntry = peekEntryOverride !== undefined
      ? peekEntryOverride
      : this.resolvePeekTarget(slot.entry).entry;
    // Idempotent: the window sync and mountPage can both call this, and Peek
    // trimming toggles it repeatedly. Never recreate an image that is already
    // showing the same entry (that would restart the decode).
    if (peekEntry) {
      const key = `${peekEntry.variant}:${peekEntry.page}`;
      // Idempotent by key + content only: the className also carries `is-current`,
      // so comparing it here would clobber that class on every window refresh.
      if (slot.peekKey === key && peekElement.firstElementChild) return;
      slot.peekKey = key;
      const fadeIn = this.shouldFadePageOnLoad(slot.entry);
      // Toggle classes instead of assigning className: `is-current` drives
      // single/focus visibility, and a wholesale className write would drop it,
      // hiding the current page's Peek layer after a target switch.
      peekElement.classList.remove('reader-peek-page', 'reader-peek-span', 'is-loading');
      peekElement.classList.add('reader-peek-page');
      if (fadeIn) peekElement.classList.add('is-loading');
      peekElement.classList.toggle('is-current', slot.entry === this.entry);
      peekElement.style.transition = this.readingMode === 'focus' && !this.pageAnimation ? 'none' : '';
      const image = document.createElement('img');
      image.className = 'reader-peek-image';
      image.alt = '';
      image.draggable = false;
      image.decoding = 'async';
      image.loading = 'eager';
      image.fetchPriority = slot.entry === this.entry ? 'high' : slot.prefetch ? 'low' : 'auto';
      image.src = getImageUrl(this.episodeId, peekEntry.index, peekEntry.file.assetKey);
      // Reveal on the next frame so the `is-loading` (opacity 0) state is
      // committed first and the fade transition always plays. Only the current
      // page fades; pages scrolling into view appear immediately.
      const reveal = () => { if (fadeIn) requestAnimationFrame(() => peekElement.classList.remove('is-loading')); };
      const handleLoaded = () => {
        if (token !== this.stripToken) return;
        this.queueDecode(image, fadeIn ? 0 : (slot.prefetch ? 2 : 1), reveal, slot);
        this.settleLoad(token);
      };
      const handleError = () => {
        if (token !== this.stripToken) return;
        peekElement.classList.remove('is-loading');
        this.settleLoad(token);
      };
      this.pendingLoads += 1;
      if (image.complete && image.naturalWidth) handleLoaded();
      else {
        image.addEventListener('load', handleLoaded, { once: true });
        image.addEventListener('error', handleError, { once: true });
      }
      peekElement.replaceChildren(image);
    } else {
      if (slot.peekKey === null && !peekElement.firstElementChild && peekElement.classList.contains('reader-peek-span')) return;
      slot.peekKey = null;
      peekElement.className = 'reader-peek-span';
      peekElement.replaceChildren();
    }
  }

  // Point the Peek layer at a specific variant (for the middle-click buffer).
  setPeekVariant(variant) {
    this.peekVariant = variant ?? null;
    for (const slot of this.pages) {
      if (slot.type !== 'page') {
        this.clearPeekSlot(slot);
        continue;
      }
      const entry = variant
        ? findPageEntry(this.model, variant, slot.entry.page)
          ?? findNearestPageEntry(this.model, variant, slot.entry.page)
        : null;
      this.mountPeek(slot, entry);
    }
  }

  clearPeekSlot(slot) {
    slot.peekKey = null;
    slot.peekElement.className = 'reader-peek-span';
    slot.peekElement.replaceChildren();
  }

  applySlotSize(slot) {
    // Fit-unit tile size (natural * baseFitScale). `zoom` is a plane transform,
    // so this never changes while zooming; only fit/resize/mode changes redo it.
    const scale = this.baseFitScale || 1;
    let baseWidth;
    let baseHeight;
    if (this.naturalWidth && this.naturalHeight) {
      baseWidth = this.naturalWidth;
      baseHeight = this.naturalHeight;
    } else {
      const aspect = this.variantAspect || DEFAULT_ASPECT;
      baseHeight = 1000;
      baseWidth = baseHeight * aspect;
    }
    const width = Math.max(1, Math.round(baseWidth * scale));
    const height = Math.max(1, Math.round(baseHeight * scale));
    slot.width = width;
    slot.height = height;
    slot.element.style.width = `${width}px`;
    slot.element.style.height = `${height}px`;
    slot.peekElement.style.width = `${width}px`;
    slot.peekElement.style.height = `${height}px`;
  }

  applyAllSizes() {
    for (const slot of this.pages) this.applySlotSize(slot);
    this.computeLayout();
    this.applyViewTransform();
    this.setupPeekTimeline();
  }

  layoutPages() {
    this.applyAllSizes();
  }

  resetPageStyles() {
    for (const slot of this.pages) {
      slot.element.style.opacity = '';
      slot.element.style.visibility = '';
      slot.peekElement.style.opacity = '';
      slot.peekElement.style.visibility = '';
    }
  }

  pageFor(entry) {
    return this.pages.find((slot) => slot.entry === entry) ?? null;
  }

  applyModeVisibility() {
    for (const slot of this.pages) {
      const current = slot.entry === this.entry;
      slot.element.classList.toggle('is-current', current);
      slot.peekElement.classList.toggle('is-current', current);
    }
  }

  updateHeaderForEntry() {
    const peek = this.resolvePeekTarget(this.entry);
    this.updateHeader(peek.variant, peek.entry);
  }

  applyModeLayout(entry, animate = false) {
    if (!entry) return;
    this.baseFitScale = this.computeFitScale();
    this.applyAllSizes();
    this.refreshWindow();
    this.centerOn(entry, animate);
  }

  computeFitScale() {
    const width = this.naturalWidth || 1;
    const height = this.naturalHeight || 1;
    const viewportWidth = this.viewport.clientWidth;
    const viewportHeight = this.viewport.clientHeight;
    if (this.isContinuous() && this.pageFit === 'fill') {
      return isHorizontalReadingOrder(this.readingOrder)
        ? viewportHeight / height
        : viewportWidth / width;
    }
    return Math.min(viewportWidth / width, viewportHeight / height);
  }

  async setCurrentEntry(entry, { animate = false, recenter = true, preload = true } = {}) {
    if (!entry) return;
    const previous = this.entry;
    if (previous === entry) return;
    // Wait for the target image to decode before revealing it, so page turns
    // never flash a blank page. Seeking (slider drag) can skip this.
    if (recenter && preload) {
      await this.preloadTarget(entry);
      if (this.entry !== previous || !this.isOpen()) return;
    }
    this.entry = entry;
    this.refreshWindow();
    // The slider-seek target is mounted; clear its no-fade marker.
    this.noFadeEntry = null;
    const previousSlot = this.pageFor(previous);
    if (previousSlot) {
      previousSlot.element.classList.remove('is-current');
      previousSlot.peekElement.classList.remove('is-current');
    }
    const nextSlot = this.pageFor(entry);
    if (nextSlot) {
      nextSlot.element.classList.add('is-current');
      nextSlot.peekElement.classList.add('is-current');
    }
    this.updateHeaderForEntry();
    if (!recenter) return;
    const shouldAnimate = animate && this.pageAnimation && !this.prefersReducedMotion();
    // Cap the slide distance: turns farther than a couple of pages cross-fade
    // in place instead of sliding across the whole strip.
    const previousIndex = previousSlot?.index ?? -1;
    const nextIndex = nextSlot?.index ?? -1;
    const withinSlideDistance = previousIndex < 0 || nextIndex < 0 || Math.abs(nextIndex - previousIndex) <= 2;
    const shouldSlide = shouldAnimate && withinSlideDistance;
    // While a turn animates, the scroll position passes through the previous
    // page; ignore scroll-derived current updates so the header/progress/Peek do
    // not flip back and forth (which reads as a flash).
    if (shouldAnimate) {
      this.suppressCurrentUntil = performance.now() + 800;
      // Defer mounting/loading until the turn (scroll + fade) ends.
      this.scrollStepActive = true;
    }
    // Single mode fades through `applyScrollOpacity()`, so a turn is just a
    // smooth scroll; the other modes center directly.
    this.centerOn(entry, shouldSlide);
  }

  // Mount the target page (if it is still a placeholder) and wait until its
  // image has decoded, so the following reveal is never blank.
  preloadTarget(entry) {
    const slot = this.pageFor(entry);
    if (!slot) return Promise.resolve();
    slot.prefetch = false;
    if (slot.type !== 'page') this.mountPage(slot);
    const image = slot.element.querySelector('[data-reader-page-image]');
    if (image) image.fetchPriority = 'high';
    return this.waitForDecode(image);
  }

  waitForDecode(image) {
    if (!image) return Promise.resolve();
    const decode = () => {
      const queued = this.decodeQueue.find((job) => job.image === image);
      if (queued) {
        queued.priority = 0;
        queued.priorityBoost = true;
        this.decodeQueue.sort((a, b) => a.priority - b.priority);
        this.pumpDecode();
        return queued.promise;
      }
      return this.decodeImage(image);
    };
    if (image.complete && image.naturalWidth) return decode();
    return new Promise((resolve) => {
      image.addEventListener('load', () => decode().then(resolve), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  }

  // Warm the browser cache for a page we are about to switch to (cross-episode,
  // variant switch) and remember its aspect so the rebuilt strip sizes it
  // correctly before the image decodes.
  preloadEntryImage(entry) {
    if (!entry) return Promise.resolve();
    const key = `${this.episodeId}:${entry.index}`;
    if (this.aspectCache.has(key)) return Promise.resolve();
    const image = new Image();
    image.decoding = 'async';
    return new Promise((resolve) => {
      image.onload = () => {
        const width = image.naturalWidth || 0;
        const height = image.naturalHeight || 0;
        if (width && height) {
          this.aspectCache.set(key, width / height);
          this.naturalCache.set(key, { width, height });
        }
        resolve();
      };
      image.onerror = () => resolve();
      image.src = getImageUrl(this.episodeId, entry.index, entry.file.assetKey);
    });
  }

  centerOn(entry, animate = false) {
    const record = this.pageFor(entry);
    if (!record || !record.width) return;
    if (!this.layout) this.computeLayout();
    this.scrollToIndex(record.index, animate);
  }

  // Track the current page from the scroll position in every mode, so header,
  // Peek and single/focus visibility all follow native scrolling.
  updateCurrentFromScroll({ scheduleWindow = true } = {}) {
    if (!this.pages.length || !this.layout) return;
    if (performance.now() < this.suppressCurrentUntil) return;
    const index = this.indexAtViewportCenter();
    if (index < 0) return;
    const entry = this.pages[index].entry;
    if (entry === this.entry) return;
    const previousSlot = this.pageFor(this.entry);
    this.entry = entry;
    previousSlot?.element.classList.remove('is-current');
    previousSlot?.peekElement.classList.remove('is-current');
    const nextSlot = this.pages[index];
    nextSlot.element.classList.add('is-current');
    nextSlot.peekElement.classList.add('is-current');
    // Coalesce the virtual window refresh with scrolling (or zoom); avoid doing
    // the same mount/layout work synchronously at every page edge.
    if (scheduleWindow) this.scheduleWindow();
    this.updateHeaderForEntry();
  }

  // Content-axis position of the viewport centre (fit units), then the nearest
  // page centre. The leading transform pad cancels the half-viewport term, so
  // the centre is simply scrollOffset / zoom.
  indexAtViewportCenter() {
    const { horizontal, dir, total } = this.layout;
    const scrollOffset = horizontal ? this.scroll.scrollLeft : this.scroll.scrollTop;
    const s = scrollOffset / (this.zoom || 1);
    return this.findNearestIndex(dir < 0 ? total - s : s);
  }

  // ------------------------------------------------- single-mode cross-fade

  // Single mode cross-fades the outgoing and incoming pages by how far each is
  // from the viewport centre. The opacity is a pure function of the scroll
  // position, so dragging, wheel/keyboard scrolling and programmatic turns all
  // look identical and never drift out of sync with the native scroll.
  applyScrollOpacity() {
    if (this.readingMode !== 'single' || !this.layout || !this.pages.length) {
      this.clearPageAlpha();
      return;
    }
    const { horizontal, dir, offsets, sizes, total } = this.layout;
    const scrollOffset = horizontal ? this.scroll.scrollLeft : this.scroll.scrollTop;
    const play = scrollOffset / (this.zoom || 1);
    const playAligned = dir < 0 ? total - play : play;
    const [start, end] = this.mountedRange ?? this.visibleRange();
    for (let index = start; index < end; index += 1) {
      const slot = this.pages[index];
      if (!slot || (!slot.element.parentNode && !slot.peekElement.parentNode)) continue;
      const size = sizes[index] || (horizontal ? slot.width : slot.height) || 1;
      const distance = Math.abs(offsets[index] + size / 2 - playAligned);
      this.setPageAlpha(slot, clamp(1 - distance / (size + LAYOUT_GAP), 0, 1));
    }
  }

  setPageAlpha(slot, alpha) {
    const value = Math.round(alpha * 1000) / 1000;
    if (slot.alpha === value) return;
    slot.alpha = value;
    slot.element.style.setProperty('--reader-page-alpha', String(value));
    slot.peekElement.style.setProperty('--reader-page-alpha', String(value));
  }

  clearPageAlpha() {
    for (const slot of this.pages) {
      if (slot.alpha === undefined) continue;
      slot.alpha = undefined;
      slot.element.style.removeProperty('--reader-page-alpha');
      slot.peekElement.style.removeProperty('--reader-page-alpha');
    }
  }

  // ---------------------------------------------------------------- nav

  goToEntry(entry, { animate = false, preload = true } = {}) {
    if (!entry) return;
    this.setCurrentEntry(entry, { animate, recenter: true, preload });
  }

  async movePage(direction) {
    const step = Math.sign(direction) || 1;
    const adjacent = getAdjacentEntry(this.model, this.entry.variant, this.entry.page, step);
    if (adjacent) {
      this.goToEntry(adjacent, { animate: true });
      return true;
    }
    const sequence = this.getSequence(this.episodeId);
    const episodeIndex = sequence.indexOf(this.episodeId);
    const nextEpisodeId = sequence[episodeIndex + step];
    if (!nextEpisodeId) return false;
    const episode = this.getEpisode(nextEpisodeId);
    const model = createEpisodeReaderModel(episode);
    const variant = model.variants.has(this.entry.variant) ? this.entry.variant : model.variantNames[0];
    const pages = model.variants.get(variant) ?? [];
    const entry = step > 0 ? pages[0] : pages.at(-1);
    if (!entry) return false;
    this.episodeId = nextEpisodeId;
    this.model = model;
    await this.preloadEntryImage(entry);
    this.renderStrip(entry);
    // A cross-episode strip rebuild does not scroll, so release the turn here.
    this.releasePageStep();
    return true;
  }

  async switchVariant(variant) {
    const entry = findPageEntry(this.model, variant, this.entry.page)
      ?? findNearestPageEntry(this.model, variant, this.entry.page);
    if (!entry) return;
    await this.preloadEntryImage(entry);
    this.crossfadeVariant(variant, entry);
  }

  // Switch the base variant without rebuilding the strip: the old image stays in
  // place until the new one has decoded and faded in.
  crossfadeVariant(variant, currentTarget) {
    const model = this.model;
    const targetFor = (slot) => findPageEntry(model, variant, slot.entry.page)
      ?? findNearestPageEntry(model, variant, slot.entry.page);
    const switched = this.pages.filter((slot) => slot.type !== 'page');
    for (const slot of switched) {
      const next = targetFor(slot);
      if (!next) continue;
      slot.entry = next;
      if (slot.element.dataset) slot.element.dataset.page = String(next.page);
    }
    const animated = this.pages.filter((slot) => slot.type === 'page');
    let pending = animated.length;
    const finish = () => {
      if (this.entry === currentTarget) return;
      this.entry = currentTarget;
      this.peekVariant = this.resolvePeekTarget(this.entry).variant ?? null;
      this.peekRange = null;
      this.refreshWindow();
      this.updateHeaderForEntry();
    };
    if (!pending) { finish(); return; }
    for (const slot of animated) {
      const next = targetFor(slot);
      if (!next) { pending -= 1; continue; }
      const oldImage = slot.element.querySelector('[data-reader-page-image]');
      const image = document.createElement('img');
      image.className = 'reader-page-image reader-page-fade';
      image.dataset.readerPageImage = '';
      image.alt = '';
      image.draggable = false;
      image.decoding = 'async';
      image.loading = 'eager';
      image.fetchPriority = 'high';
      image.src = getImageUrl(this.episodeId, next.index, next.file.assetKey);
      image.style.opacity = '0';
      image.style.transition = `opacity ${TIMING_MS}ms ease`;
      slot.element.append(image);
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        image.removeEventListener('transitionend', onTransitionEnd);
        oldImage?.remove();
        image.classList.remove('reader-page-fade');
        image.style.opacity = '';
        image.style.transition = '';
        slot.entry = next;
        if (slot.element.dataset) slot.element.dataset.page = String(next.page);
        pending -= 1;
        if (!pending) finish();
      };
      const onTransitionEnd = (transitionEvent) => {
        if (transitionEvent.target === image && transitionEvent.propertyName === 'opacity') cleanup();
      };
      const settle = () => {
        requestAnimationFrame(() => { image.style.opacity = '1'; });
        // Clean up when the new image's opacity transition actually finishes
        // (fallback in case no transition end fires, e.g. reduced motion).
        image.addEventListener('transitionend', onTransitionEnd);
        // Wait one frame so the CSSTransition exists, then resolve on its real
        // completion; a hard-coded timer would remove the old image while a
        // slowed-down animation (DevTools playback rate) is still running.
        requestAnimationFrame(() => {
          const animations = image.getAnimations?.() ?? [];
          if (!animations.length) {
            cleanup();
            return;
          }
          Promise.allSettled(animations.map((animation) => animation.finished)).then(cleanup);
        });
      };
      const decode = () => this.decodeImage(image).then(settle);
      if (image.complete && image.naturalWidth) decode();
      else {
        image.addEventListener('load', decode, { once: true });
        image.addEventListener('error', settle, { once: true });
      }
    }
  }

  // Slider seek: jump immediately with no animation and no decode wait, so the
  // user can drag to locate a page quickly.
  // Slider seek: no animation, and wait for the target to decode before
  // switching (so there is no blank frame); the target is mounted while it is
  // not yet current, so it does not fade in.
  openPage(index) {
    const pages = this.currentPages();
    const entry = pages[clamp(Math.round(Number(index) || 0), 0, Math.max(0, pages.length - 1))];
    if (entry && entry !== this.entry) {
      // Slider seek: wait for decode, switch immediately, no fade.
      this.noFadeEntry = entry;
      this.goToEntry(entry, { animate: false, preload: true });
    }
  }

  async openCollectionEpisode(index) {
    const collection = this.getCollection?.(this.episodeId);
    const nextEpisodeId = collection?.episodes?.[index];
    const episode = nextEpisodeId ? this.getEpisode(nextEpisodeId) : null;
    if (!episode || nextEpisodeId === this.episodeId) return;
    const model = createEpisodeReaderModel(episode);
    const variant = model.variants.has(this.entry.variant) ? this.entry.variant : model.variantNames[0];
    const entry = model.variants.get(variant)?.[0];
    if (!entry) return;
    this.episodeId = nextEpisodeId;
    this.model = model;
    await this.preloadEntryImage(entry);
    this.renderStrip(entry);
  }

  cycleVariant() {
    if (this.peekTransitionStage) return;
    const variants = this.model?.variantNames ?? [];
    if (variants.length < 2) return;
    const peekTarget = this.resolvePeekTarget(this.entry);
    if (peekTarget.entry) {
      this.transitionToVariant(peekTarget.entry);
      return;
    }
    if (!peekTarget.variant && !this.isPeekTargetExplicitlyDisabled()) {
      const firstEntry = findPageEntry(this.model, variants[0], this.entry.page)
        ?? findNearestPageEntry(this.model, variants[0], this.entry.page);
      if (firstEntry && firstEntry !== this.entry) this.transitionToVariant(firstEntry);
    }
  }

  isPeekTargetExplicitlyDisabled(entry = this.entry) {
    if (!entry || !this.model) return false;
    const override = this.getPeekTargetOverride(entry);
    if (override !== undefined) return override === null;
    return Object.hasOwn(this.model.peekRelations ?? {}, entry.variant)
      && this.model.peekRelations[entry.variant] === null;
  }

  // Middle-click variant switch: expand the Peek circle to reveal the next
  // variant, commit it as the base, then shrink back. The buffer for the NEXT
  // middle-click is the Peek target if one exists, otherwise it wraps to the
  // first variant - so the previous variant is only discarded when it is not
  // that buffer.
  async transitionToVariant(targetEntry) {
    if (this.peekTransitionStage || !targetEntry) return;
    const targetVariant = targetEntry.variant;
    const oldBaseVariant = this.entry.variant;
    const buffer = getPeekTargetVariant(this.model, targetVariant) ?? this.model.variantNames[0];
    const retainOldBase = buffer === oldBaseVariant;

    // Ensure the Peek layer holds the target variant so the expand reveals it.
    if (this.peekVariant !== targetVariant) {
      this.setPeekVariant(targetVariant);
      await this.waitForPeekDecode();
    }

    const sourceEpisodeId = this.episodeId;
    this.endPeekPress({ releaseCapture: true });
    this.peekTransitionStage = 'expanding';
    // The whole middle-click transition shows the Peek layer fully opaque; it
    // settles back to the configured opacity in finishPeekTransition.
    this.peekForceOpaque = true;
    this.root.classList.add('is-peek-transitioning');
    this.syncPeekInteractionState();
    this.updatePeekMask();
    await this.animatePeekRadius(this.getPeekCoverRadius(), this.peekDuration(PEEK_EXPAND_MS));
    if (!this.isOpen() || this.peekTransitionStage !== 'expanding') return this.cancelPeekTransition();
    await this.preloadEntryImage(targetEntry);
    if (sourceEpisodeId !== this.episodeId || !this.isOpen() || this.peekTransitionStage !== 'expanding') {
      return this.cancelPeekTransition();
    }

    // Promote the base to the target variant, retaining the old base if it will
    // be needed for the wrap-back (i.e. when the target's Peek target is empty).
    let retained = null;
    if (retainOldBase) {
      retained = this.promoteRetaining(targetVariant);
      if (!retained) {
        this.finishPeekTransition();
        return;
      }
    } else if (!this.swapBaseToVariant(targetVariant)) {
      this.finishPeekTransition();
      return;
    }

    await this.nextPaint();
    if (!this.isOpen() || this.peekTransitionStage !== 'expanding') return this.cancelPeekTransition();
    await this.hideTransitionOverlay();
    if (!this.isOpen() || this.peekTransitionStage !== 'resetting') return this.cancelPeekTransition();

    if (retainOldBase) {
      // Only now, after the Peek layer is hidden, move the retained old base
      // into it - otherwise the still-expanded Peek would flash back to A.
      for (const { slot, image } of retained) {
        image.className = 'reader-peek-image';
        image.removeAttribute('data-reader-page-image');
        slot.peekElement.replaceChildren(image);
      }
      this.peekVariant = oldBaseVariant;
    } else {
      this.setPeekVariant(buffer);
    }
    this.applyModeVisibility();
    this.updateHeaderForEntry();
    await this.nextPaint();
    if (!this.isOpen() || this.peekTransitionStage !== 'resetting') return this.cancelPeekTransition();
    await this.revealLoadedPeek();
  }

  waitForPeekDecode() {
    if (!this.peekPlane) return Promise.resolve();
    const images = [...this.peekPlane.querySelectorAll('.reader-peek-image')];
    return Promise.all(images.map((image) => this.waitForDecode(image)));
  }

  // Promote the base to the target variant, extracting the previous variant's
  // decoded images (returned) so the caller can install them into the Peek
  // layer once it is hidden.
  promoteRetaining(targetVariant) {
    const model = this.model;
    const currentTarget = findPageEntry(model, targetVariant, this.entry.page)
      ?? findNearestPageEntry(model, targetVariant, this.entry.page);
    if (!currentTarget) return null;
    const retained = [];
    for (const slot of this.pages) {
      const target = findPageEntry(model, targetVariant, slot.entry.page)
        ?? findNearestPageEntry(model, targetVariant, slot.entry.page);
      if (!target) continue;
      slot.entry = target;
      slot.element.dataset.page = String(target.page);
      if (slot.type === 'page') {
        const oldImage = slot.element.querySelector('[data-reader-page-image]');
        const base = document.createElement('img');
        base.className = 'reader-page-image';
        base.dataset.readerPageImage = '';
        base.alt = '';
        base.draggable = false;
        base.decoding = 'async';
        base.loading = 'eager';
        base.src = getImageUrl(this.episodeId, target.index, target.file.assetKey);
        slot.element.replaceChildren(base);
        if (oldImage) retained.push({ slot, image: oldImage });
        slot.element.classList.remove('is-loading');
      }
    }
    this.entry = currentTarget;
    return retained;
  }

  // Swap each slot's entry and base image to the target variant without
  // rebuilding the DOM, so the previous page stays visible (no blank flash).
  swapBaseToVariant(targetVariant) {
    const model = this.model;
    const currentTarget = findPageEntry(model, targetVariant, this.entry.page)
      ?? findNearestPageEntry(model, targetVariant, this.entry.page);
    if (!currentTarget) return false;
    for (const slot of this.pages) {
      const target = findPageEntry(model, targetVariant, slot.entry.page)
        ?? findNearestPageEntry(model, targetVariant, slot.entry.page);
      if (!target) continue;
      slot.entry = target;
      slot.element.dataset.page = String(target.page);
      if (slot.type === 'page') {
        const base = slot.element.querySelector('[data-reader-page-image]');
        if (base) {
          base.classList.remove('is-loading');
          base.src = getImageUrl(this.episodeId, target.index, target.file.assetKey);
        }
      }
    }
    this.entry = currentTarget;
    return true;
  }

  getPeekCoverRadius() {
    const rect = this.viewport.getBoundingClientRect();
    const { x, y } = this.pointer;
    return Math.max(
      Math.hypot(x, y),
      Math.hypot(rect.width - x, y),
      Math.hypot(x, rect.height - y),
      Math.hypot(rect.width - x, rect.height - y)
    ) + this.peekFeather + 2;
  }

  async hideTransitionOverlay() {
    this.peekTransitionStage = 'resetting';
    // The expand phase is over: the shrink-back reveal must use the configured
    // Peek opacity again instead of the forced 100% of the expansion.
    this.peekForceOpaque = false;
    this.peekPlane.style.transition = 'none';
    this.updatePeekMask();
    await this.nextPaint();
  }

  async revealLoadedPeek() {
    this.peekRadiusTarget = this.peekRadius;
    if (!this.peekEnabled || !this.currentPeekEntry()) {
      this.peekRadiusCurrent = this.peekRadius;
      this.finishPeekTransition();
      return;
    }
    this.peekRadiusCurrent = 0;
    this.peekTransitionStage = 'revealing';
    // Collapse to zero instantly while the layer is hidden, then grow from zero
    // at the configured opacity.
    this.peekPlane.style.transition = 'none';
    this.updatePeekMask();
    await this.nextPaint();
    if (!this.isOpen() || this.peekTransitionStage !== 'revealing') return this.cancelPeekTransition();
    this.peekTransitionStage = 'settling';
    this.peekPlane.style.removeProperty('transition');
    this.updatePeekMask();
    await this.animatePeekRadius(this.peekRadius, this.peekDuration(PEEK_REVEAL_MS));
    if (!this.isOpen() || this.peekTransitionStage !== 'settling') return this.cancelPeekTransition();
    this.finishPeekTransition();
  }

  finishPeekTransition() {
    this.peekPlane.style.removeProperty('transition');
    this.peekTransitionStage = null;
    this.peekForceOpaque = false;
    this.root.classList.remove('is-peek-transitioning');
    this.syncPeekInteractionState();
    this.updatePeekMask();
  }

  // Drop any in-flight Peek transition without animating. Called when the strip
  // is rebuilt (page/episode change) and from every aborted transition step, so
  // an interrupted middle-click can never leave Peek permanently disabled.
  cancelPeekTransition() {
    if (!this.peekTransitionStage) return;
    this.peekTransitionStage = null;
    this.peekForceOpaque = false;
    this.peekPlane?.style.removeProperty('transition');
    this.root.classList.remove('is-peek-transitioning');
    this.syncPeekInteractionState();
    this.updatePeekMask();
  }

  nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  // ---------------------------------------------------------------- transform

  fit() {
    this.cancelZoomAnimation();
    this.zoom = 1;
    this.layoutPages();
    this.applyModeLayout(this.entry, false);
  }

  zoomAt(factor, clientX, clientY) {
    this.zoomTo((this.zoom || 1) * factor, clientX, clientY);
  }

  // Set zoom immediately while keeping the content point under the cursor (both
  // axes) fixed. Works for anchors from buttons, wheel, or a pinch midpoint.
  zoomTo(nextZoom, clientX, clientY) {
    const oldZoom = this.zoom || 1;
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (!zoom || zoom === oldZoom) return;
    const rect = this.viewport.getBoundingClientRect();
    const localX = (clientX == null ? rect.left + rect.width / 2 : clientX) - rect.left;
    const localY = (clientY == null ? rect.top + rect.height / 2 : clientY) - rect.top;
    const horizontal = isHorizontalReadingOrder(this.readingOrder);
    const axisPad = (horizontal ? this.scroll.clientWidth : this.scroll.clientHeight) / 2;
    const axisLocal = horizontal ? localX : localY;
    const crossLocal = horizontal ? localY : localX;
    const axisScroll = horizontal ? this.scroll.scrollLeft : this.scroll.scrollTop;
    const crossScroll = horizontal ? this.scroll.scrollTop : this.scroll.scrollLeft;
    const crossPad = this.crossPadFor(oldZoom);
    // Rendered content coordinates under the cursor, kept fixed across the zoom.
    const axisAnchor = axisScroll + axisLocal - axisPad;
    const crossAnchor = crossScroll + crossLocal - crossPad;
    const k = zoom / oldZoom;
    this.zoom = zoom;
    this.suppressSnapUntil = performance.now() + 200;
    this.applyViewTransform();
    const nextCrossPad = this.crossPadFor(zoom);
    const nextAxis = axisPad + axisAnchor * k - axisLocal;
    const nextCross = nextCrossPad + crossAnchor * k - crossLocal;
    if (horizontal) {
      this.scroll.scrollLeft = nextAxis;
      this.scroll.scrollTop = nextCross;
    } else {
      this.scroll.scrollTop = nextAxis;
      this.scroll.scrollLeft = nextCross;
    }
    this.syncScrollMirror();
    this.refreshWindow();
    this.updateCurrentFromScroll();
  }

  // Wheel/pinch zoom eases toward an accumulated target instead of stepping
  // abruptly, so Ctrl+wheel (and trackpad pinch) feels continuous.
  queueZoom(factor, clientX, clientY) {
    if (clientX != null && clientY != null) this.zoomAnchor = { x: clientX, y: clientY };
    const base = this.zoomTarget ?? this.zoom ?? 1;
    this.zoomTarget = clamp(base * factor, MIN_ZOOM, MAX_ZOOM);
    if (!this.zoomFrame) {
      this.zoomScrollLastTime = 0;
      this.zoomFrame = requestAnimationFrame((time) => this.stepZoom(time));
    }
  }

  stepZoom(time) {
    this.zoomFrame = 0;
    const target = this.zoomTarget ?? this.zoom;
    const current = this.zoom || 1;
    const difference = target - current;
    if (Math.abs(difference) < ZOOM_EPSILON) {
      this.zoomTarget = null;
      return;
    }
    if (this.prefersReducedMotion()) {
      this.zoomTo(target, this.zoomAnchor?.x, this.zoomAnchor?.y);
      this.zoomTarget = null;
      return;
    }
    const elapsed = this.zoomScrollLastTime
      ? clamp(time - this.zoomScrollLastTime, 1, 32)
      : 16.67;
    this.zoomScrollLastTime = time;
    const portion = 1 - Math.exp(-elapsed / ZOOM_TAU_MS);
    const step = difference * portion;
    const next = Math.abs(step) > Math.abs(difference) ? target : current + step;
    this.zoomTo(next, this.zoomAnchor?.x, this.zoomAnchor?.y);
    this.zoomFrame = requestAnimationFrame((nextTime) => this.stepZoom(nextTime));
  }

  cancelZoomAnimation() {
    cancelAnimationFrame(this.zoomFrame);
    this.zoomFrame = 0;
    this.zoomTarget = null;
  }

  // ---------------------------------------------------------------- peek

  currentPeekEntry() {
    return this.resolvePeekTarget(this.entry).entry;
  }

  updatePeekMask() {
    if (!this.peekPlane) return;
    const style = this.peekPlane.style;
    const visibleTransition = this.peekTransitionStage === 'expanding'
      || this.peekTransitionStage === 'wrapping'
      || this.peekTransitionStage === 'settling';
    const hiddenTransition = this.peekTransitionStage === 'resetting'
      || this.peekTransitionStage === 'revealing';
    const available = visibleTransition
      || (this.peekEnabled && !!this.currentPeekEntry() && !hiddenTransition);
    this.peekVisible = available;
    // The Peek content may have just become visible while the scroll did not
    // move; make sure the mirror is written before the mask fades in.
    if (available) this.syncScrollMirror();
    // The mask layer is viewport-sized, so the circle centre, radius and feather
    // are expressed directly in viewport-local pixels as CSS variables. The mask
    // itself is static CSS; only the variables change, which lets `--peek-radius`
    // animate through a CSS transition (sharing the engine's animation timeline).
    // Snap to device pixels so the moving/growing edge does not shimmer.
    const dpr = globalThis.devicePixelRatio || 1;
    const snap = (value) => Math.round(value * dpr) / dpr;
    style.setProperty('--peek-x', `${snap(this.pointer.x)}px`);
    style.setProperty('--peek-y', `${snap(this.pointer.y)}px`);
    style.setProperty('--peek-feather', `${Math.max(0, this.peekFeather)}px`);
    const radiusValue = Number.isFinite(this.peekRadiusCurrent) ? this.peekRadiusCurrent : this.peekRadius;
    const radius = Math.max(0, radiusValue);
    style.setProperty('--peek-radius', `${snap(radius)}px`);
    if (!available) {
      if (this.peekMaskOpacity !== '0') {
        style.opacity = '0';
        this.peekMaskOpacity = '0';
      }
      return;
    }
    // A semi-transparent Peek is the configured hover look; pressing the left
    // mouse button (or the expand phase of the middle-click transition) restores
    // full opacity for a moment, so the reveal is instantly readable.
    const opaque = this.peekPressPointerId != null || this.peekForceOpaque;
    const opacity = opaque ? '1' : String(this.peekOpacity / 100);
    if (this.peekMaskOpacity !== opacity) {
      style.opacity = opacity;
      this.peekMaskOpacity = opacity;
    }
  }

  // Coalesce pointer-driven updates to one per frame. A high-polling mouse fires
  // many pointermove events per frame; without this each one runs a layout read
  // (page zones) and rebuilds the mask.
  schedulePointerUpdate(clientX) {
    if (Number.isFinite(clientX)) this.pendingZoneX = clientX;
    if (this.pointerUpdateFrame) return;
    this.pointerUpdateFrame = requestAnimationFrame(() => {
      this.pointerUpdateFrame = 0;
      if (Number.isFinite(this.pendingZoneX)) this.updatePageZone(this.pendingZoneX);
      this.updatePeekMask();
    });
  }

  peekDuration(baseDuration) {
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
    return Math.round(baseDuration * 100 / this.peekAnimationSpeed);
  }

  // The Peek layer's opacity fade must follow the configured animation speed
  // too, otherwise reveal/hide would finish long before the radius/opacity
  // animation it is paired with (or vice versa).
  syncPeekFadeDuration() {
    this.root.style.setProperty('--peek-fade-duration', `${this.peekDuration(TIMING_MS)}ms`);
  }

  prefersReducedMotion() {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  // Direct radius update with no CSS transition, used while fingers track the
  // Peek circle (a transition would visibly lag the gesture).
  setPeekRadius(value) {
    this.peekAnimationResolve?.();
    this.peekAnimationResolve = null;
    this.peekRadiusCurrent = value;
    this.peekRadiusTarget = value;
    const plane = this.peekPlane;
    if (!plane) return;
    plane.style.setProperty('--peek-radius-duration', '0ms');
    this.updatePeekMask();
  }

  animatePeekRadius(target, duration = this.peekDuration(PEEK_RELEASE_MS)) {
    // A new target supersedes any in-flight radius wait.
    this.peekAnimationResolve?.();
    this.peekAnimationResolve = null;
    this.peekRadiusCurrent = target;
    this.peekRadiusTarget = target;
    const plane = this.peekPlane;
    if (!plane) return Promise.resolve();
    // The radius animates through CSS so it shares the engine timeline with the
    // opacity fade (and therefore scales with DevTools slow-motion).
    plane.style.setProperty('--peek-radius-duration', duration > 0 ? `${duration}ms` : '0ms');
    this.updatePeekMask();
    if (duration <= 0) return Promise.resolve();
    return this.waitForPeekRadius();
  }

  // Resolve when the radius transition actually ends. `getAnimations()` reports
  // the engine's real timeline, so a slowed-down animation is awaited correctly
  // instead of being cut off by a hard-coded duration.
  waitForPeekRadius() {
    return new Promise((resolve) => {
      const plane = this.peekPlane;
      if (!plane) { resolve(); return; }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        plane.removeEventListener('transitionend', onEnd);
        if (this.peekAnimationResolve === finish) this.peekAnimationResolve = null;
        resolve();
      };
      const onEnd = (event) => {
        if (event.target === plane && String(event.propertyName).includes('peek-radius')) finish();
      };
      plane.addEventListener('transitionend', onEnd);
      this.peekAnimationResolve = finish;
      this.nextPaint().then(() => {
        if (settled) return;
        const animations = (plane.getAnimations?.() ?? [])
          .filter((animation) => String(animation.transitionProperty ?? '').includes('peek-radius'));
        if (!animations.length) { finish(); return; }
        Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
      });
    });
  }

  beginPeekPress(pointerId) {
    this.peekPressPointerId = pointerId;
    clearTimeout(this.cursorTimer);
    this.root.classList.add('is-peek-pressing', 'is-cursor-hidden');
  }

  endPeekPress({ animateRadius = false, releaseCapture = false } = {}) {
    const pointerId = this.peekPressPointerId;
    this.peekPressPointerId = null;
    this.root.classList.remove('is-peek-pressing');

    if (releaseCapture && pointerId != null && this.viewport.hasPointerCapture?.(pointerId)) {
      try {
        this.viewport.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }

    if (pointerId == null || this.peekTransitionStage) return false;
    if (animateRadius) {
      this.animatePeekRadius(this.peekRadius, this.peekDuration(PEEK_RELEASE_MS));
    } else {
      this.peekAnimationResolve?.();
      this.peekAnimationResolve = null;
      this.peekRadiusCurrent = this.peekRadius;
      this.peekRadiusTarget = this.peekRadius;
      // Restore instantly (no radius transition) when the press is abandoned.
      this.peekPlane?.style.setProperty('--peek-radius-duration', '0ms');
      this.updatePeekMask();
    }
    return true;
  }

  isPeekInteractive() {
    return this.peekEnabled && !!this.currentPeekEntry() && !this.peekTransitionStage;
  }

  setPeekEnabled(enabled) {
    if (this.peekTransitionStage) return;
    if (!enabled) this.endPeekPress({ releaseCapture: true });
    this.peekEnabled = enabled;
    this.peekButton.classList.toggle('is-active', enabled);
    this.syncPeekInteractionState();
    this.updatePeekMask();
  }

  onSpace() {
    this.setPeekEnabled(!this.peekEnabled);
  }

  // Modality follows the actual input device, so viewport/device-metric changes
  // can never make the reader flip between mouse and touch behaviour.
  markInputModality(pointerType) {
    const isTouch = pointerType !== 'mouse';
    if (isTouch === this.touchMode) return;
    this.touchMode = isTouch;
    if (!isTouch && this.peekPressPointerId == null) {
      this.peekRadiusCurrent = this.peekRadius;
      this.peekRadiusTarget = this.peekRadius;
      this.updatePeekMask();
    }
  }

  syncPeekInteractionState() {
    const interactive = this.isPeekInteractive();
    this.peekButton.setAttribute('aria-pressed', String(this.peekEnabled));
    this.root.classList.toggle('is-peek-interactive', interactive);
    if (this.peekPressPointerId != null || (interactive && !this.pageZoneDirection)) {
      clearTimeout(this.cursorTimer);
      this.root.classList.add('is-cursor-hidden');
    } else {
      this.root.classList.remove('is-cursor-hidden');
    }
  }

  // ---------------------------------------------------------------- pointer

  onWheel(event) {
    const horizontal = isHorizontalReadingOrder(this.readingOrder);
    const axisSize = horizontal ? this.scroll.clientWidth : this.scroll.clientHeight;
    if (this.isContinuous()) {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const pixels = this.wheelDeltaPixels(event, axisSize);
        this.queueZoom(this.zoomFactorForWheel(pixels), event.clientX, event.clientY);
        return;
      }
      // Keep native vertical scrolling and precision-touchpad horizontal input.
      // A vertical wheel has no horizontal native axis, so map its accumulated
      // delta to a short ease; the browser exposes no API to synthesize native
      // horizontal-wheel momentum from vertical input.
      if (!horizontal) return;
      if (event.deltaMode === 0 && Math.abs(event.deltaX) > Math.abs(event.deltaY) && event.deltaX !== 0) return;
      event.preventDefault();
      const delta = this.wheelDeltaPixels(event, axisSize);
      if (!delta) return;
      const direction = this.readingOrder === 'rtl' ? -1 : 1;
      this.queueWheelScroll(direction * delta);
      return;
    }
    event.preventDefault();
    const intent = getWheelIntent(event);
    if (intent.mode === 'zoom') {
      const pixels = this.wheelDeltaPixels(event, axisSize);
      this.queueZoom(this.zoomFactorForWheel(pixels), event.clientX, event.clientY);
      return;
    }
    const delta = this.wheelDeltaPixels(event, axisSize);
    clearTimeout(this.wheelResetTimer);
    this.wheelAccumulator += delta;
    // One page per notch. The gesture stays "active" until the wheel is idle for
    // a moment, so trackpad momentum cannot trigger a second turn after the
    // first one's scroll ends.
    this.wheelGestureActive = true;
    if (!this.pageStepLocked && Math.abs(this.wheelAccumulator) >= PAGE_TURN_WHEEL_THRESHOLD) {
      const direction = Math.sign(this.wheelAccumulator);
      this.wheelAccumulator = 0;
      this.stepPage(direction, 'wheel');
    }
    this.wheelResetTimer = setTimeout(() => {
      this.wheelAccumulator = 0;
      this.wheelGestureActive = false;
      this.maybeReleasePageStep();
    }, WHEEL_GESTURE_IDLE_MS);
  }

  // Convert a wheel event to a pixel delta along the dominant axis, applying the
  // same deltaMode conversion to `deltaX` and `deltaY`.
  wheelDeltaPixels(event, axisSize) {
    let delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (event.deltaMode === 1) delta *= PX_PER_LINE;
    else if (event.deltaMode === 2) delta *= axisSize;
    return delta;
  }

  // Zoom factor for one wheel/pinch event: a discrete notch (mouse wheel) steps
  // by a fixed ratio, continuous deltas (trackpad/pinch) accumulate per pixel.
  zoomFactorForWheel(pixels) {
    if (!pixels) return 1;
    if (Math.abs(pixels) >= ZOOM_NOTCH_MIN_PIXELS) {
      return pixels > 0 ? 1 / ZOOM_NOTCH_FACTOR : ZOOM_NOTCH_FACTOR;
    }
    return Math.exp(-pixels * ZOOM_WHEEL_SENSITIVITY);
  }

  // ------------------------------------------------------------- page stepping

  // The single entry point for every relative page turn (wheel, keyboard, edge
  // zones, taps, trackpad). Only one turn is in flight at a time; further
  // requests are ignored until it settles.
  stepPage(direction, source = '') {
    const step = Math.sign(direction) || 0;
    if (!step || !this.isOpen() || this.pageStepLocked || this.peekTransitionStage) return false;
    this.beginPageStep();
    Promise.resolve(this.movePage(step, source)).then((moved) => {
      if (moved === false) this.releasePageStep();
    });
    return true;
  }

  beginPageStep() {
    this.pageStepLocked = true;
    clearTimeout(this.pageStepLockTimer);
    // Fallback for engines/paths where scrollend never fires.
    this.pageStepLockTimer = setTimeout(() => this.releasePageStep(), PAGE_STEP_FALLBACK_MS);
  }

  releasePageStep() {
    this.pageStepLocked = false;
    clearTimeout(this.pageStepLockTimer);
    this.pageStepLockTimer = 0;
  }

  maybeReleasePageStep() {
    if (!this.pageStepLocked || this.scrollStepActive || this.wheelGestureActive || this.drag) return;
    if (this.decodeActive === 0 && this.decodeQueue.length === 0 && this.pendingLoads === 0) this.releasePageStep();
  }

  onScrollEnd() {
    clearTimeout(this.scrollIdleTimer);
    this.scrollIdleTimer = 0;
    this.isScrolling = false;
    this.root.classList.remove('is-scrolling');
    // Scroll finished: now mount/load the pages the new position needs, then
    // release the turn once decoding drains.
    this.scrollStepActive = false;
    this.mountWindow();
    this.pumpDecode();
    this.maybeReleasePageStep();
    this.applyScrollOpacity();
    // Re-arm the page-edge cues only after the scroll has settled.
    this.updatePageZone();
    this.syncScrollMirror();
    // Free scrolls settle onto the nearest page, but never mid-gesture: a mouse
    // drag pauses between moves, and a finger may rest while the scroll idles.
    if (!this.drag && this.touchPoints.size === 0) this.snapToNearest();
  }

  // Align to the nearest page after a free scroll (native touch pan or mouse
  // drag). A tiny dead zone avoids re-issuing a smooth scroll when the position
  // is already centred (e.g. after a programmatic turn).
  snapToNearest() {
    if (this.isContinuous() || !this.layout || !this.pages.length) return;
    if (performance.now() < this.suppressSnapUntil) return;
    const index = this.indexAtViewportCenter();
    if (index < 0) return;
    const { horizontal } = this.layout;
    const offset = horizontal ? this.scroll.scrollLeft : this.scroll.scrollTop;
    if (Math.abs(offset - this.pageCenterOffset(index)) <= 1) return;
    this.scrollToIndex(index, true);
  }

  onPointerDown(event) {
    this.suppressClick = false;
    this.cancelZoomAnimation();
    this.markInputModality(event.pointerType);
    if (event.pointerType === 'touch') {
      this.touchMode = true;
      this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touchPoints.size === 1) {
        this.touchGesture = null;
        this.touchPinch = null;
        this.touchPeekStartDistance = 0;
        this.touchPeekSpread = false;
        // Snap modes also track a tap; continuous mode leaves single-finger
        // panning entirely to the native scroller.
        if (!this.isContinuous()) {
          this.touchGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, swiping: false };
          if (this.peekEnabled) this.animatePeekRadius(0, this.peekDuration(PEEK_TOUCH_HIDE_MS));
        }
      } else {
        // Second finger: Peek when enabled, otherwise pinch-zoom. Single-finger
        // panning stays available through `touch-action` in every mode.
        this.touchGesture = null;
        if (this.peekEnabled) {
          this.touchPeek = true;
          this.touchPinch = null;
          this.touchPeekStartDistance = this.touchPinchState()?.distance ?? 0;
          this.touchPeekSpread = false;
          this.updateTouchPeek();
        } else {
          this.touchPeek = false;
          this.touchPinch = this.touchPinchState();
        }
      }
      return;
    }
    if (event.button === 1) {
      event.preventDefault();
      this.pointer = this.toViewportPoint(event.clientX, event.clientY);
      this.hasPointerPosition = true;
      this.cycleVariant();
      return;
    }
    if (event.button !== 0) return;
    this.pointer = this.toViewportPoint(event.clientX, event.clientY);
    this.hasPointerPosition = true;
    this.viewport.setPointerCapture(event.pointerId);
    const pageDirection = this.getPageZoneDirection(event.clientX);
    if (pageDirection) {
      this.pageTurnPointer = { pointerId: event.pointerId, direction: pageDirection, x: event.clientX, y: event.clientY, cancelled: false };
      this.updatePageZone(event.clientX);
      return;
    }
    this.pointerDown = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    if (this.isPeekInteractive()) {
      this.beginPeekPress(event.pointerId);
      this.animatePeekRadius(this.peekRadius * PEEK_PRESS_SCALE, this.peekDuration(PEEK_PRESS_MS));
    }
  }

  onPointerMove(event) {
    if (event.pointerType === 'touch') {
      if (this.touchPoints.has(event.pointerId)) {
        this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (this.touchPeek) {
          // Two fingers with Peek on: reveal; the native pan is suppressed.
          this.updateTouchPeek();
        } else if (!this.peekEnabled && this.touchPoints.size >= 2) {
          // Two fingers with Peek off: pinch-zoom, in any reading mode.
          this.updateTouchPinch();
        }
      }
      return;
    }
    this.notePointerActivity();
    this.pointer = this.toViewportPoint(event.clientX, event.clientY);
    this.hasPointerPosition = true;
    if (this.pointerDown && !this.pointerDown.moved) {
      const distance = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
      if (distance > DRAG_THRESHOLD) {
        this.pointerDown.moved = true;
        this.suppressClick = true;
        this.endPeekPress({ animateRadius: true });
        this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: this.scroll.scrollLeft, originY: this.scroll.scrollTop };
        this.root.classList.add('is-dragging');
      }
    }
    if (this.drag?.pointerId === event.pointerId) {
      this.scroll.scrollLeft = this.drag.originX + this.drag.x - event.clientX;
      this.scroll.scrollTop = this.drag.originY + this.drag.y - event.clientY;
      // Mirror in the same frame as the drag so Peek cannot lag the base layer.
      this.syncScrollMirror();
    }
    this.schedulePointerUpdate(event.clientX);
  }

  onPointerUp(event, cancelled = false) {
    if (event.pointerType === 'touch') {
      const hadPoint = this.touchPoints.delete(event.pointerId);
      if (!hadPoint) return;
      if (this.touchPeek) {
        if (this.touchPoints.size < 2) {
          this.touchPeek = false;
          this.touchPeekStartDistance = 0;
          this.touchPeekSpread = false;
          this.animatePeekRadius(0, this.peekDuration(PEEK_RELEASE_MS));
        }
        this.touchGesture = null;
        return;
      }
      if (this.touchPinch) {
        if (this.touchPoints.size < 2) this.touchPinch = null;
        this.touchGesture = null;
        return;
      }
      if (this.readingMode === 'continuous') {
        // Native scrolling; nothing to release.
        return;
      }
      const gesture = this.touchGesture;
      this.touchGesture = null;
      const tapped = !cancelled && gesture
        && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 12;
      if (tapped) {
        const page = this.pageAt?.(event.clientX, event.clientY) ?? null;
        if (page && page.entry !== this.entry) {
          this.goToEntry(page.entry, { animate: true });
        } else {
          const rect = this.viewport.getBoundingClientRect();
          if (isHorizontalReadingOrder(this.readingOrder)) {
            const ratio = (event.clientX - rect.left) / rect.width;
            if (ratio < 0.35) this.stepPage(getLogicalPageStep(this.readingOrder, -1), 'touch');
            else if (ratio > 0.65) this.stepPage(getLogicalPageStep(this.readingOrder, 1), 'touch');
            else this.root.classList.toggle('is-chrome-visible');
          } else {
            const ratio = (event.clientY - rect.top) / rect.height;
            if (ratio < 0.35) this.stepPage(-1, 'touch');
            else if (ratio > 0.65) this.stepPage(1, 'touch');
            else this.root.classList.toggle('is-chrome-visible');
          }
        }
      } else if (this.touchPoints.size === 0) {
        // A native pan just ended: settle onto the nearest page.
        this.snapToNearest();
      }
      return;
    }
    if (this.pageTurnPointer?.pointerId === event.pointerId) {
      const pointer = this.pageTurnPointer;
      const distance = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y);
      const direction = this.getPageZoneDirection(event.clientX);
      this.pageTurnPointer = null;
      this.updatePageZone(event.clientX);
      if (!cancelled && !pointer.cancelled && distance <= 8 && direction === pointer.direction) {
        this.suppressClick = true;
        this.stepPage(getLogicalPageStep(this.readingOrder, pointer.direction), 'zone');
      }
      return;
    }
    const pointerDown = this.pointerDown;
    this.pointerDown = null;
    if (this.drag?.pointerId === event.pointerId) {
      this.drag = null;
      this.root.classList.remove('is-dragging');
      this.snapToNearest();
    } else if (pointerDown && !pointerDown.moved && !cancelled && this.readingMode !== 'continuous') {
      this.activatePageAt(event.clientX, event.clientY);
    }
    if (this.peekPressPointerId === event.pointerId) {
      this.endPeekPress({ animateRadius: true });
    }
  }

  pageAt(clientX, clientY) {
    const element = globalThis.document?.elementFromPoint?.(clientX, clientY) ?? null;
    const host = element?.closest?.('[data-reader-page]') ?? null;
    if (!host) return null;
    return this.pages.find((record) => record.element === host) ?? null;
  }

  activatePageAt(clientX, clientY) {
    const page = this.pageAt(clientX, clientY);
    if (page && page.entry !== this.entry) this.goToEntry(page.entry, { animate: true });
  }

  updateTouchPeek() {
    if (!this.peekEnabled || this.touchPoints.size < 2) return;
    const [a, b] = [...this.touchPoints.values()];
    this.pointer = this.toViewportPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
    this.hasPointerPosition = true;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    // Spreading the fingers past a threshold commits the Peek target, i.e. the
    // same action as the middle mouse button. Try once per gesture.
    if (!this.touchPeekSpread && this.touchPeekStartDistance > 0) {
      const grown = distance >= this.touchPeekStartDistance * PEEK_SPREAD_RATIO
        && distance - this.touchPeekStartDistance >= PEEK_SPREAD_MIN_PX;
      if (grown) {
        this.touchPeekSpread = true;
        this.touchPeek = false;
        this.cycleVariant();
        return;
      }
    }
    // Track the fingers directly: a CSS transition would lag behind the gesture.
    this.setPeekRadius(distance / 2);
  }

  // Two-finger pinch (only when Peek is disabled): the finger-distance ratio
  // drives the same `zoomAt()` as the trackpad/buttons, anchored at the midpoint.
  touchPinchState() {
    const points = [...this.touchPoints.values()];
    if (points.length < 2) return null;
    const [a, b] = points;
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
  }

  updateTouchPinch() {
    if (this.peekEnabled || this.touchPoints.size < 2) return;
    const state = this.touchPinchState();
    const previous = this.touchPinch;
    this.touchPinch = state;
    if (!state || !previous?.distance || !state.distance) return;
    this.zoomAt(state.distance / previous.distance, state.x, state.y);
  }

  onLostPointerCapture(event) {
    if (event.pointerType === 'touch' && this.touchPoints.has(event.pointerId)) {
      this.onPointerUp(event, true);
      return;
    }
    if (this.touchGesture?.pointerId === event.pointerId) this.touchGesture = null;
    if (this.peekPressPointerId === event.pointerId) this.endPeekPress({ animateRadius: true });
    if (this.pageTurnPointer?.pointerId === event.pointerId) {
      this.pageTurnPointer = null;
      this.updatePageZone(event.clientX);
    }
    if (this.drag?.pointerId === event.pointerId) {
      this.drag = null;
      this.root.classList.remove('is-dragging');
      this.snapToNearest();
    }
    if (this.pointerDown?.pointerId === event.pointerId) this.pointerDown = null;
  }

  toViewportPoint(clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  notePointerActivity() {
    if (this.peekPressPointerId != null) {
      clearTimeout(this.cursorTimer);
      this.root.classList.add('is-cursor-hidden');
      return;
    }
    if (this.fullscreenEdgeActive || this.root.classList.contains('is-chrome-visible')) {
      clearTimeout(this.cursorTimer);
      this.root.classList.remove('is-cursor-hidden');
      return;
    }
    if (this.pageZoneDirection) {
      clearTimeout(this.cursorTimer);
      this.root.classList.remove('is-cursor-hidden');
      return;
    }
    if (this.isPeekInteractive()) {
      this.root.classList.add('is-cursor-hidden');
      return;
    }
    this.root.classList.remove('is-cursor-hidden');
    clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(() => {
      if (this.isOpen() && !this.drag) this.root.classList.add('is-cursor-hidden');
    }, CURSOR_HIDE_MS);
  }

  // ---------------------------------------------------------------- page zones

  getPageZoneDirection(clientX) {
    if (this.readingMode !== 'single' || !isHorizontalReadingOrder(this.readingOrder)) return 0;
    const record = this.pageFor(this.entry);
    if (!record || !record.width) return 0;
    const viewportRect = this.viewport.getBoundingClientRect();
    const pageRect = record.element.getBoundingClientRect();
    if (pageRect.left > viewportRect.left + 1 && clientX < pageRect.left) return -1;
    if (pageRect.right < viewportRect.right - 1 && clientX > pageRect.right) return 1;
    return 0;
  }

  setPageZoneWidths(previousWidth, nextWidth) {
    this.root.style.setProperty('--reader-prev-zone-width', `${Math.max(0, previousWidth)}px`);
    this.root.style.setProperty('--reader-next-zone-width', `${Math.max(0, nextWidth)}px`);
  }

  updatePageZoneWidths() {
    // The edge cues are hidden while scrolling or dragging; skip the layout
    // reads (and the repaint they trigger) until the gesture settles.
    if (this.isScrolling || this.drag) {
      this.setPageZoneWidths(0, 0);
      return;
    }
    const record = this.pageFor(this.entry);
    if (this.readingMode !== 'single' || !isHorizontalReadingOrder(this.readingOrder) || !record || !record.width || !this.isOpen()) {
      this.setPageZoneWidths(0, 0);
      return;
    }
    const viewportRect = this.viewport.getBoundingClientRect();
    const pageRect = record.element.getBoundingClientRect();
    const previousWidth = pageRect.left > viewportRect.left + 1
      ? Math.min(viewportRect.width, pageRect.left - viewportRect.left)
      : 0;
    const nextWidth = pageRect.right < viewportRect.right - 1
      ? Math.min(viewportRect.width, viewportRect.right - pageRect.right)
      : 0;
    this.setPageZoneWidths(previousWidth, nextWidth);
  }

  updatePageZone(clientX) {
    if (this.isScrolling || this.drag) {
      this.pageZoneDirection = 0;
      this.root.classList.remove('is-page-zone-prev', 'is-page-zone-next');
      return;
    }
    this.updatePageZoneWidths();
    this.pageZoneDirection = this.getPageZoneDirection(clientX);
    this.root.classList.toggle('is-page-zone-prev', this.pageZoneDirection < 0);
    this.root.classList.toggle('is-page-zone-next', this.pageZoneDirection > 0);
    if (this.pageZoneDirection) {
      clearTimeout(this.cursorTimer);
      if (this.peekPressPointerId == null) this.root.classList.remove('is-cursor-hidden');
    }
  }

  // ---------------------------------------------------------------- header

  updateHeader(peekVariant, peekEntry) {
    const pages = this.currentPages();
    const pageIndex = pages.findIndex((candidate) => candidate === this.entry);
    this.title.textContent = this.getEpisode(this.episodeId)?.title ?? this.episodeId;
    this.meta.textContent = `${this.entry.variant.toUpperCase()} · ${pageIndex + 1} / ${pages.length}`;
    this.onPageProgress?.({ current: pageIndex + 1, total: pages.length });
    this.updateCollectionProgress();
    this.peekButton.disabled = !peekEntry;
    this.peekButton.classList.toggle('is-active', this.peekEnabled && !!peekEntry);
    this.peekButton.title = peekEntry ? t('revealVariant', { variant: peekVariant.toUpperCase() }) : t('noNextVariant');
    this.syncPeekInteractionState();
    this.renderVariants();
  }

  renderVariants() {
    const active = this.entry?.variant ?? '';
    const peekTargetOverride = this.getPeekTargetOverride();
    const defaultPeekTarget = active && this.model ? getPeekTargetVariant(this.model, active) : null;
    const peekTarget = active && this.model ? getPeekTargetVariant(this.model, active, peekTargetOverride) : null;
    this.onVariants?.({
      variants: this.model?.variantNames ?? [],
      active,
      peekTarget,
      defaultPeekTarget,
      peekTargetOverride
    });
  }

  async setPeekTarget(target = undefined) {
    if (!this.entry || !this.model || this.peekTransitionStage) return false;
    const key = this.peekOverrideKey();
    if (!key) return false;
    if (target === undefined) {
      this.peekTargetOverrides.delete(key);
    } else if (target === null) {
      this.peekTargetOverrides.set(key, null);
    } else {
      const normalized = String(target).trim().toLowerCase();
      if (normalized === this.entry.variant || !this.model.variants.has(normalized)) return false;
      this.peekTargetOverrides.set(key, normalized);
    }
    // Only the Peek layer changes; the base layer must not reload.
    this.peekVariant = this.resolvePeekTarget(this.entry).variant ?? null;
    this.setPeekVariant(this.peekVariant);
    this.applyModeVisibility();
    this.updateHeaderForEntry();
    return true;
  }

  updateCollectionProgress() {
    const collection = this.getCollection?.(this.episodeId);
    const position = getSequencePosition(collection?.episodes, this.episodeId);
    if (this.collectionCrumb) {
      this.collectionCrumb.textContent = collection?.title ?? '';
      this.collectionCrumb.hidden = !collection;
    }
    if (this.breadcrumbSeparator) this.breadcrumbSeparator.hidden = !collection;
    this.onCollectionProgress?.({
      current: position.current,
      total: position.total,
      label: collection?.title ?? '',
      hidden: !collection || position.total < 2
    });
  }

  preloadNeighbors() {
    const peekTarget = this.resolvePeekTarget();
    const candidates = [
      getAdjacentEntry(this.model, this.entry.variant, this.entry.page, -1),
      getAdjacentEntry(this.model, this.entry.variant, this.entry.page, 1),
      peekTarget.entry
    ].filter(Boolean);
    for (const entry of candidates) {
      const image = new Image();
      image.decoding = 'async';
      image.src = getImageUrl(this.episodeId, entry.index, entry.file.assetKey);
    }
  }

  // ---------------------------------------------------------------- fullscreen

  async toggleFullscreen() {
    if (this.fullscreenRequested && document.fullscreenElement === document.documentElement) {
      await document.exitFullscreen();
      return;
    }
    if (document.fullscreenElement) return;
    this.fullscreenRequested = true;
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      this.fullscreenRequested = false;
    }
  }

  onFullscreenChange() {
    const active = this.fullscreenRequested
      && document.fullscreenElement === document.documentElement
      && this.isOpen();
    this.root.classList.toggle('is-fullscreen', active);
    this.root.classList.remove('is-chrome-visible');
    this.fullscreenEdgeActive = false;
    clearTimeout(this.fullscreenChromeTimer);
    if (!active) this.fullscreenRequested = false;
    this.scheduleFitAfterFullscreenLayout();
  }

  onFullscreenPointerMove(event) {
    if (event.pointerType === 'touch') return;
    if (!this.root.classList.contains('is-fullscreen')) return;
    const rect = this.root.getBoundingClientRect();
    const overChrome = event.composedPath().some((element) => (
      element?.matches?.('.reader-bar, .reader-progress-row, .reader-tag-fab')
    ));
    const edgeThreshold = 72;
    const nearEdge = overChrome
      || event.clientX - rect.left <= edgeThreshold
      || rect.right - event.clientX <= edgeThreshold
      || event.clientY - rect.top <= edgeThreshold
      || rect.bottom - event.clientY <= edgeThreshold;
    this.fullscreenEdgeActive = nearEdge;
    clearTimeout(this.fullscreenChromeTimer);
    if (nearEdge) {
      this.root.classList.add('is-chrome-visible');
      clearTimeout(this.cursorTimer);
      if (this.peekPressPointerId == null) this.root.classList.remove('is-cursor-hidden');
      return;
    }
    this.fullscreenChromeTimer = setTimeout(() => {
      if (!this.fullscreenEdgeActive) {
        this.root.classList.remove('is-chrome-visible');
        this.notePointerActivity();
      }
    }, FULLSCREEN_CHROME_MS);
  }

  scheduleFitAfterFullscreenLayout() {
    cancelAnimationFrame(this.fullscreenFitFrame);
    this.fullscreenFitFrame = requestAnimationFrame(() => {
      this.fullscreenFitFrame = requestAnimationFrame(() => {
        this.fullscreenFitFrame = 0;
        if (this.isOpen()) this.fit();
      });
    });
  }

  // ---------------------------------------------------------------- keyboard

  onKeyDown(event) {
    if (!this.isOpen()) return;
    const eventPath = event.composedPath?.() ?? [event.target];
    if (eventPath.some((element) => (
      element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element?.matches?.('md-slider, [role="slider"]')
    ))) return;
    const variants = this.model.variantNames;
    const variantIndex = variants.indexOf(this.entry.variant);
    const previousVariant = () => this.switchVariant(variants[Math.max(0, variantIndex - 1)]);
    const nextVariant = () => this.switchVariant(variants[Math.min(variants.length - 1, variantIndex + 1)]);
    const baseActions = {
      PageUp: () => this.stepPage(-1, 'keyboard'),
      PageDown: () => this.stepPage(1, 'keyboard'),
      '0': () => this.fit(),
      '=': () => this.zoomAt(1.25),
      '+': () => this.zoomAt(1.25),
      '-': () => this.zoomAt(0.8),
      ' ': () => this.onSpace(),
      f: () => this.toggleFullscreen(),
      F: () => this.toggleFullscreen(),
      Escape: () => this.requestClose()
    };
    const actions = isHorizontalReadingOrder(this.readingOrder)
      ? {
          ...baseActions,
          ArrowLeft: () => this.stepPage(getLogicalPageStep(this.readingOrder, -1), 'keyboard'),
          ArrowRight: () => this.stepPage(getLogicalPageStep(this.readingOrder, 1), 'keyboard'),
          ArrowUp: previousVariant,
          ArrowDown: nextVariant
        }
      : {
          ...baseActions,
          ArrowUp: () => this.stepPage(-1, 'keyboard'),
          ArrowDown: () => this.stepPage(1, 'keyboard'),
          ArrowLeft: previousVariant,
          ArrowRight: nextVariant
        };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }
}
