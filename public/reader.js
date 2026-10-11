import {
  computePageBox,
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
    this.variantAspect = null;
    this.stripToken = 0;
    this.peekTargetOverrides = new Map();
    this.peekEnabled = true;
    const preferences = normalizeReaderPreferences(settings);
    this.readingMode = preferences.mode;
    this.readingOrder = preferences.order;
    this.pageFit = preferences.fit;
    this.pageAnimation = preferences.pageAnimation;
    const peekSettings = normalizePeekSettings(settings);
    this.peekRadius = peekSettings.radius;
    this.peekFeather = peekSettings.feather;
    this.peekAnimationSpeed = peekSettings.animationSpeed;
    this.root.style.setProperty('--peek-fade-duration', `${this.peekDuration(300)}ms`);
    this.peekRadiusCurrent = this.touchMode ? 0 : this.peekRadius;
    this.peekRadiusTarget = this.touchMode ? 0 : this.peekRadius;
    this.peekAnimationFrame = 0;
    this.peekAnimationResolve = null;
    this.peekTransitionStage = null;
    this.peekPlane = null;
    this.peekVariant = null;
    this.cursorTimer = 0;
    this.pointer = { x: 0, y: 0 };
    this.hasPointerPosition = false;
    this.transform = { x: 0, y: 0, scale: 1 };
    this.transformFrame = 0;
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
    this.peekPlane = null;
    clearTimeout(this.cursorTimer);
    clearTimeout(this.fullscreenChromeTimer);
    cancelAnimationFrame(this.transformFrame);
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
      pageAnimation: this.pageAnimation
    };
  }

  setReaderSettings(settings) {
    const peek = normalizePeekSettings(settings);
    this.peekRadius = peek.radius;
    this.peekFeather = peek.feather;
    this.peekAnimationSpeed = peek.animationSpeed;
    this.root.style.setProperty('--peek-fade-duration', `${this.peekDuration(300)}ms`);
    if (this.peekPressPointerId == null && !this.peekTransitionStage) {
      this.peekRadiusCurrent = this.touchMode ? 0 : this.peekRadius;
      this.peekRadiusTarget = this.touchMode ? 0 : this.peekRadius;
    }
    const preferences = normalizeReaderPreferences(settings);
    this.readingMode = preferences.mode;
    this.readingOrder = preferences.order;
    this.pageFit = preferences.fit;
    this.pageAnimation = preferences.pageAnimation;
    this.syncModeClasses();
    if (this.isOpen()) {
      this.resetPageStyles();
      this.refreshWindow();
      this.layoutPages();
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
    cancelAnimationFrame(this.transformFrame);
    this.entry = entry ?? this.model.entries[0] ?? null;
    this.variantAspect = this.aspectCache.get(`${this.episodeId}:${this.entry.index}`) ?? null;
    this.pages = this.currentPages().map((pageEntry, index) => {
      const element = document.createElement('div');
      const peekElement = document.createElement('div');
      return { entry: pageEntry, index, element, peekElement, type: null, width: 0, height: 0 };
    });
    const fragment = document.createDocumentFragment();
    for (const slot of this.pages) fragment.append(slot.element);
    this.plane.replaceChildren(fragment);
    // A single maskable layer mirrors the whole strip and holds the next-variant
    // pages, so Peek stays continuous across page boundaries.
    this.peekPlane = document.createElement('div');
    this.peekPlane.className = 'reader-peek-plane';
    this.peekPlane.dataset.readerPeekPlane = '';
    const peekFragment = document.createDocumentFragment();
    for (const slot of this.pages) peekFragment.append(slot.peekElement);
    this.peekPlane.replaceChildren(peekFragment);
    this.plane.append(this.peekPlane);
    this.plane.style.transform = '';
    this.plane.style.opacity = '';
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
      this.aspectCache.set(`${this.episodeId}:${this.entry.index}`, aspect);
      this.variantAspect = aspect;
      this.applyAllSizes();
    });
  }

  windowRadius() {
    if (this.readingMode === 'single') return 1;
    if (this.readingMode === 'focus') return 2;
    return 3;
  }

  currentIndex() {
    return this.pages.findIndex((slot) => slot.entry === this.entry);
  }

  refreshWindow() {
    const center = this.currentIndex();
    if (center < 0) return;
    const radius = this.windowRadius();
    for (const slot of this.pages) {
      const mounted = Math.abs(slot.index - center) <= radius;
      if (mounted && slot.type !== 'page') this.mountPage(slot);
      else if (!mounted && slot.type !== 'span') this.mountSpan(slot);
    }
  }

  mountPage(slot) {
    const element = slot.element;
    const pageEntry = slot.entry;
    element.className = 'reader-page is-loading';
    element.dataset.readerPage = '';
    element.dataset.page = String(pageEntry.page);
    element.title = `${pageEntry.variant.toUpperCase()} · ${pageEntry.page}`;
    element.classList.toggle('is-current', pageEntry === this.entry);
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
    const reveal = () => element.classList.remove('is-loading');
    const handleLoaded = () => {
      const width = base.naturalWidth || 0;
      const height = base.naturalHeight || 0;
      if (width && height) this.aspectCache.set(key, width / height);
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
    if (peekEntry) {
      peekElement.className = 'reader-peek-page';
      const image = document.createElement('img');
      image.className = 'reader-peek-image is-loading';
      image.alt = '';
      image.draggable = false;
      image.decoding = 'async';
      image.loading = 'lazy';
      image.src = getImageUrl(this.episodeId, peekEntry.index, peekEntry.file.assetKey);
      const reveal = () => image.classList.remove('is-loading');
      const handleLoaded = () => (image.decode ? image.decode() : Promise.resolve()).catch(() => {}).then(reveal);
      if (image.complete && image.naturalWidth) handleLoaded();
      else {
        image.addEventListener('load', handleLoaded, { once: true });
        image.addEventListener('error', () => image.classList.remove('is-loading'), { once: true });
      }
      peekElement.replaceChildren(image);
    } else {
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
    slot.peekElement.className = 'reader-peek-span';
    slot.peekElement.replaceChildren();
  }

  applySlotSize(slot) {
    const box = computePageBox({
      aspect: this.variantAspect || DEFAULT_ASPECT,
      fit: this.isContinuous() ? this.pageFit : 'screen',
      order: this.readingOrder,
      viewportWidth: this.viewport.clientWidth,
      viewportHeight: this.viewport.clientHeight
    });
    slot.width = box.width;
    slot.height = box.height;
    slot.element.style.width = `${box.width}px`;
    slot.element.style.height = `${box.height}px`;
    slot.peekElement.style.width = `${box.width}px`;
    slot.peekElement.style.height = `${box.height}px`;
  }

  applyAllSizes() {
    for (const slot of this.pages) this.applySlotSize(slot);
  }

  layoutPages() {
    this.applyAllSizes();
  }

  resetPageStyles() {
    for (const slot of this.pages) {
      slot.element.style.opacity = '';
      slot.element.style.visibility = '';
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
    this.centerOn(entry, animate);
  }

  async setCurrentEntry(entry, { animate = false, recenter = true } = {}) {
    if (!entry) return;
    const previous = this.entry;
    if (previous === entry) return;
    // Wait for the target image to decode before revealing it, so page turns
    // never flash a blank page.
    if (recenter) {
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
        if (width && height) this.aspectCache.set(key, width / height);
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
    const duration = Math.max(1, this.peekDuration(300));
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
    this.root.classList.add('is-turning');
    for (const record of [oldRecord, newRecord]) {
      record.element.style.transition = 'none';
      record.element.style.visibility = 'visible';
    }
    oldRecord.element.style.opacity = '1';
    newRecord.element.style.opacity = '0';
    this.centerOn(entry, slide);
    requestAnimationFrame(() => {
      if (token !== this.stripToken) return;
      const easing = `opacity ${duration}ms cubic-bezier(.2, .7, .2, 1)`;
      oldRecord.element.style.transition = easing;
      newRecord.element.style.transition = easing;
      oldRecord.element.style.opacity = '0';
      newRecord.element.style.opacity = '1';
    });
    window.setTimeout(() => {
      if (token !== this.stripToken) return;
      this.root.classList.remove('is-turning');
      this.resetPageStyles();
      this.refreshWindow();
    }, duration + 60);
  }

  centerOn(entry, animate = false) {
    const record = this.pageFor(entry);
    if (!record || !record.width) return;
    const scale = this.transform.scale || 1;
    const x = this.viewport.clientWidth / 2 - (record.element.offsetLeft + record.width / 2) * scale;
    const y = this.viewport.clientHeight / 2 - (record.element.offsetTop + record.height / 2) * scale;
    this.animateTransformTo(x, y, animate);
  }

  animateTransformTo(x, y, animate) {
    cancelAnimationFrame(this.transformFrame);
    this.transformFrame = 0;
    if (!animate || this.prefersReducedMotion()) {
      this.transform.x = x;
      this.transform.y = y;
      this.applyTransform();
      return;
    }
    const fromX = this.transform.x;
    const fromY = this.transform.y;
    const startedAt = performance.now();
    const duration = this.peekDuration(260);
    const step = (now) => {
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.transform.x = fromX + (x - fromX) * eased;
      this.transform.y = fromY + (y - fromY) * eased;
      this.applyTransform();
      if (progress < 1) this.transformFrame = requestAnimationFrame(step);
      else this.transformFrame = 0;
    };
    this.transformFrame = requestAnimationFrame(step);
  }

  applyTransform() {
    const { x, y, scale } = this.transform;
    this.plane.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    this.updatePageZoneWidths();
    this.updatePeekMask();
  }

  // Continuous-mode free scroll: move the whole strip by a pixel delta.
  scrollBy(dx, dy) {
    this.transform.x += dx;
    this.transform.y += dy;
    this.applyTransform();
    this.updateContinuousCurrent();
  }

  updateContinuousCurrent() {
    if (!this.isContinuous() || !this.pages.length) return;
    const rect = this.viewport.getBoundingClientRect();
    const horizontal = isHorizontalReadingOrder(this.readingOrder);
    const center = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    const nearestBetween = (from, to) => {
      let best = null;
      let bestDistance = Infinity;
      for (let index = from; index <= to; index += 1) {
        const box = this.pages[index].element.getBoundingClientRect();
        const pageCenter = horizontal ? box.left + box.width / 2 : box.top + box.height / 2;
        const distance = Math.abs(pageCenter - center);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = this.pages[index];
        }
      }
      return best;
    };
    const last = this.pages.length - 1;
    const current = this.currentIndex();
    const from = Math.max(0, current - 12);
    const to = Math.min(last, current + 12);
    let best = nearestBetween(from, to);
    if (best && ((best.index === from && from > 0) || (best.index === to && to < last))) {
      best = nearestBetween(0, last);
    }
    if (best && best.entry !== this.entry) this.setCurrentEntry(best.entry, { recenter: false });
  }

  // ---------------------------------------------------------------- nav

  goToEntry(entry, { animate = false } = {}) {
    if (!entry) return;
    this.setCurrentEntry(entry, { animate, recenter: true });
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

  openPage(index) {
    const pages = this.currentPages();
    const entry = pages[clamp(Math.round(Number(index) || 0), 0, Math.max(0, pages.length - 1))];
    if (entry && entry !== this.entry) this.goToEntry(entry, { animate: true });
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
      slot.element.title = `${target.variant.toUpperCase()} · ${target.page}`;
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
      slot.element.title = `${target.variant.toUpperCase()} · ${target.page}`;
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
    this.layoutPages();
    this.transform.scale = 1;
    this.centerOn(this.entry, false);
  }

  zoomAt(factor, clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    const x = clientX == null ? rect.left + rect.width / 2 : clientX;
    const y = clientY == null ? rect.top + rect.height / 2 : clientY;
    const localX = x - rect.left;
    const localY = y - rect.top;
    const oldScale = this.transform.scale;
    const scale = clamp(oldScale * factor, 0.05, 12);
    const imageX = (localX - this.transform.x) / oldScale;
    const imageY = (localY - this.transform.y) / oldScale;
    this.transform.scale = scale;
    this.transform.x = localX - imageX * scale;
    this.transform.y = localY - imageY * scale;
    this.applyTransform();
    if (this.isContinuous()) this.updateContinuousCurrent();
  }

  // ---------------------------------------------------------------- peek

  currentPeekEntry() {
    return this.resolvePeekTarget(this.entry).entry;
  }

  updatePeekMask() {
    if (!this.peekPlane) return;
    const visibleTransition = this.peekTransitionStage === 'expanding'
      || this.peekTransitionStage === 'wrapping'
      || this.peekTransitionStage === 'settling';
    const hiddenTransition = this.peekTransitionStage === 'resetting'
      || this.peekTransitionStage === 'revealing';
    if (!visibleTransition && (!this.peekEnabled || !this.currentPeekEntry() || hiddenTransition)) {
      this.peekPlane.style.opacity = '0';
      return;
    }
    const px = this.pointer.x;
    const py = this.pointer.y;
    const scale = this.transform.scale || 1;
    const x = (px - this.transform.x) / scale;
    const y = (py - this.transform.y) / scale;
    const radius = Math.max(1, (this.peekRadiusCurrent || this.peekRadius) / scale);
    const feather = Math.max(0, this.peekFeather / scale);
    const mask = `radial-gradient(circle at ${x}px ${y}px, #000 0 ${Math.max(0, radius - feather)}px, transparent ${radius}px)`;
    this.peekPlane.style.maskImage = mask;
    this.peekPlane.style.webkitMaskImage = mask;
    this.peekPlane.style.opacity = '1';
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
      // Continuous mode free-scrolls the strip along the reading axis.
      // (transform translate: advancing means the strip moves against the axis)
      event.preventDefault();
      if (isHorizontalReadingOrder(this.readingOrder)) {
        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (delta) this.scrollBy((this.readingOrder === 'rtl' ? 1 : -1) * delta, 0);
      } else if (event.deltaY) {
        this.scrollBy(0, -event.deltaY);
      }
      return;
    }
    event.preventDefault();
    const intent = getWheelIntent(event);
    if (intent.mode === 'zoom') {
      this.zoomAt(Math.exp(-intent.delta * 0.0015), event.clientX, event.clientY);
      return;
    }
    clearTimeout(this.wheelResetTimer);
    this.wheelAccumulator += intent.delta;
    if (Math.abs(this.wheelAccumulator) >= 48) {
      this.movePage(Math.sign(this.wheelAccumulator));
      this.wheelAccumulator = 0;
    }
    this.wheelResetTimer = setTimeout(() => { this.wheelAccumulator = 0; }, 160);
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
          this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: this.transform.x, originY: this.transform.y };
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
            this.transform.x = this.drag.originX + event.clientX - this.drag.x;
            this.transform.y = this.drag.originY + event.clientY - this.drag.y;
            this.applyTransform();
            this.updateContinuousCurrent();
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
    this.updatePageZone(event.clientX);
    if (this.pointerDown && !this.pointerDown.moved) {
      const distance = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
      if (distance > DRAG_THRESHOLD) {
        this.pointerDown.moved = true;
        this.suppressClick = true;
        this.endPeekPress({ animateRadius: true });
        this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: this.transform.x, originY: this.transform.y };
        this.root.classList.add('is-dragging');
      }
    }
    if (this.drag?.pointerId === event.pointerId) {
      this.transform.x = this.drag.originX + event.clientX - this.drag.x;
      this.transform.y = this.drag.originY + event.clientY - this.drag.y;
      this.applyTransform();
      if (this.isContinuous()) this.updateContinuousCurrent();
    }
    this.updatePeekMask();
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
