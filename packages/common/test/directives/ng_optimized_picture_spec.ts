/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  Provider,
  provideZoneChangeDetection,
  signal,
  Type,
  WritableSignal,
} from '@angular/core';
import {ComponentFixture, TestBed} from '@angular/core/testing';
import {isBrowser} from '@angular/private/testing';
import {expect} from '@angular/private/testing/matchers';
import {CommonModule, DOCUMENT, IMAGE_CONFIG, ImageConfig} from '../../index';
import {RuntimeErrorCode} from '../../src/errors';
import {PLATFORM_SERVER_ID} from '../../src/platform_id';

import {PRELOADED_IMAGES} from '../../src/directives/ng_optimized_image/tokens';
import {
  IMAGE_LOADER,
  ImageLoader,
  ImageLoaderConfig,
} from '../../src/directives/ng_optimized_image/image_loaders/image_loader';
import {NgOptimizedImage} from '../../src/directives/ng_optimized_image/ng_optimized_image';
import {
  NgOptimizedPicture,
  PictureSource,
} from '../../src/directives/ng_optimized_image/ng_optimized_picture';

describe('NgOptimizedPicture directive', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZoneChangeDetection()],
    });
  });

  describe('basic functionality', () => {
    it('should create source elements for each configured source', async () => {
      setupTestingModule();

      const sources: PictureSource[] = [
        {srcset: 'hero-desktop.jpg', media: '(min-width: 1024px)', width: 1920, height: 1080},
        {srcset: 'hero-tablet.jpg', media: '(min-width: 768px)', width: 768, height: 576},
      ];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="hero-mobile.jpg" width="400" height="300" alt="Hero">
        </picture>
      `;
      const fixture = await createTestComponent(template, sources);

      const picture = fixture.nativeElement.querySelector('picture');
      const sourceElements = picture.querySelectorAll('source[data-ng-picture-source]');

      expect(sourceElements.length).toBe(2);

      // Verify first source
      expect(sourceElements[0].getAttribute('media')).toBe('(min-width: 1024px)');
      expect(sourceElements[0].hasAttribute('srcset')).toBe(true);
      expect(sourceElements[0].getAttribute('data-ng-picture-source')).toBe('0');

      // Verify second source
      expect(sourceElements[1].getAttribute('media')).toBe('(min-width: 768px)');
      expect(sourceElements[1].hasAttribute('srcset')).toBe(true);
      expect(sourceElements[1].getAttribute('data-ng-picture-source')).toBe('1');
    });

    it('should insert source elements before the img element', async () => {
      setupTestingModule();

      const sources: PictureSource[] = [{srcset: 'hero-desktop.jpg', media: '(min-width: 1024px)'}];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="hero-mobile.jpg" width="400" height="300" alt="Hero">
        </picture>
      `;
      const fixture = await createTestComponent(template, sources);

      const picture = fixture.nativeElement.querySelector('picture');
      const children = Array.from(picture.children);
      const sourceIndex = children.findIndex((child) => (child as Element).tagName === 'SOURCE');
      const imgIndex = children.findIndex((child) => (child as Element).tagName === 'IMG');

      expect(sourceIndex).toBeLessThan(imgIndex);
    });

    it('should apply type attribute when provided', async () => {
      setupTestingModule();

      const sources: PictureSource[] = [
        {srcset: 'hero.jpg', type: 'image/webp'},
        {srcset: 'hero.jpg', type: 'image/avif'},
      ];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="hero.jpg" width="400" height="300" alt="Hero">
        </picture>
      `;
      const fixture = await createTestComponent(template, sources);

      const picture = fixture.nativeElement.querySelector('picture');
      const sourceElements = picture.querySelectorAll('source[data-ng-picture-source]');

      expect(sourceElements[0].getAttribute('type')).toBe('image/webp');
      expect(sourceElements[1].getAttribute('type')).toBe('image/avif');
    });

    it('should apply sizes attribute when provided', async () => {
      setupTestingModule();

      const sources: PictureSource[] = [
        {srcset: 'hero.jpg', media: '(min-width: 1024px)', sizes: '100vw'},
      ];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="hero.jpg" width="400" height="300" alt="Hero">
        </picture>
      `;
      const fixture = await createTestComponent(template, sources);

      const picture = fixture.nativeElement.querySelector('picture');
      const sourceElement = picture.querySelector('source[data-ng-picture-source]');

      expect(sourceElement.getAttribute('sizes')).toBe('100vw');
    });

    it('should use the image loader to transform src', async () => {
      setupTestingModule({
        imageLoader: (config: ImageLoaderConfig) =>
          config.width
            ? `https://cdn.example.com/${config.src}?w=${config.width}`
            : `https://cdn.example.com/${config.src}`,
      });

      const sources: PictureSource[] = [{srcset: 'hero.jpg', width: 1920, height: 1080}];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="hero.jpg" width="400" height="300" alt="Hero">
        </picture>
      `;
      const fixture = await createTestComponent(template, sources);

      const picture = fixture.nativeElement.querySelector('picture');
      const sourceElement = picture.querySelector('source[data-ng-picture-source]');
      const srcset = sourceElement.getAttribute('srcset');

      expect(srcset).toContain('https://cdn.example.com/hero.jpg?w=1920');
      expect(srcset).toContain('https://cdn.example.com/hero.jpg?w=3840');
    });
  });

  describe('srcset generation', () => {
    it('should generate density-based srcset for fixed-size sources', async () => {
      setupTestingModule({
        imageLoader: (config: ImageLoaderConfig) =>
          `https://cdn.example.com/${config.src}?w=${config.width}`,
      });

      const sources: PictureSource[] = [{srcset: 'hero.jpg', width: 800, height: 600}];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="hero.jpg" width="400" height="300" alt="Hero">
        </picture>
      `;
      const fixture = await createTestComponent(template, sources);

      const picture = fixture.nativeElement.querySelector('picture');
      const sourceElement = picture.querySelector('source[data-ng-picture-source]');
      const srcset = sourceElement.getAttribute('srcset');

      expect(srcset).toContain('https://cdn.example.com/hero.jpg?w=800 1x');
      expect(srcset).toContain('https://cdn.example.com/hero.jpg?w=1600 2x');
    });

    it('should generate responsive srcset when sizes is provided', async () => {
      setupTestingModule({
        imageLoader: (config: ImageLoaderConfig) =>
          `https://cdn.example.com/${config.src}?w=${config.width}`,
        imageConfig: {breakpoints: [640, 768, 1024, 1920]},
      });

      const sources: PictureSource[] = [
        {srcset: 'hero.jpg', sizes: '100vw', width: 1920, height: 1080},
      ];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="hero.jpg" width="400" height="300" alt="Hero">
        </picture>
      `;
      const fixture = await createTestComponent(template, sources);

      const picture = fixture.nativeElement.querySelector('picture');
      const sourceElement = picture.querySelector('source[data-ng-picture-source]');
      const srcset = sourceElement.getAttribute('srcset');

      expect(srcset).toContain('768w');
      expect(srcset).toContain('1024w');
      expect(srcset).toContain('1920w');
    });

    it('should return single source for oversized images', async () => {
      setupTestingModule({
        imageLoader: (config: ImageLoaderConfig) =>
          config.width
            ? `https://cdn.example.com/${config.src}?w=${config.width}`
            : `https://cdn.example.com/${config.src}`,
      });

      const sources: PictureSource[] = [
        {srcset: 'huge.jpg', width: 4000, height: 3000}, // Oversized
      ];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="huge.jpg" width="400" height="300" alt="Huge">
        </picture>
      `;
      const fixture = await createTestComponent(template, sources);

      const picture = fixture.nativeElement.querySelector('picture');
      const sourceElement = picture.querySelector('source[data-ng-picture-source]');
      const srcset = sourceElement.getAttribute('srcset');

      // Should only have single source, no multipliers
      expect(srcset).toBe('https://cdn.example.com/huge.jpg');
    });
  });

  describe('validation and assertions', () => {
    it('should not apply directive to non-picture elements', async () => {
      setupTestingModule();

      const sources: PictureSource[] = [{srcset: 'hero.jpg'}];

      // The directive selector is 'picture[sources]', so it won't match a div
      // This test verifies that the directive simply doesn't apply to non-picture elements
      const template = `
        <div>
          <img ngSrc="hero.jpg" width="400" height="300" alt="Hero">
        </div>
      `;

      // Should not throw - directive simply won't match
      const fixture = await createTestComponent(template, sources);

      const div = fixture.nativeElement.querySelector('div');
      expect(div).toBeTruthy();

      // No source elements should be created since directive didn't match
      const sourceElements = div.querySelectorAll('source');
      expect(sourceElements.length).toBe(0);
    });

    it('should handle empty sources array gracefully', async () => {
      setupTestingModule();

      const sources: PictureSource[] = [];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="hero.jpg" width="400" height="300" alt="Hero">
        </picture>
      `;

      // Should not throw, just not create any source elements
      const fixture = await createTestComponent(template, sources);
      const picture = fixture.nativeElement.querySelector('picture');
      const sourceElements = picture.querySelectorAll('source[data-ng-picture-source]');
      expect(sourceElements.length).toBe(0);
    });

    it('should handle missing ngSrc on img element gracefully', async () => {
      setupTestingModule();

      const sources: PictureSource[] = [{srcset: 'hero.jpg'}];

      const template = `
        <picture [sources]="sources()">
          <img src="hero.jpg" width="400" height="300" alt="Hero">
        </picture>
      `;

      // Should not throw, just not create any source elements
      const fixture = await createTestComponent(template, sources);
      const picture = fixture.nativeElement.querySelector('picture');
      const sourceElements = picture.querySelectorAll('source[data-ng-picture-source]');
      expect(sourceElements.length).toBe(0);
    });
  });

  describe('changes and updates', () => {
    it('should regenerate sources when sources input changes', async () => {
      setupTestingModule();

      const initialSources: PictureSource[] = [
        {srcset: 'hero-v1.jpg', media: '(min-width: 1024px)'},
      ];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="hero.jpg" width="400" height="300" alt="Hero">
        </picture>
      `;
      // Use Default change detection for this test to ensure changes are detected
      const fixture = await createTestComponent(
        template,
        initialSources,
        ChangeDetectionStrategy.Default,
      );

      let picture = fixture.nativeElement.querySelector('picture');
      let sourceElements = picture.querySelectorAll('source[data-ng-picture-source]');
      expect(sourceElements.length).toBe(1);

      // Update sources signal with new array
      const newSources: PictureSource[] = [
        {srcset: 'hero-v2.jpg', media: '(min-width: 1024px)'},
        {srcset: 'hero-v2.jpg', media: '(min-width: 768px)'},
      ];
      fixture.componentInstance.sources.set(newSources);
      fixture.detectChanges();

      picture = fixture.nativeElement.querySelector('picture');
      sourceElements = picture.querySelectorAll('source[data-ng-picture-source]');
      expect(sourceElements.length).toBe(2);
    });
  });

  describe('SSR preload links', () => {
    it('should create preload links for priority images on server', async () => {
      if (!isBrowser) return;

      globalThis['ngServerMode'] = true;

      try {
        setupTestingModule({
          extraProviders: [
            {provide: PLATFORM_ID, useValue: PLATFORM_SERVER_ID},
            {
              provide: IMAGE_LOADER,
              useValue: (config: ImageLoaderConfig) =>
                config.width
                  ? `https://cdn.example.com/${config.src}?w=${config.width}`
                  : `https://cdn.example.com/${config.src}`,
            },
          ],
        });

        const sources: PictureSource[] = [
          {srcset: 'hero-desktop.jpg', media: '(min-width: 1024px)', width: 1920, height: 1080},
        ];

        const template = `
          <picture [sources]="sources()">
            <img ngSrc="hero-mobile.jpg" width="400" height="300" priority alt="Hero">
          </picture>
        `;
        const fixture = await createTestComponent(template, sources);

        const _document = TestBed.inject(DOCUMENT);
        const head = _document.head;

        const preloadLink = head.querySelector('link[rel="preload"][as="image"]');
        expect(preloadLink).toBeTruthy();

        // Clean up
        if (preloadLink) {
          preloadLink.remove();
        }
      } finally {
        globalThis['ngServerMode'] = undefined;
      }
    });
  });

  describe('integration with NgOptimizedImage', () => {
    it('should work with priority images', async () => {
      setupTestingModule();

      const sources: PictureSource[] = [{srcset: 'hero-desktop.jpg', media: '(min-width: 1024px)'}];

      const template = `
        <picture [sources]="sources">
          <img ngSrc="hero-mobile.jpg" width="400" height="300" priority alt="Hero">
        </picture>
      `;
      const fixture = await createTestComponent(template, sources);

      const img = fixture.nativeElement.querySelector('img');
      expect(img.getAttribute('fetchpriority')).toBe('high');
      expect(img.getAttribute('loading')).toBe('eager');
    });

    it('should work with lazy loaded images', async () => {
      setupTestingModule();

      const sources: PictureSource[] = [{srcset: 'hero-desktop.jpg', media: '(min-width: 1024px)'}];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="hero-mobile.jpg" width="400" height="300" alt="Hero">
        </picture>
      `;
      const fixture = await createTestComponent(template, sources);

      const img = fixture.nativeElement.querySelector('img');
      expect(img.getAttribute('loading')).toBe('lazy');
    });

    it('should work with fill mode images', async () => {
      setupTestingModule();

      const sources: PictureSource[] = [{srcset: 'hero-desktop.jpg', media: '(min-width: 1024px)'}];

      const template = `
        <picture [sources]="sources()">
          <img ngSrc="hero-mobile.jpg" fill alt="Hero">
        </picture>
      `;
      const fixture = await createTestComponent(template, sources);

      const img = fixture.nativeElement.querySelector('img');
      expect(img.style.position).toBe('absolute');
      expect(img.style.width).toBe('100%');
      expect(img.style.height).toBe('100%');
    });
  });
});

// Helper functions

@Component({
  selector: 'test-cmp',
  template: '',
  standalone: false,
})
class TestComponent {
  sources: WritableSignal<PictureSource[]> = signal([]);
}

function setupTestingModule(config?: {
  imageConfig?: ImageConfig;
  imageLoader?: ImageLoader;
  noLoader?: boolean;
  extraProviders?: Provider[];
  component?: Type<unknown>;
}) {
  const defaultLoader = (config: ImageLoaderConfig) => {
    const isAbsolute = /^https?:\/\//.test(config.src);
    return isAbsolute ? config.src : window.location.origin + '/' + config.src;
  };
  const loader = config?.imageLoader || defaultLoader;
  const extraProviders = config?.extraProviders || [];
  const providers: Provider[] = [
    {provide: DOCUMENT, useValue: window.document},
    ...(config?.noLoader ? [] : [{provide: IMAGE_LOADER, useValue: loader}]),
    ...extraProviders,
  ];
  if (config?.imageConfig) {
    providers.push({provide: IMAGE_CONFIG, useValue: config.imageConfig});
  }

  TestBed.configureTestingModule({
    declarations: [config?.component ?? TestComponent],
    imports: [CommonModule, NgOptimizedImage, NgOptimizedPicture],
    providers,
  });
}

async function createTestComponent(
  template: string,
  sources: PictureSource[],
  changeDetection = ChangeDetectionStrategy.OnPush,
): Promise<ComponentFixture<TestComponent>> {
  const fixture = TestBed.overrideComponent(TestComponent, {
    set: {template, changeDetection},
  }).createComponent(TestComponent);

  fixture.componentInstance.sources.set(sources);
  fixture.detectChanges(); // Trigger initial change detection
  await fixture.whenStable(); // Wait for all async operations including effects
  return fixture;
}
