/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  contentChild,
  DestroyRef,
  Directive,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  Renderer2,
  signal,
  untracked,
  ɵIMAGE_CONFIG as IMAGE_CONFIG,
  ɵIMAGE_CONFIG_DEFAULTS as IMAGE_CONFIG_DEFAULTS,
  ɵImageConfig as ImageConfig,
  ɵRuntimeError as RuntimeError,
} from '@angular/core';

import {RuntimeErrorCode} from '../../errors';

import {IMAGE_LOADER, ImageLoaderConfig, noopImageLoader} from './image_loaders/image_loader';
import {NgOptimizedImage} from './ng_optimized_image';
import {PreconnectLinkChecker} from './preconnect_link_checker';
import {PreloadLinkCreator} from './preload-link-creator';

/**
 * Config options for a source element within a picture element.
 *
 * @see {@link NgOptimizedPicture}
 * @publicApi
 */
export interface PictureSource {
  /**
   * The image file name to be added to the image loader URL
   * (same as `ngSrc` on the img element)
   */
  srcset: string;

  /**
   * The media query for this source (e.g., "(min-width: 768px)")
   */
  media?: string;

  /**
   * The MIME type for this source (e.g., "image/webp")
   */
  type?: string;

  /**
   * The sizes attribute for responsive images
   */
  sizes?: string;

  /**
   * Width of the source image for srcset generation
   */
  width?: number;

  /**
   * Height of the source image for srcset generation
   */
  height?: number;
}

/**
 * Used in generating automatic density-based srcsets
 */
const DENSITY_SRCSET_MULTIPLIERS = [1, 2];

/**
 * Used to determine which breakpoints to use on full-width images
 */
const VIEWPORT_BREAKPOINT_CUTOFF = 640;

/**
 * Used to limit automatic srcset generation of very large sources for
 * fixed-size images. In pixels.
 */
const FIXED_SRCSET_WIDTH_LIMIT = 1920;
const FIXED_SRCSET_HEIGHT_LIMIT = 1080;

/**
 * Directive that improves loading performance for `<picture>` elements by enforcing best
 * practices and coordinating with the `NgOptimizedImage` directive.
 *
 * `NgOptimizedPicture` enables art direction and format switching by managing multiple
 * `<source>` elements within a `<picture>` container. It works in conjunction with a child
 * `<img>` element that uses the `NgOptimizedImage` directive.
 *
 * The directive:
 * - Automatically generates `<source>` elements with appropriate srcsets
 * - Applies the configured `ImageLoader` to all sources
 * - Coordinates with `NgOptimizedImage` for priority hints and preloading
 * - Supports art direction (different images for different viewports)
 * - Supports format switching (WebP, AVIF, etc.)
 * - Uses Angular Signals for reactive updates
 *
 * @usageNotes
 * The `NgOptimizedPicture` directive is marked as [standalone](guide/components/importing) and can
 * be imported directly.
 *
 * Follow the steps below to enable and use the directive:
 * 1. Import it into the necessary NgModule or a standalone Component.
 * 2. Optionally provide an `ImageLoader` if you use an image hosting service.
 * 3. Add the directive to a `<picture>` element with a child `<img ngSrc>` element.
 *
 * Step 1: import the `NgOptimizedPicture` directive.
 *
 * ```ts
 * import { NgOptimizedPicture } from '@angular/common';
 *
 * // Include it into the `imports` array of a component:
 * @Component({
 *   standalone: true,
 *   imports: [NgOptimizedPicture],
 *   ...
 * })
 * class MyComponent {}
 * ```
 *
 * Step 2 (optional): configure an image loader.
 *
 * To use the **default loader**: no additional code changes are necessary. The URL returned by the
 * generic loader will always match the value of "src". In other words, this loader applies no
 * transformations to the resource URL and the value of the `srcset` property is used as is.
 *
 * To use an existing loader for a **third-party image service**: add the provider factory for your
 * chosen service to the `providers` array. In the example below, the Imgix loader is used:
 *
 * ```ts
 * import {provideImgixLoader} from '@angular/common';
 *
 * // Call the function and add the result to the `providers` array:
 * providers: [
 *   provideImgixLoader("https://my.base.url/"),
 * ],
 * ```
 *
 * Step 3: use the directive in your template.
 *
 * ```html
 * <picture [sources]="pictureSources()">
 *   <img ngSrc="hero.jpg" width="400" height="300" alt="Hero">
 * </picture>
 * ```
 *
 * In your component:
 * ```ts
 * pictureSources = signal([
 *   { srcset: 'hero-desktop.jpg', media: '(min-width: 1024px)', width: 1920, height: 1080 },
 *   { srcset: 'hero-tablet.jpg', media: '(min-width: 768px)', width: 768, height: 576 }
 * ]);
 * ```
 *
 * @publicApi
 * @developerPreview
 */
