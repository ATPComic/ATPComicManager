import {
  createEpisodeReaderModel,
  findNearestPageEntry,
  findPageEntry,
  getAdjacentEntry,
  getImageUrl,
  getPeekTargetVariant,
  getPageSideDirection,
  normalizePeekSettings,
  resolvePeekTarget as resolveModelPeekTarget,
  getSequencePosition,
  getWheelIntent
} from './reader-model.js';
import { t } from './i18n.js';

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

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
    this.image = root.querySelector('[data-reader-image]');
    this.peekImage = root.querySelector('[data-reader-peek]');
    this.collectionCrumb = root.querySelector('[data-reader-collection]');
    this.breadcrumbSeparator = root.querySelector('[data-reader-breadcrumb-separator]');
    this.title = root.querySelector('[data-reader-title]');
    this.meta = root.querySelector('[data-reader-meta]');
    this.peekButton = root.querySelector('[data-reader-peek-toggle]');
    this.episodeId = null;
    this.model = null;
    this.entry = null;
    this.peekEnabled = true;
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
    this.cursorTimer = 0;
    this.pointer = { x: 0, y: 0 };
    this.hasPointerPosition = false;
    this.transform = { x: 0, y: 0, scale: 1 };
    this.drag = null;
    this.pageTurnPointer = null;
    this.touchGesture = null;
    this.touchPoints = new Map();
    this.touchPeek = false;
    this.touchMode = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (this.touchMode) this.peekRadiusCurrent = this.peekRadiusTarget = 0;
    this.pageZoneDirection = 0;
    this.peekPressPointerId = null;
    this.loadToken = 0;
    this.peekLoadToken = 0;
    this.peekTargetOverrides = new Map();
    this.wheelAccumulator = 0;
    this.wheelResetTimer = 0;
    this.fullscreenRequested = false;
    this.fullscreenEdgeActive = false;
    this.fullscreenChromeTimer = 0;
    this.fullscreenFitFrame = 0;
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
    window.addEventListener('resize', () => { if (this.isOpen()) this.fit(); });
    document.addEventListener('keydown', (event) => this.onKeyDown(event));
    document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
  }

  isOpen() {
    return !this.root.hidden;
  }

  requestClose() {
    if (this.onClose?.() === true) return;
    this.close();
  }

  open(episodeId, preferredIndex = 0) {
    const episode = this.getEpisode(episodeId);
    if (!episode) return;
    this.episodeId = episodeId;
    this.model = createEpisodeReaderModel(episode);
    this.entry = this.model.entries.find((entry) => entry.index === preferredIndex) ?? this.model.entries[0] ?? null;
    if (!this.entry) return;
    this.root.hidden = false;
    document.body.classList.add('reader-open');
    if (!this.hasPointerPosition) {
      const rect = this.viewport.getBoundingClientRect();
      this.pointer = { x: rect.width / 2, y: rect.height / 2 };
    }
    this.renderVariants();
    this.loadEntry(this.entry, { fit: true });
    this.root.querySelector('[data-reader-close]').focus();
  }

  close() {
    this.endPeekPress({ releaseCapture: true });
    this.loadToken += 1;
    this.peekLoadToken += 1;
    this.peekTargetOverrides.clear();
    this.root.hidden = true;
    document.body.classList.remove('reader-open');
    this.image.removeAttribute('src');
    this.peekImage.removeAttribute('src');
    clearTimeout(this.cursorTimer);
    clearTimeout(this.fullscreenChromeTimer);
    cancelAnimationFrame(this.fullscreenFitFrame);
    cancelAnimationFrame(this.peekAnimationFrame);
    this.peekAnimationResolve?.();
    this.peekAnimationResolve = null;
    this.peekRadiusCurrent = this.touchMode ? 0 : this.peekRadius;
    this.peekRadiusTarget = this.touchMode ? 0 : this.peekRadius;
    this.peekTransitionStage = null;
    this.root.classList.remove('is-peek-transitioning');
    this.root.classList.remove('is-cursor-hidden');
    this.root.classList.remove('is-dragging');
    this.root.classList.remove('is-fullscreen', 'is-chrome-visible');
    this.fullscreenEdgeActive = false;
    this.pageTurnPointer = null;
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

  async loadEntry(entry, { fit = false } = {}) {
    if (!entry) return;
    this.endPeekPress({ releaseCapture: true });
    this.entry = entry;
    const token = ++this.loadToken;
    const peekToken = ++this.peekLoadToken;
    const imageUrl = getImageUrl(this.episodeId, entry.index, entry.file.assetKey);
    const nextImage = new Image();
    nextImage.decoding = 'async';
    nextImage.src = imageUrl;
    const peekState = this.resolvePeekTarget(entry);
    const peekEntry = peekState.entry;
    const peekUrl = peekEntry ? getImageUrl(this.episodeId, peekEntry.index, peekEntry.file.assetKey) : null;
    const nextPeekImage = peekUrl ? new Image() : null;
    if (nextPeekImage) {
      nextPeekImage.decoding = 'async';
      nextPeekImage.src = peekUrl;
    }

    await Promise.allSettled([
      nextImage.decode(),
      nextPeekImage?.decode()
    ].filter(Boolean));
    if (token !== this.loadToken) return;
    this.image.src = imageUrl;
    if (peekToken === this.peekLoadToken) this.applyPeekSource(peekState, peekUrl);
    this.plane.style.width = `${nextImage.naturalWidth || 1}px`;
    this.plane.style.height = `${nextImage.naturalHeight || 1}px`;
    if (fit) this.fit();
    else this.applyTransform();
    const currentPeek = this.resolvePeekTarget(entry);
    this.updateHeader(currentPeek.variant, currentPeek.entry);
    this.preloadNeighbors();
  }

  peekOverrideKey(variant = this.entry?.variant, episodeId = this.episodeId) {
    return episodeId && variant ? `${episodeId}:${variant}` : null;
  }

  getPeekTargetOverride(entry = this.entry) {
    const key = this.peekOverrideKey(entry?.variant);
    return key && this.peekTargetOverrides.has(key) ? this.peekTargetOverrides.get(key) : undefined;
  }

  resolvePeekTarget(entry = this.entry) {
    if (!entry || !this.model) return { variant: null, entry: null };
    const override = this.getPeekTargetOverride(entry);
    return resolveModelPeekTarget(this.model, entry.variant, entry.page, override);
  }

  isPeekTargetExplicitlyDisabled(entry = this.entry) {
    if (!entry || !this.model) return false;
    const override = this.getPeekTargetOverride(entry);
    if (override !== undefined) return override === null;
    return Object.hasOwn(this.model.peekRelations ?? {}, entry.variant)
      && this.model.peekRelations[entry.variant] === null;
  }

  applyPeekSource(peekState, peekUrl = null) {
    this.peekImage.hidden = !peekState.entry;
    if (peekUrl) this.peekImage.src = peekUrl;
    else this.peekImage.removeAttribute('src');
  }

  async refreshPeekForCurrentEntry() {
    const entry = this.entry;
    if (!entry || !this.model || !this.isOpen()) return false;
    this.endPeekPress({ releaseCapture: true });
    const episodeId = this.episodeId;
    const token = ++this.peekLoadToken;
    const peekState = this.resolvePeekTarget(entry);
    const peekUrl = peekState.entry ? getImageUrl(episodeId, peekState.entry.index, peekState.entry.file.assetKey) : null;
    this.peekImage.hidden = true;
    this.syncPeekInteractionState();
    const image = peekUrl ? new Image() : null;
    if (image) {
      image.decoding = 'async';
      image.src = peekUrl;
      await image.decode().catch(() => {});
    }
    if (token !== this.peekLoadToken || episodeId !== this.episodeId || entry !== this.entry || !this.isOpen()) return false;
    this.applyPeekSource(peekState, peekUrl);
    this.updateHeader(peekState.variant, peekState.entry);
    this.preloadNeighbors();
    return true;
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
    this.renderVariants();
    return this.refreshPeekForCurrentEntry();
  }

  updateHeader(peekVariant, peekEntry) {
    const pages = this.model.variants.get(this.entry.variant) ?? [];
    const pageIndex = pages.findIndex((entry) => entry === this.entry);
    this.title.textContent = this.getEpisode(this.episodeId)?.title ?? this.episodeId;
    this.meta.textContent = `${this.entry.variant.toUpperCase()} · ${pageIndex + 1} / ${pages.length}`;
    this.onPageProgress?.({ current: pageIndex + 1, total: pages.length });
    this.updateCollectionProgress();
    this.peekButton.disabled = !peekEntry;
    this.peekButton.classList.toggle('is-active', this.peekEnabled && !!peekEntry);
    this.peekButton.title = peekEntry ? t('revealVariant', { variant: peekVariant.toUpperCase() }) : t('noNextVariant');
    this.syncPeekInteractionState();
    this.renderVariants();
    this.updatePeekMask();
  }

  renderVariants() {
    const active = this.entry?.variant ?? '';
    const peekTargetOverride = this.getPeekTargetOverride();
    const defaultPeekTarget = active && this.model ? getPeekTargetVariant(this.model, active) : null;
    const peekTarget = active && this.model
      ? getPeekTargetVariant(this.model, active, peekTargetOverride)
      : null;
    this.onVariants?.({
      variants: this.model?.variantNames ?? [],
      active,
      peekTarget,
      defaultPeekTarget,
      peekTargetOverride
    });
  }

  switchVariant(variant) {
    const entry = findPageEntry(this.model, variant, this.entry.page)
      ?? findNearestPageEntry(this.model, variant, this.entry.page);
    if (entry) this.loadEntry(entry);
  }

  movePage(direction) {
    const adjacent = getAdjacentEntry(this.model, this.entry.variant, this.entry.page, direction);
    if (adjacent) {
      this.loadEntry(adjacent, { fit: true });
      return;
    }
    const sequence = this.getSequence(this.episodeId);
    const episodeIndex = sequence.indexOf(this.episodeId);
    const nextEpisodeId = sequence[episodeIndex + Math.sign(direction)];
    if (!nextEpisodeId) return;
    const episode = this.getEpisode(nextEpisodeId);
    const model = createEpisodeReaderModel(episode);
    const variant = model.variants.has(this.entry.variant) ? this.entry.variant : model.variantNames[0];
    const pages = model.variants.get(variant) ?? [];
    const entry = direction > 0 ? pages[0] : pages.at(-1);
    if (!entry) return;
    this.episodeId = nextEpisodeId;
    this.model = model;
    this.loadEntry(entry, { fit: true });
  }

  openPage(index) {
    const pages = this.model?.variants.get(this.entry?.variant) ?? [];
    const entry = pages[clamp(Math.round(Number(index) || 0), 0, Math.max(0, pages.length - 1))];
    if (entry && entry !== this.entry) this.loadEntry(entry, { fit: true });
  }

  fit() {
    if (!this.image.naturalWidth || !this.image.naturalHeight) return;
    const rect = this.viewport.getBoundingClientRect();
    const scale = Math.min(rect.width / this.image.naturalWidth, rect.height / this.image.naturalHeight);
    this.transform = {
      scale,
      x: (rect.width - this.image.naturalWidth * scale) / 2,
      y: (rect.height - this.image.naturalHeight * scale) / 2
    };
    this.applyTransform();
    this.updatePeekMask();
  }

  zoomAt(factor, clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    const x = clientX == null ? rect.left + rect.width / 2 : clientX;
    const y = clientY == null ? rect.top + rect.height / 2 : clientY;
    const localX = x - rect.left;
    const localY = y - rect.top;
    const oldScale = this.transform.scale;
    const scale = clamp(oldScale * factor, 0.03, 12);
    const imageX = (localX - this.transform.x) / oldScale;
    const imageY = (localY - this.transform.y) / oldScale;
    this.transform.scale = scale;
    this.transform.x = localX - imageX * scale;
    this.transform.y = localY - imageY * scale;
    this.applyTransform();
  }

  onWheel(event) {
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

  applyTransform() {
    const { x, y, scale } = this.transform;
    this.plane.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    this.updatePageZoneWidths();
    if (this.hasPointerPosition) {
      const rect = this.viewport.getBoundingClientRect();
      this.updatePageZone(rect.left + this.pointer.x);
    }
  }

  onPointerDown(event) {
    if (event.pointerType === 'touch') {
      event.preventDefault();
      this.touchMode = true;
      this.viewport.setPointerCapture(event.pointerId);
      this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touchPoints.size === 1) {
        this.touchGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
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
    if (event.pointerType === 'touch') {
      this.touchGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, swiping: false };
    }
    const pageDirection = this.getPageZoneDirection(event.clientX);
    if (pageDirection) {
      this.pageTurnPointer = {
        pointerId: event.pointerId,
        direction: pageDirection,
        x: event.clientX,
        y: event.clientY,
        cancelled: false
      };
      this.updatePageZone(event.clientX);
      return;
    }
    if (this.peekTransitionStage) return;
    if (this.isPeekInteractive()) {
      this.beginPeekPress(event.pointerId);
      this.animatePeekRadius(this.peekRadius * 1.75, this.peekDuration(170));
      this.updatePeekMask();
      return;
    }
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: this.transform.x, originY: this.transform.y };
    this.root.classList.add('is-dragging');
  }

  onPointerMove(event) {
    if (event.pointerType === 'touch') {
      if (this.touchPoints.has(event.pointerId)) {
        this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.updateTouchPeek();
      }
      return;
    }
    this.updatePageZone(event.clientX);
    this.notePointerActivity();
    this.pointer = this.toViewportPoint(event.clientX, event.clientY);
    this.hasPointerPosition = true;
    if (this.peekPressPointerId === event.pointerId && event.pointerType === 'mouse' && !(event.buttons & 1)) {
      this.endPeekPress({ animateRadius: true });
    }
    if (this.touchGesture?.pointerId === event.pointerId) {
      const deltaX = event.clientX - this.touchGesture.x;
      const deltaY = event.clientY - this.touchGesture.y;
      if (Math.abs(deltaX) > 18 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
        this.touchGesture.swiping = true;
        if (this.peekPressPointerId === event.pointerId) this.endPeekPress({ animateRadius: true });
        if (this.pageTurnPointer?.pointerId === event.pointerId) this.pageTurnPointer.cancelled = true;
        return;
      }
    }
    if (this.pageTurnPointer?.pointerId === event.pointerId) {
      const distance = Math.hypot(event.clientX - this.pageTurnPointer.x, event.clientY - this.pageTurnPointer.y);
      if (distance > 8) this.pageTurnPointer.cancelled = true;
      return;
    }
    if (this.peekTransitionStage === 'expanding' || this.peekTransitionStage === 'wrapping') {
      this.peekRadiusTarget = Math.max(this.peekRadiusTarget, this.getPeekCoverRadius());
    }
    if (this.drag?.pointerId === event.pointerId) {
      this.transform.x = this.drag.originX + event.clientX - this.drag.x;
      this.transform.y = this.drag.originY + event.clientY - this.drag.y;
      this.applyTransform();
    }
    this.updatePeekMask();
  }

  onPointerUp(event, cancelled = false) {
    if (event.pointerType === 'touch') {
      this.touchPoints.delete(event.pointerId);
      if (this.touchPeek) {
        if (this.touchPoints.size < 2) this.animatePeekRadius(0, this.peekDuration(210));
        if (!this.touchPoints.size) this.touchPeek = false;
        this.touchGesture = null;
        return;
      }
      const gesture = this.touchGesture;
      this.touchGesture = null;
      if (!cancelled && gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 12) {
        const rect = this.viewport.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        if (ratio < 0.35) this.movePage(-1);
        else if (ratio > 0.65) this.movePage(1);
        else this.root.classList.toggle('is-chrome-visible');
      }
      return;
    }
    if (this.touchGesture?.pointerId === event.pointerId) {
      const gesture = this.touchGesture;
      const deltaX = event.clientX - gesture.x;
      const deltaY = event.clientY - gesture.y;
      this.touchGesture = null;
      if (!cancelled && gesture.swiping && Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
        if (this.peekPressPointerId === event.pointerId) this.endPeekPress({ animateRadius: true });
        if (this.pageTurnPointer?.pointerId === event.pointerId) this.pageTurnPointer = null;
        if (this.drag?.pointerId === event.pointerId) this.drag = null;
        this.root.classList.remove('is-dragging');
        this.movePage(deltaX < 0 ? 1 : -1);
        return;
      }
    }
    if (this.pageTurnPointer?.pointerId === event.pointerId) {
      const pointer = this.pageTurnPointer;
      const distance = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y);
      const direction = this.getPageZoneDirection(event.clientX);
      this.pageTurnPointer = null;
      this.updatePageZone(event.clientX);
      if (!cancelled && !pointer.cancelled && distance <= 8 && direction === pointer.direction) {
        this.movePage(pointer.direction);
      }
      return;
    }
    if (this.peekPressPointerId === event.pointerId) {
      this.endPeekPress({ animateRadius: true });
      return;
    }
    if (this.peekTransitionStage) return;
    if (this.drag?.pointerId !== event.pointerId) return;
    this.drag = null;
    this.root.classList.remove('is-dragging');
  }

  updateTouchPeek() {
    if (!this.peekEnabled || this.touchPoints.size < 2) return;
    const [a, b] = [...this.touchPoints.values()];
    this.pointer = this.toViewportPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
    this.hasPointerPosition = true;
    this.animatePeekRadius(Math.hypot(a.x - b.x, a.y - b.y) / 2, this.peekDuration(80));
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
  }

  toViewportPoint(clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  getPageZoneDirection(clientX) {
    if (!Number.isFinite(clientX) || !this.image.naturalWidth) return 0;
    const viewportRect = this.viewport.getBoundingClientRect();
    const planeRect = this.plane.getBoundingClientRect();
    return getPageSideDirection(viewportRect, planeRect, clientX);
  }

  setPageZoneWidths(previousWidth, nextWidth) {
    this.root.style.setProperty('--reader-prev-zone-width', `${Math.max(0, previousWidth)}px`);
    this.root.style.setProperty('--reader-next-zone-width', `${Math.max(0, nextWidth)}px`);
  }

  updatePageZoneWidths() {
    if (!this.image.naturalWidth || !this.isOpen()) {
      this.setPageZoneWidths(0, 0);
      return;
    }
    const viewportRect = this.viewport.getBoundingClientRect();
    const planeRect = this.plane.getBoundingClientRect();
    const previousWidth = planeRect.left > viewportRect.left + 1
      ? Math.min(viewportRect.width, planeRect.left - viewportRect.left)
      : 0;
    const nextWidth = planeRect.right < viewportRect.right - 1
      ? Math.min(viewportRect.width, viewportRect.right - planeRect.right)
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

  updatePeekMask() {
    const radius = this.peekRadiusCurrent;
    const feather = this.peekFeather;
    // The mask lives in image coordinates while its visual radius is defined
    // in viewport pixels. Convert both so Peek stays aligned during zoom/pan.
    const scale = this.transform.scale || 1;
    const x = (this.pointer.x - this.transform.x) / scale;
    const y = (this.pointer.y - this.transform.y) / scale;
    const imageRadius = radius / scale;
    const imageFeather = feather / scale;
    const mask = `radial-gradient(circle at ${x}px ${y}px, #000 0 ${Math.max(0, imageRadius - imageFeather)}px, transparent ${imageRadius}px)`;
    this.peekImage.style.maskImage = mask;
    this.peekImage.style.webkitMaskImage = mask;
    const visibleTransition = this.peekTransitionStage === 'expanding'
      || this.peekTransitionStage === 'wrapping'
      || this.peekTransitionStage === 'settling';
    const hiddenTransition = this.peekTransitionStage === 'resetting'
      || this.peekTransitionStage === 'revealing';
    this.peekImage.style.opacity = visibleTransition || (this.peekEnabled && !hiddenTransition) ? '1' : '0';
  }

  peekDuration(baseDuration) {
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
    return Math.round(baseDuration * 100 / this.peekAnimationSpeed);
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

  nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async hideTransitionOverlay() {
    this.peekTransitionStage = 'resetting';
    this.peekImage.style.transition = 'none';
    this.updatePeekMask();
    await this.nextPaint();
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

  finishPeekTransition() {
    this.peekImage.style.removeProperty('transition');
    this.peekTransitionStage = null;
    this.root.classList.remove('is-peek-transitioning');
    this.syncPeekInteractionState();
    this.updatePeekMask();
  }

  async revealLoadedPeek() {
    if (this.touchMode) {
      this.peekRadiusCurrent = this.peekRadiusTarget = 0;
      this.finishPeekTransition();
      this.updateTouchPeek();
      return;
    }
    this.peekRadiusTarget = this.peekRadius;
    if (this.peekImage.hidden || !this.peekEnabled) {
      this.peekRadiusCurrent = this.peekRadius;
      this.finishPeekTransition();
      return;
    }
    this.peekRadiusCurrent = 0;
    this.peekTransitionStage = 'revealing';
    this.peekImage.style.removeProperty('transition');
    this.updatePeekMask();
    await this.nextPaint();
    if (!this.isOpen() || this.peekTransitionStage !== 'revealing') return;
    this.peekTransitionStage = 'settling';
    this.updatePeekMask();
    await this.animatePeekRadius(this.peekRadius, this.peekDuration(300));
    if (!this.isOpen() || this.peekTransitionStage !== 'settling') return;
    this.finishPeekTransition();
  }

  async transitionToNextVariant() {
    if (this.peekTransitionStage || this.peekImage.hidden) return;
    const { entry: nextEntry } = this.resolvePeekTarget();
    if (!nextEntry) return;

    this.endPeekPress({ releaseCapture: true });
    this.peekTransitionStage = 'expanding';
    this.root.classList.add('is-peek-transitioning');
    this.syncPeekInteractionState();
    await this.animatePeekRadius(this.getPeekCoverRadius(), this.peekDuration(300));
    if (!this.isOpen() || this.peekTransitionStage !== 'expanding') return;

    this.image.src = this.peekImage.currentSrc || this.peekImage.src;
    await this.hideTransitionOverlay();
    if (!this.isOpen() || this.peekTransitionStage !== 'resetting') return;
    await this.loadEntry(nextEntry, { fit: false });
    if (!this.isOpen() || this.peekTransitionStage !== 'resetting') return;
    await this.revealLoadedPeek();
  }

  async transitionToFirstVariant() {
    if (this.peekTransitionStage) return;
    const firstVariant = this.model?.variantNames?.[0];
    const firstEntry = firstVariant
      ? findPageEntry(this.model, firstVariant, this.entry.page)
        ?? findNearestPageEntry(this.model, firstVariant, this.entry.page)
      : null;
    if (!firstEntry || firstEntry === this.entry) return;

    this.endPeekPress({ releaseCapture: true });

    const sourceEpisodeId = this.episodeId;
    const transitionImage = new Image();
    transitionImage.decoding = 'async';
    transitionImage.src = getImageUrl(this.episodeId, firstEntry.index, firstEntry.file.assetKey);
    await transitionImage.decode().catch(() => {});
    if (!this.isOpen() || sourceEpisodeId !== this.episodeId || this.peekTransitionStage) return;

    this.peekImage.hidden = false;
    this.peekImage.src = transitionImage.src;
    this.peekRadiusCurrent = 0;
    this.peekRadiusTarget = 0;
    this.peekTransitionStage = 'revealing';
    this.root.classList.add('is-peek-transitioning');
    this.syncPeekInteractionState();
    this.updatePeekMask();
    await this.nextPaint();
    if (!this.isOpen() || this.peekTransitionStage !== 'revealing') return;

    this.peekTransitionStage = 'wrapping';
    this.updatePeekMask();
    await this.animatePeekRadius(this.getPeekCoverRadius(), this.peekDuration(380));
    if (!this.isOpen() || this.peekTransitionStage !== 'wrapping') return;
    this.image.src = this.peekImage.currentSrc || this.peekImage.src;
    await this.hideTransitionOverlay();
    if (!this.isOpen() || this.peekTransitionStage !== 'resetting') return;
    await this.loadEntry(firstEntry, { fit: false });
    if (!this.isOpen() || this.peekTransitionStage !== 'resetting') return;
    await this.revealLoadedPeek();
  }

  cycleVariant() {
    if (this.peekTransitionStage) return;
    const variants = this.model?.variantNames ?? [];
    if (variants.length < 2) return;
    const peekTarget = this.resolvePeekTarget();
    if (peekTarget.entry) this.transitionToNextVariant();
    else if (!peekTarget.variant && !this.isPeekTargetExplicitlyDisabled()) this.transitionToFirstVariant();
  }

  getPeekSettings() {
    return { radius: this.peekRadius, feather: this.peekFeather, animationSpeed: this.peekAnimationSpeed };
  }

  setPeekSettings(settings) {
    const normalized = normalizePeekSettings(settings);
    this.peekRadius = normalized.radius;
    this.peekFeather = normalized.feather;
    this.peekAnimationSpeed = normalized.animationSpeed;
    this.root.style.setProperty('--peek-fade-duration', `${this.peekDuration(300)}ms`);
    if (!this.peekPressPointerId && !this.peekTransitionStage) {
      this.peekRadiusCurrent = this.touchMode ? 0 : normalized.radius;
      this.peekRadiusTarget = this.touchMode ? 0 : normalized.radius;
    }
    this.updatePeekMask();
    return normalized;
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

  setPeekEnabled(enabled) {
    if (this.peekTransitionStage) return;
    if (!enabled) this.endPeekPress({ releaseCapture: true });
    this.peekEnabled = enabled;
    this.peekButton.classList.toggle('is-active', enabled);
    if (enabled && this.drag) {
      this.drag = null;
      this.root.classList.remove('is-dragging');
    }
    this.syncPeekInteractionState();
    this.updatePeekMask();
  }

  onSpace() {
    const variants = this.model?.variantNames ?? [];
    if (variants.length > 1 && this.entry?.variant === variants.at(-1)) {
      this.transitionToFirstVariant();
      return;
    }
    this.setPeekEnabled(!this.peekEnabled);
  }

  isPeekInteractive() {
    return this.peekEnabled && !this.peekImage.hidden && !this.peekTransitionStage;
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

  openCollectionEpisode(index) {
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
    this.loadEntry(entry, { fit: true });
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

  onKeyDown(event) {
    if (!this.isOpen()) return;
    const eventPath = event.composedPath?.() ?? [event.target];
    if (eventPath.some((element) => (
      element instanceof HTMLInputElement
      || element instanceof HTMLTextAreaElement
      || element?.matches?.('md-slider, [role="slider"]')
    ))) return;
    const actions = {
      ArrowLeft: () => this.movePage(-1),
      ArrowRight: () => this.movePage(1),
      PageUp: () => this.movePage(-1),
      PageDown: () => this.movePage(1),
      ArrowUp: () => this.switchVariant(this.model.variantNames[Math.max(0, this.model.variantNames.indexOf(this.entry.variant) - 1)]),
      ArrowDown: () => this.switchVariant(this.model.variantNames[Math.min(this.model.variantNames.length - 1, this.model.variantNames.indexOf(this.entry.variant) + 1)]),
      '0': () => this.fit(),
      '=': () => this.zoomAt(1.25),
      '+': () => this.zoomAt(1.25),
      '-': () => this.zoomAt(0.8),
      ' ': () => this.onSpace(),
      f: () => this.toggleFullscreen(),
      F: () => this.toggleFullscreen(),
      Escape: () => this.requestClose()
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }
}
