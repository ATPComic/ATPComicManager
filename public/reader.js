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
const DRAG_THRESHOLD = 6;
// Gap between pages along the reading axis. Must match .reader-plane's old gap.
const LAYOUT_GAP = 8;
// Unified timing for fade animations and scroll step spacing.
const TIMING_MS = 250;

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
    // content. Zoom is baked into the tile layout (see displayScale) so the
    // scroll extent always matches what is rendered.
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
    this.root.style.setProperty('--peek-fade-duration', `${TIMING_MS}ms`);
    this.peekRadiusCurrent = this.touchMode ? 0 : this.peekRadius;
    this.peekRadiusTarget = this.touchMode ? 0 : this.peekRadius;
    this.peekAnimationFrame = 0;
    this.peekAnimationResolve = null;
    this.peekTransitionStage = null;
    this.peekPlane = null;
    this.peekTrack = null;
    this.peekVariant = null;
    // Coalescing/caching so a high-polling pointer (or a pan/zoom, where the
    // mask is unchanged) never re-rasterizes the mask more than once per frame.
    this.peekMaskFrame = 0;
    this.peekMaskString = '';
    this.peekMaskOpacity = '';
    this.peekVisible = false;
    this.peekRange = null;
    this.pointerUpdateFrame = 0;
    this.pendingZoneX = null;
    // Peek offset is driven by a CSS scroll timeline (compositor). `useScrollTimeline`
    // gates the JS fallback for engines without scroll-driven animations.
    this.useScrollTimeline = typeof CSS !== 'undefined'
      && !!CSS.supports?.('animation-timeline: scroll()')
      && !!CSS.supports?.('timeline-scope: --reader-peek');
    this.cursorTimer = 0;
    this.pointer = { x: 0, y: 0 };
    this.hasPointerPosition = false;
    // Native-scroll navigation state. displayScale = fitScale * zoom is baked
    // into page sizes and offsets; the scroller supplies the camera offset.
    this.zoom = 1;
    this.displayScale = 1;
    this.baseFitScale = 1;
    this.windowFrame = 0;
    this.scrollMirrorFrame = 0;
    // Cumulative layout: page offsets/sizes along the reading axis. The native
    // scroller supplies the camera offset, so no window-origin bookkeeping is
    // needed any more. See computeLayout.
    this.layout = null;
    this.contentCross = 0;
    this.axisPad = 0;
    this.mountedRange = null;
    this.positionsDirty = true;
    this.drag = null;
    this.pointerDown = null;
    this.suppressClick = false;
    this.pageTurnPointer = null;
    this.touchGesture = null;
    this.touchPoints = new Map();
    this.touchPeek = false;
    this.touchMode = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (this.touchMode) this.peekRadiusCurrent = this.peekRadiusTarget = 0;
    this.resizeFrame = 0;
    this.pageZoneDirection = 0;
    this.peekPressPointerId = null;
    this.wheelAccumulator = 0;
    this.wheelResetTimer = 0;
    this.wheelLocked = false;
    this.wheelLockTimer = 0;
    this.suppressCurrentUntil = 0;
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
    this.layout = null;
    this.mountedRange = null;
    this.positionsDirty = true;
    this.zoom = 1;
    this.displayScale = 1;
    this.baseFitScale = 1;
    this.peekMaskString = '';
    this.peekMaskOpacity = '';
    this.peekVisible = false;
    cancelAnimationFrame(this.peekMaskFrame);
    cancelAnimationFrame(this.pointerUpdateFrame);
    cancelAnimationFrame(this.windowFrame);
    this.peekMaskFrame = 0;
    this.pointerUpdateFrame = 0;
    this.windowFrame = 0;
    clearTimeout(this.cursorTimer);
    clearTimeout(this.fullscreenChromeTimer);
    clearTimeout(this.wheelResetTimer);
    clearTimeout(this.wheelLockTimer);
    this.wheelLocked = false;
    cancelAnimationFrame(this.fullscreenFitFrame);
    cancelAnimationFrame(this.peekAnimationFrame);
    this.peekAnimationResolve?.();
    this.peekAnimationResolve = null;
    this.peekRadiusCurrent = this.touchMode ? 0 : this.peekRadius;
    this.peekRadiusTarget = this.touchMode ? 0 : this.peekRadius;
    this.peekTransitionStage = null;
    this.root.classList.remove('is-cursor-hidden', 'is-dragging', 'is-fullscreen', 'is-chrome-visible');
    this.fullscreenEdgeActive = false;
    this.pageTurnPointer = null;
    this.pointerDown = null;
    this.drag = null;
    this.touchGesture = null;
    this.updatePageZone();
    this.touchPoints.clear();
    this.touchPeek = false;
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
    this.root.style.setProperty('--peek-fade-duration', `${TIMING_MS}ms`);
    if (this.peekPressPointerId == null && !this.peekTransitionStage) {
      this.peekRadiusCurrent = this.touchMode ? 0 : this.peekRadius;
      this.peekRadiusTarget = this.touchMode ? 0 : this.peekRadius;
    }
    const preferences = normalizeReaderPreferences(settings);
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
  }

  // ---------------------------------------------------------------- model

  currentPages() {
    return this.model?.variants.get(this.entry?.variant) ?? [];
  }

  resolvePeekTarget(entry = this.entry) {
    if (!entry || !this.model) return { variant: null, entry: null };
    return resolveModelPeekTarget(this.model, entry.variant, entry.page, this.getPeekTargetOverride(entry));
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
    this.stripToken += 1;
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
    this.peekMaskString = '';
    this.peekMaskOpacity = '';
    this.peekVisible = false;
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
    const viewportCross = horizontal
      ? (this.viewport?.clientHeight || 0)
      : (this.viewport?.clientWidth || 0);
    this.contentCross = Math.max(maxCross, viewportCross);
    const axisView = horizontal
      ? (this.scroll?.clientWidth || 0)
      : (this.scroll?.clientHeight || 0);
    // Half the viewport on both axis ends lets every page (including the first
    // and last) be scrolled to the center, which native scroll otherwise cannot.
    this.axisPad = axisView / 2;
    // total excludes the trailing gap; offsets stay 0-based and monotonic.
    const total = Math.max(0, cursor - LAYOUT_GAP);
    this.layout = { horizontal, dir: this.readingOrder === 'rtl' ? -1 : 1, offsets, sizes, total };
    // The scroll content must span the whole (scaled) strip so native scroll has
    // a correct extent even though only a few tiles are mounted.
    if (this.plane) {
      const axisExtent = total + this.axisPad * 2;
      const width = horizontal ? `${axisExtent}px` : `${this.contentCross}px`;
      const height = horizontal ? `${this.contentCross}px` : `${axisExtent}px`;
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

  // Content coordinate of a page (already includes displayScale); RTL mirrors
  // the axis so the next page sits to the left.
  slotPosition(index) {
    const { horizontal, dir, offsets, sizes, total } = this.layout;
    const slot = this.pages[index];
    const pad = this.axisPad || 0;
    if (horizontal) {
      const base = dir < 0 ? total - offsets[index] - sizes[index] : offsets[index];
      return { left: pad + base, top: (this.contentCross - slot.height) / 2 };
    }
    return { left: (this.contentCross - slot.width) / 2, top: pad + offsets[index] };
  }

  // Logical range [start, end) of pages that intersect the scroller viewport.
  visibleRange() {
    const n = this.pages.length;
    const { horizontal, dir, total } = this.layout;
    const scrollOffset = horizontal ? this.scroll.scrollLeft : this.scroll.scrollTop;
    const viewSize = horizontal ? this.scroll.clientWidth : this.scroll.clientHeight;
    const s = scrollOffset - (this.axisPad || 0);
    let lo;
    let hi;
    if (dir < 0) { lo = total - (s + viewSize); hi = total - s; }
    else { lo = s; hi = s + viewSize; }
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
    if (!this.layout) this.computeLayout();
    const center = this.currentIndex();
    if (center < 0) return;
    // Mount only the strictly visible pages, always including the current page.
    const [vStart, vEnd] = this.visibleRange();
    const start = Math.min(vStart, center);
    const end = Math.max(vEnd, center + 1);
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

  refreshWindow() {
    const center = this.currentIndex();
    if (center < 0) return;
    if (!this.layout) this.computeLayout();
    this.mountWindow();
    this.syncScrollMirror();
    this.updatePageZoneWidths();
    this.updatePeekMask();
  }

  // Keep the Peek scroller at the same offset as the base scroller. Because the
  // Peek content scrolls natively under a fixed mask, this does not re-raster
  // the mask (unlike moving a masked element with a transform).
  syncScrollMirror() {
    if (!this.peekVisible) return;
    if (!this.useScrollTimeline && this.peekMover) {
      this.peekMover.style.transform = `translate3d(${-this.scroll.scrollLeft}px, ${-this.scroll.scrollTop}px, 0)`;
    }
  }

  // Wire the Peek layer to the base scroller's scroll timelines (compositor) or
  // fall back to a JS transform. Both axes are mirrored so Peek stays aligned
  // when the image is zoomed past the viewport and the cross axis also scrolls.
  setupPeekTimeline() {
    if (!this.peekMover || !this.scroll) return;
    const maxX = Math.max(0, this.scroll.scrollWidth - this.scroll.clientWidth);
    const maxY = Math.max(0, this.scroll.scrollHeight - this.scroll.clientHeight);
    if (this.useScrollTimeline) {
      const timeline = '--reader-peek-x x, --reader-peek-y y';
      if (this.scroll.style.scrollTimeline !== timeline) this.scroll.style.scrollTimeline = timeline;
      this.peekMover.style.transform = '';
      // Percent translate is relative to the mover's own box, so size it to each
      // axis's scroll range.
      this.peekMover.style.width = `${maxX}px`;
      this.peekMover.style.height = `${maxY}px`;
      this.peekMover.classList.add('is-mirror');
    } else {
      this.peekMover.classList.remove('is-mirror');
    }
  }

  scrollTo(left, top, smooth) {
    const behavior = smooth && !this.prefersReducedMotion() ? 'smooth' : 'auto';
    this.scroll.scrollTo({ left, top, behavior });
  }

  // Absolute scroll to a target page index (used by wheel stepping and by
  // click/keyboard page turns). Also remembers the wheel target index.
  scrollToIndex(index, smooth) {
    if (index < 0 || index >= this.pages.length) return;
    const { horizontal } = this.layout;
    const viewSize = horizontal ? this.scroll.clientWidth : this.scroll.clientHeight;
    const pos = this.slotPosition(index);
    const center = horizontal ? pos.left + this.pages[index].width / 2 : pos.top + this.pages[index].height / 2;
    const target = Math.max(0, center - viewSize / 2);
    if (horizontal) this.scrollTo(target, this.scroll.scrollTop, smooth);
    else this.scrollTo(this.scroll.scrollLeft, target, smooth);
  }

  // rAF-coalesced window refresh driven by scroll. Deliberately avoids layout
  // reads (page-zone widths are only refreshed on pointer move / at rest) and
  // coalesces the Peek-scroll sync to one write per frame.
  scheduleWindow() {
    if (this.windowFrame) return;
    this.windowFrame = requestAnimationFrame(() => {
      this.windowFrame = 0;
      if (!this.isOpen()) return;
      this.syncScrollMirror();
      this.mountWindow();
      this.updatePeekMask();
    });
  }

  onScroll() {
    this.scheduleWindow();
    this.updateCurrentFromScroll();
  }

  mountPage(slot) {
    const element = slot.element;
    const pageEntry = slot.entry;
    // Only the current page fades in on load. A page that merely scrolls into
    // view (leading edge) must appear without a fade.
    const fadeIn = pageEntry === this.entry;
    element.className = fadeIn ? 'reader-page is-loading' : 'reader-page';
    element.dataset.readerPage = '';
    element.dataset.page = String(pageEntry.page);
    element.classList.toggle('is-current', fadeIn);
    element.style.opacity = '';
    element.style.visibility = '';
    const base = document.createElement('img');
    base.className = 'reader-page-image';
    base.dataset.readerPageImage = '';
    base.alt = '';
    base.draggable = false;
    base.decoding = 'async';
    base.loading = 'eager';
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
      const width = base.naturalWidth || 0;
      const height = base.naturalHeight || 0;
      if (width && height) {
        this.aspectCache.set(key, width / height);
        if (!this.naturalCache.has(key)) this.naturalCache.set(key, { width, height });
      }
      (base.decode ? base.decode() : Promise.resolve()).catch(() => {}).then(reveal);
    };
    if (base.complete && base.naturalWidth) {
      handleLoaded();
    } else {
      base.addEventListener('load', handleLoaded, { once: true });
      base.addEventListener('error', () => element.classList.remove('is-loading'), { once: true });
    }
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
      const fadeIn = slot.entry === this.entry;
      peekElement.className = fadeIn ? 'reader-peek-page is-loading' : 'reader-peek-page';
      const image = document.createElement('img');
      image.className = 'reader-peek-image';
      image.alt = '';
      image.draggable = false;
      image.decoding = 'async';
      image.loading = 'eager';
      image.src = getImageUrl(this.episodeId, peekEntry.index, peekEntry.file.assetKey);
      // Reveal on the next frame so the `is-loading` (opacity 0) state is
      // committed first and the fade transition always plays. Only the current
      // page fades; pages scrolling into view appear immediately.
      const reveal = () => { if (fadeIn) requestAnimationFrame(() => peekElement.classList.remove('is-loading')); };
      const handleLoaded = () => (image.decode ? image.decode() : Promise.resolve()).catch(() => {}).then(reveal);
      if (image.complete && image.naturalWidth) handleLoaded();
      else {
        image.addEventListener('load', handleLoaded, { once: true });
        image.addEventListener('error', () => peekElement.classList.remove('is-loading'), { once: true });
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
    // Zoom is baked into the layout: the tile's CSS size is natural * displayScale,
    // so the native scroller's extent always matches what is rendered.
    const scale = this.displayScale || 1;
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
    this.displayScale = this.baseFitScale * (this.zoom || 1);
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
    if (shouldAnimate) this.suppressCurrentUntil = performance.now() + 800;
    if (shouldAnimate && this.readingMode === 'single') {
      this.animatePageTurn(previous, entry, shouldSlide);
      return;
    }
    this.centerOn(entry, shouldSlide);
  }

  // Mount the target page (if it is still a placeholder) and wait until its
  // image has decoded, so the following reveal is never blank.
  preloadTarget(entry) {
    const slot = this.pageFor(entry);
    if (!slot) return Promise.resolve();
    if (slot.type !== 'page') this.mountPage(slot);
    const image = slot.element.querySelector('[data-reader-page-image]');
    return this.waitForDecode(image);
  }

  waitForDecode(image) {
    if (!image) return Promise.resolve();
    const decode = () => (image.decode ? image.decode() : Promise.resolve()).catch(() => {});
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

  // Page-turn animation: the strip slides to the next page while the previous
  // page fades out and the next page fades in. One switch controls the whole
  // effect; when disabled the turn is instant. Only the two involved pages are
  // revealed - off-window pages are not even mounted.
  animatePageTurn(previous, entry, slide = true) {
    const duration = TIMING_MS;
    const token = this.stripToken;
    const oldRecord = this.pageFor(previous);
    const newRecord = this.pageFor(entry);
    if (!oldRecord || !newRecord) {
      this.centerOn(entry, false);
      return;
    }
    // Larger jumps can land the previous page outside the mounted window; mount
    // it on demand so the fade still has both pages to work with.
    if (oldRecord.type !== 'page') this.mountPage(oldRecord);
    if (newRecord.type !== 'page') this.mountPage(newRecord);
    for (const record of [oldRecord, newRecord]) {
      this.ensureAttached(record);
      if (this.layout) this.setSlotPosition(record, record.index);
    }
    this.root.classList.add('is-turning');
    for (const record of [oldRecord, newRecord]) {
      for (const element of [record.element, record.peekElement]) {
        element.style.transition = 'none';
        element.style.visibility = 'visible';
        // Promote just the two involved pages so the cross-fade stays on the
        // compositor instead of repainting the strip each frame.
        element.style.willChange = 'opacity';
      }
    }
    // Cross-fade the base AND Peek layers together, otherwise the masked Peek
    // page would switch instantly while the base fades.
    oldRecord.element.style.opacity = '1';
    newRecord.element.style.opacity = '0';
    oldRecord.peekElement.style.opacity = '1';
    newRecord.peekElement.style.opacity = '0';
    this.centerOn(entry, slide);
    requestAnimationFrame(() => {
      if (token !== this.stripToken) return;
      const easing = `opacity ${duration}ms cubic-bezier(.2, .7, .2, 1)`;
      for (const record of [oldRecord, newRecord]) {
        record.element.style.transition = easing;
        record.peekElement.style.transition = easing;
      }
      oldRecord.element.style.opacity = '0';
      newRecord.element.style.opacity = '1';
      oldRecord.peekElement.style.opacity = '0';
      newRecord.peekElement.style.opacity = '1';
    });
    window.setTimeout(() => {
      if (token !== this.stripToken) return;
      this.root.classList.remove('is-turning');
      for (const record of [oldRecord, newRecord]) {
        for (const element of [record.element, record.peekElement]) {
          element.style.willChange = '';
          element.style.transition = '';
        }
      }
      this.resetPageStyles();
      // The turn may have attached pages outside the window; force a full pass
      // so they are released again.
      this.mountedRange = null;
      this.refreshWindow();
    }, duration + 60);
  }

  centerOn(entry, animate = false) {
    const record = this.pageFor(entry);
    if (!record || !record.width) return;
    if (!this.layout) this.computeLayout();
    this.scrollToIndex(record.index, animate);
  }

  // Continuous-mode free scroll: smooth-scroll by the wheel delta.
  scrollBy(dx, dy) {
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    const behavior = this.prefersReducedMotion() ? 'auto' : 'smooth';
    this.scroll.scrollBy({ left: dx, top: dy, behavior });
  }

  // Track the current page from the scroll position in every mode, so header,
  // Peek and single/focus visibility all follow native scrolling.
  updateCurrentFromScroll() {
    if (!this.pages.length || !this.layout) return;
    if (performance.now() < this.suppressCurrentUntil) return;
    const index = this.indexAtViewportCenter();
    if (index < 0) return;
    const entry = this.pages[index].entry;
    if (entry !== this.entry) this.setCurrentEntry(entry, { recenter: false });
  }

  // Content-axis position of the viewport center, then the nearest page center.
  indexAtViewportCenter() {
    const { horizontal, dir, total } = this.layout;
    const scrollOffset = horizontal ? this.scroll.scrollLeft : this.scroll.scrollTop;
    const viewSize = horizontal ? this.scroll.clientWidth : this.scroll.clientHeight;
    const s = scrollOffset - (this.axisPad || 0) + viewSize / 2;
    return this.findNearestIndex(dir < 0 ? total - s : s);
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
      return;
    }
    const sequence = this.getSequence(this.episodeId);
    const episodeIndex = sequence.indexOf(this.episodeId);
    const nextEpisodeId = sequence[episodeIndex + step];
    if (!nextEpisodeId) return;
    const episode = this.getEpisode(nextEpisodeId);
    const model = createEpisodeReaderModel(episode);
    const variant = model.variants.has(this.entry.variant) ? this.entry.variant : model.variantNames[0];
    const pages = model.variants.get(variant) ?? [];
    const entry = step > 0 ? pages[0] : pages.at(-1);
    if (!entry) return;
    this.episodeId = nextEpisodeId;
    this.model = model;
    await this.preloadEntryImage(entry);
    this.renderStrip(entry);
  }

  async switchVariant(variant) {
    const entry = findPageEntry(this.model, variant, this.entry.page)
      ?? findNearestPageEntry(this.model, variant, this.entry.page);
    if (!entry) return;
    await this.preloadEntryImage(entry);
    this.renderStrip(entry);
  }

  // Slider seek: jump immediately with no animation and no decode wait, so the
  // user can drag to locate a page quickly.
  openPage(index) {
    const pages = this.currentPages();
    const entry = pages[clamp(Math.round(Number(index) || 0), 0, Math.max(0, pages.length - 1))];
    if (entry && entry !== this.entry) this.goToEntry(entry, { animate: false, preload: false });
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
    this.root.classList.add('is-peek-transitioning');
    this.syncPeekInteractionState();
    await this.animatePeekRadius(this.getPeekCoverRadius(), this.peekDuration(300));
    if (!this.isOpen() || this.peekTransitionStage !== 'expanding') return;
    await this.preloadEntryImage(targetEntry);
    if (sourceEpisodeId !== this.episodeId || !this.isOpen() || this.peekTransitionStage !== 'expanding') return;

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
    if (!this.isOpen() || this.peekTransitionStage !== 'expanding') return;
    await this.hideTransitionOverlay();
    if (!this.isOpen() || this.peekTransitionStage !== 'resetting') return;

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
    if (!this.isOpen() || this.peekTransitionStage !== 'resetting') return;
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
    this.peekPlane.style.removeProperty('transition');
    this.updatePeekMask();
    await this.nextPaint();
    if (!this.isOpen() || this.peekTransitionStage !== 'revealing') return;
    this.peekTransitionStage = 'settling';
    this.updatePeekMask();
    await this.animatePeekRadius(this.peekRadius, this.peekDuration(300));
    if (!this.isOpen() || this.peekTransitionStage !== 'settling') return;
    this.finishPeekTransition();
  }

  finishPeekTransition() {
    this.peekPlane.style.removeProperty('transition');
    this.peekTransitionStage = null;
    this.root.classList.remove('is-peek-transitioning');
    this.syncPeekInteractionState();
    this.updatePeekMask();
  }

  nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  // ---------------------------------------------------------------- transform

  fit() {
    this.zoom = 1;
    this.layoutPages();
    this.applyModeLayout(this.entry, false);
  }

  zoomAt(factor, clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    const localX = (clientX == null ? rect.left + rect.width / 2 : clientX) - rect.left;
    const localY = (clientY == null ? rect.top + rect.height / 2 : clientY) - rect.top;
    const oldScale = this.displayScale || 1;
    const nextZoom = clamp((this.zoom || 1) * factor, 0.05, 12);
    const newScale = (this.baseFitScale || 1) * nextZoom;
    if (!newScale || newScale === oldScale) return;
    const k = newScale / oldScale;
    const horizontal = isHorizontalReadingOrder(this.readingOrder);
    const pad = this.axisPad || 0;
    const padX = horizontal ? pad : 0;
    const padY = horizontal ? 0 : pad;
    // Padded content coordinate under the cursor scales about the pad, in both
    // LTR and RTL, so keep that point fixed while the layout is re-baked.
    const paddedX = this.scroll.scrollLeft + localX;
    const paddedY = this.scroll.scrollTop + localY;
    this.zoom = nextZoom;
    this.displayScale = newScale;
    this.applyAllSizes();
    this.scroll.scrollLeft = padX + (paddedX - padX) * k - localX;
    this.scroll.scrollTop = padY + (paddedY - padY) * k - localY;
    this.refreshWindow();
    this.updateCurrentFromScroll();
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
    const radius = Math.max(1, this.peekRadiusCurrent || this.peekRadius);
    const feather = Math.max(0, this.peekFeather);
    this.peekVisible = available;
    if (!available) {
      if (this.peekMaskOpacity !== '0') {
        style.opacity = '0';
        this.peekMaskOpacity = '0';
      }
      return;
    }
    // The mask layer is viewport-sized, so the circle center, radius and feather
    // are expressed directly in viewport-local pixels. Snap them to device pixels
    // so the moving/growing edge does not shimmer at sub-pixel offsets.
    const dpr = globalThis.devicePixelRatio || 1;
    const snap = (value) => Math.round(value * dpr) / dpr;
    const x = snap(this.pointer.x);
    const y = snap(this.pointer.y);
    const outer = snap(radius);
    const inner = snap(Math.max(0, radius - feather));
    const mask = `radial-gradient(circle at ${x}px ${y}px, #000 0 ${inner}px, transparent ${outer}px)`;
    // Rewriting an identical mask (panning/zooming moves only the camera, not the
    // circle) would force a full re-mask of the layer for nothing.
    if (mask !== this.peekMaskString) {
      this.peekMaskString = mask;
      style.maskImage = mask;
    }
    if (this.peekMaskOpacity !== '1') {
      style.opacity = '1';
      this.peekMaskOpacity = '1';
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

  prefersReducedMotion() {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  animatePeekRadius(target, duration = this.peekDuration(140)) {
    cancelAnimationFrame(this.peekAnimationFrame);
    this.peekAnimationResolve?.();
    if (duration <= 0) {
      this.peekAnimationResolve = null;
      this.peekRadiusCurrent = target;
      this.peekRadiusTarget = target;
      this.updatePeekMask();
      return Promise.resolve();
    }
    const from = this.peekRadiusCurrent;
    const startedAt = performance.now();
    this.peekRadiusTarget = target;
    return new Promise((resolve) => {
      this.peekAnimationResolve = resolve;
      const step = (now) => {
        const progress = clamp((now - startedAt) / duration, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        this.peekRadiusCurrent = from + (this.peekRadiusTarget - from) * eased;
        this.updatePeekMask();
        if (progress < 1) {
          this.peekAnimationFrame = requestAnimationFrame(step);
          return;
        }
        this.peekAnimationResolve = null;
        resolve();
      };
      this.peekAnimationFrame = requestAnimationFrame(step);
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
      this.animatePeekRadius(this.peekRadius, this.peekDuration(210));
    } else {
      cancelAnimationFrame(this.peekAnimationFrame);
      this.peekAnimationResolve?.();
      this.peekAnimationResolve = null;
      this.peekRadiusCurrent = this.peekRadius;
      this.peekRadiusTarget = this.peekRadius;
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
    if (this.isContinuous()) {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        this.zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
        return;
      }
      if (this.wheelLocked) { event.preventDefault(); return; }
      // Continuous mode free-scrolls along the reading axis using the native
      // scroller. Distance follows the platform default (raw wheel delta);
      // line/page delta modes are converted to pixels.
      event.preventDefault();
      const axisSize = isHorizontalReadingOrder(this.readingOrder) ? this.scroll.clientWidth : this.scroll.clientHeight;
      let delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= axisSize;
      if (!delta) return;
      if (isHorizontalReadingOrder(this.readingOrder)) {
        const direction = this.readingOrder === 'rtl' ? -1 : 1;
        this.scrollBy(direction * delta, 0);
      } else {
        this.scrollBy(0, delta);
      }
      this.lockWheel();
      return;
    }
    event.preventDefault();
    const intent = getWheelIntent(event);
    if (intent.mode === 'zoom') {
      this.zoomAt(Math.exp(-intent.delta * 0.0015), event.clientX, event.clientY);
      return;
    }
    const axisSize = isHorizontalReadingOrder(this.readingOrder) ? this.scroll.clientWidth : this.scroll.clientHeight;
    let delta = intent.delta;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= axisSize;
    clearTimeout(this.wheelResetTimer);
    this.wheelAccumulator += delta;
    // One page per notch; ignore further notches until the turn finishes so the
    // speed stays steady (TIMING_MS) and the page-turn animation can play out.
    if (!this.wheelLocked && Math.abs(this.wheelAccumulator) >= 60) {
      const direction = Math.sign(this.wheelAccumulator);
      this.wheelAccumulator = 0;
      this.lockWheel();
      this.movePage(direction);
    }
    this.wheelResetTimer = setTimeout(() => { this.wheelAccumulator = 0; }, 160);
  }

  // Lock wheel input until the current scroll animation ends (scrollend). A
  // fallback timer guards engines/paths where scrollend never fires.
  lockWheel() {
    this.wheelLocked = true;
    clearTimeout(this.wheelLockTimer);
    this.wheelLockTimer = setTimeout(() => { this.wheelLocked = false; }, TIMING_MS * 4);
  }

  onScrollEnd() {
    this.wheelLocked = false;
    clearTimeout(this.wheelLockTimer);
    this.wheelLockTimer = 0;
  }

  // Align to the nearest page after a free drag (replaces CSS scroll-snap, which
  // clamped multi-page programmatic scrolls).
  snapToNearest() {
    if (this.isContinuous()) return;
    const index = this.indexAtViewportCenter();
    if (index >= 0) this.scrollToIndex(index, true);
  }

  onPointerDown(event) {
    this.suppressClick = false;
    this.markInputModality(event.pointerType);
    if (event.pointerType === 'touch') {
      this.touchMode = true;
      this.viewport.setPointerCapture(event.pointerId);
      this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.isContinuous()) {
        // Continuous: single-finger drag scrolls the strip, two fingers reveal Peek.
        if (this.touchPoints.size === 1) {
          this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: this.scroll.scrollLeft, originY: this.scroll.scrollTop };
        } else {
          this.touchPeek = true;
          this.drag = null;
          this.updateTouchPeek();
        }
        return;
      }
      if (this.touchPoints.size === 1) {
        this.touchGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, swiping: false };
        this.animatePeekRadius(0, this.peekDuration(160));
      } else {
        this.touchPeek = true;
        this.touchGesture = null;
        this.updateTouchPeek();
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
      this.animatePeekRadius(this.peekRadius * 1.75, this.peekDuration(170));
    }
  }

  onPointerMove(event) {
    if (event.pointerType === 'touch') {
      if (this.touchPoints.has(event.pointerId)) {
        this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (this.isContinuous()) {
          if (this.drag?.pointerId === event.pointerId) {
            this.scroll.scrollLeft = this.drag.originX + this.drag.x - event.clientX;
            this.scroll.scrollTop = this.drag.originY + this.drag.y - event.clientY;
          } else if (this.touchPeek) {
            this.updateTouchPeek();
          }
        } else {
          this.updateTouchPeek();
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
    }
    this.schedulePointerUpdate(event.clientX);
  }

  onPointerUp(event, cancelled = false) {
    if (event.pointerType === 'touch') {
      const hadPoint = this.touchPoints.delete(event.pointerId);
      if (!hadPoint) return;
      if (this.touchPeek) {
        if (this.touchPoints.size < 2) this.animatePeekRadius(0, this.peekDuration(210));
        if (!this.touchPoints.size) this.touchPeek = false;
        this.touchGesture = null;
        return;
      }
      if (this.readingMode === 'continuous') {
        if (this.drag?.pointerId === event.pointerId) {
          this.drag = null;
          this.root.classList.remove('is-dragging');
        }
        return;
      }
      const gesture = this.touchGesture;
      this.touchGesture = null;
      if (!cancelled && gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 12) {
        const page = this.pageAt?.(event.clientX, event.clientY) ?? null;
        if (page && page.entry !== this.entry) {
          this.goToEntry(page.entry, { animate: true });
        } else {
          const rect = this.viewport.getBoundingClientRect();
          if (isHorizontalReadingOrder(this.readingOrder)) {
            const ratio = (event.clientX - rect.left) / rect.width;
            if (ratio < 0.35) this.movePage(getLogicalPageStep(this.readingOrder, -1));
            else if (ratio > 0.65) this.movePage(getLogicalPageStep(this.readingOrder, 1));
            else this.root.classList.toggle('is-chrome-visible');
          } else {
            const ratio = (event.clientY - rect.top) / rect.height;
            if (ratio < 0.35) this.movePage(-1);
            else if (ratio > 0.65) this.movePage(1);
            else this.root.classList.toggle('is-chrome-visible');
          }
        }
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
        this.movePage(getLogicalPageStep(this.readingOrder, pointer.direction));
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
    this.animatePeekRadius(Math.hypot(a.x - b.x, a.y - b.y) / 2, this.peekDuration(80));
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
    }, 900);
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
    this.renderStrip(this.entry);
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
    }, 320);
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
      PageUp: () => this.movePage(-1),
      PageDown: () => this.movePage(1),
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
          ArrowLeft: () => this.movePage(getLogicalPageStep(this.readingOrder, -1)),
          ArrowRight: () => this.movePage(getLogicalPageStep(this.readingOrder, 1)),
          ArrowUp: previousVariant,
          ArrowDown: nextVariant
        }
      : {
          ...baseActions,
          ArrowUp: () => this.movePage(-1),
          ArrowDown: () => this.movePage(1),
          ArrowLeft: previousVariant,
          ArrowRight: nextVariant
        };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }
}