@Directive({
  standalone: true,
  selector: 'picture[sources]',
})
export class NgOptimizedPicture {
  private imageLoader = inject(IMAGE_LOADER);
  private config: ImageConfig = processConfig(inject(IMAGE_CONFIG));
  private renderer = inject(Renderer2);
  private pictureElement: HTMLPictureElement = inject(ElementRef).nativeElement;
  private injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Array of source configurations for the picture element.
   * Each source can specify media queries, types, and dimensions for responsive images.
   */
  readonly sources = input.required<PictureSource[]>();

  /**
   * Reference to the child NgOptimizedImage directive (the fallback <img> element)
   */
  readonly imgDirective = contentChild(NgOptimizedImage);

  /**
   * Signal tracking the generated source elements for cleanup
   */
  private generatedSources = signal<HTMLSourceElement[]>([]);

  /**
   * Flag to track if initial setup is complete
   */
  private initialized = signal(false);

  constructor() {
    // Effect 1: Validate and generate source elements
    effect(() => {
      const sourcesValue = this.sources();

      // Skip if sources is empty array (initialization phase)
      if (!sourcesValue || sourcesValue.length === 0) {
        return;
      }

      // Perform validations in dev mode (only after we have sources)
      if (typeof ngDevMode === 'undefined' || ngDevMode) {
        this.validatePictureSetup(sourcesValue);
      }

      // Cleanup old sources and generate new ones
      this.cleanupSourceElements();
      this.generateSourceElements(sourcesValue);

      // Mark as initialized after first run
      if (!this.initialized()) {
        this.initialized.set(true);
      }
    });

    // Effect 2: Handle preconnect checking for priority images
    effect(() => {
      const img = this.imgDirective();
      const sourcesValue = this.sources();

      // Only run after initialization and in dev mode
      if (!this.initialized() || !img?.priority) return;
      if (typeof ngDevMode === 'undefined' || ngDevMode) {
        this.checkPreconnect(sourcesValue);
      }
    });

    // Effect 3: Handle SSR preload link generation
    effect(() => {
      const img = this.imgDirective();
      const sourcesValue = this.sources();

      // Only run after initialization
      if (!this.initialized()) return;

      if (typeof ngServerMode !== 'undefined' && ngServerMode && img?.priority) {
        untracked(() => {
          this.createPreloadLinks(sourcesValue);
        });
      }
    });
  }

  /**
   * Validates the picture element setup in dev mode
   */
  private validatePictureSetup(sources: PictureSource[]): void {
    // Validate picture element
    if (this.pictureElement.tagName !== 'PICTURE') {
      throw new RuntimeError(
        RuntimeErrorCode.INVALID_INPUT,
        `The NgOptimizedPicture directive must be applied to a <picture> element. ` +
          `Currently it is applied to a <${this.pictureElement.tagName.toLowerCase()}> element.`,
      );
    }

    // Validate sources array
    if (!sources || sources.length === 0) {
      throw new RuntimeError(
        RuntimeErrorCode.INVALID_INPUT,
        `The NgOptimizedPicture directive requires at least one source in the 'sources' input. ` +
          `Please provide an array with at least one PictureSource configuration.`,
      );
    }
  }

  /**
   * Generates <source> elements for each configured source
   */
  private generateSourceElements(sources: PictureSource[]): void {
    if (!sources || sources.length === 0) {
      return;
    }

    // Find the img element to insert sources before it
    const imgElement = this.pictureElement.querySelector('img[ngSrc]');
    if (!imgElement) {
      if (typeof ngDevMode === 'undefined' || ngDevMode) {
        // Only throw in dev mode, and only after initialization
        if (this.initialized()) {
          throw new RuntimeError(
            RuntimeErrorCode.INVALID_INPUT,
            `The NgOptimizedPicture directive requires a child <img> element with the ngSrc attribute.`,
          );
        }
      }
      return;
    }

    const newSources: HTMLSourceElement[] = [];

    // Create source elements in order (they should appear before the img element)
    sources.forEach((sourceConfig, index) => {
      const sourceElement = this.renderer.createElement('source');

      // Generate srcset using the image loader
      const rewrittenSrcset = this.generateSrcsetForSource(sourceConfig);
      this.renderer.setAttribute(sourceElement, 'srcset', rewrittenSrcset);

      // Set media query if provided
      if (sourceConfig.media) {
        this.renderer.setAttribute(sourceElement, 'media', sourceConfig.media);
      }

      // Set type if provided
      if (sourceConfig.type) {
        this.renderer.setAttribute(sourceElement, 'type', sourceConfig.type);
      }

      // Set sizes if provided
      if (sourceConfig.sizes) {
        this.renderer.setAttribute(sourceElement, 'sizes', sourceConfig.sizes);
      }

      // Add marker attribute for cleanup
      this.renderer.setAttribute(sourceElement, 'data-ng-picture-source', index.toString());

      // Insert before the img element
      this.renderer.insertBefore(this.pictureElement, sourceElement, imgElement);

      newSources.push(sourceElement);
    });

    // Update signal with new sources
    this.generatedSources.set(newSources);
  }

  /**
   * Removes previously generated source elements
   */
  private cleanupSourceElements(): void {
    const sources = this.generatedSources();
    sources.forEach((source) => {
      this.renderer.removeChild(this.pictureElement, source);
    });
    this.generatedSources.set([]);
  }

  /**
   * Generates a srcset string for a given source configuration
   */
  private generateSrcsetForSource(sourceConfig: PictureSource): string {
    // If width and height are provided, generate responsive srcset
    if (sourceConfig.width !== undefined && sourceConfig.height !== undefined) {
      return this.generateResponsiveSrcset(sourceConfig);
    }

    // Otherwise, just use the image loader with the base src
    return this.callImageLoader({src: sourceConfig.srcset});
  }

  /**
   * Generates a responsive srcset with multiple resolutions
   */
  private generateResponsiveSrcset(sourceConfig: PictureSource): string {
    const width = sourceConfig.width!;
    const height = sourceConfig.height!;

    // Check if image is oversized
    const oversizedImage = width > FIXED_SRCSET_WIDTH_LIMIT || height > FIXED_SRCSET_HEIGHT_LIMIT;

    if (oversizedImage || this.imageLoader === noopImageLoader) {
      // Just return single source for oversized images or when using noop loader
      return this.callImageLoader({src: sourceConfig.srcset});
    }

    // For responsive images with sizes
    if (sourceConfig.sizes) {
      return this.getResponsiveSrcset(sourceConfig);
    }

    // For fixed-size images, generate density-based srcset
    return this.getFixedSrcset(sourceConfig);
  }

  /**
   * Generates responsive srcset using configured breakpoints
   */
  private getResponsiveSrcset(sourceConfig: PictureSource): string {
    const {breakpoints} = this.config;
    let filteredBreakpoints = breakpoints!;

    // For 100vw images, filter out small breakpoints
    if (sourceConfig.sizes?.trim() === '100vw') {
      filteredBreakpoints = breakpoints!.filter((bp) => bp >= VIEWPORT_BREAKPOINT_CUTOFF);
    }

    const finalSrcs = filteredBreakpoints.map(
      (bp) => `${this.callImageLoader({src: sourceConfig.srcset, width: bp})} ${bp}w`,
    );
    return finalSrcs.join(', ');
  }

  /**
   * Generates fixed-size srcset using density multipliers
   */
  private getFixedSrcset(sourceConfig: PictureSource): string {
    const finalSrcs = DENSITY_SRCSET_MULTIPLIERS.map(
      (multiplier) =>
        `${this.callImageLoader({
          src: sourceConfig.srcset,
          width: sourceConfig.width! * multiplier,
        })} ${multiplier}x`,
    );
    return finalSrcs.join(', ');
  }

  /**
   * Invokes the image loader with the given configuration
   */
  private callImageLoader(config: Omit<ImageLoaderConfig, 'loaderParams'>): string {
    const augmentedConfig: ImageLoaderConfig = {...config};
    return this.imageLoader(augmentedConfig);
  }

  /**
   * Checks preconnect for all sources (dev mode only)
   */
  private checkPreconnect(sources: PictureSource[]): void {
    const checker = this.injector.get(PreconnectLinkChecker);
    sources.forEach((source) => {
      const rewrittenSrc = this.callImageLoader({src: source.srcset});
      checker.assertPreconnect(rewrittenSrc, source.srcset);
    });
  }

  /**
   * Creates preload link tags for priority images in SSR
   */
  private createPreloadLinks(sources: PictureSource[]): void {
    const preloadLinkCreator = this.injector.get(PreloadLinkCreator);

    // Create preload links for all sources
    sources.forEach((sourceConfig) => {
      const rewrittenSrcset = this.generateSrcsetForSource(sourceConfig);
      const rewrittenSrc = this.callImageLoader({src: sourceConfig.srcset});

      preloadLinkCreator.createPreloadLinkTag(
        this.renderer,
        rewrittenSrc,
        rewrittenSrcset,
        sourceConfig.sizes,
      );
    });
  }
}

/***** Helper Functions *****/

/**
 * Sorts provided config breakpoints and uses defaults.
 */
function processConfig(config: ImageConfig): ImageConfig {
  let sortedBreakpoints: {breakpoints?: number[]} = {};
  if (config.breakpoints) {
    sortedBreakpoints.breakpoints = config.breakpoints.sort((a, b) => a - b);
  }
  return Object.assign({}, IMAGE_CONFIG_DEFAULTS, config, sortedBreakpoints);
}
