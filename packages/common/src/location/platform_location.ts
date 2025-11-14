/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {inject, Injectable, InjectionToken, DOCUMENT} from '@angular/core';

import {getDOM} from '../dom_adapter';

const TEXT_FRAGMENT_DIRECTIVE = ':~:text=';
const TEXT_FRAGMENT_DEBUG = true;

/**
 * This class should not be used directly by an application developer. Instead, use
 * {@link Location}.
 *
 * `PlatformLocation` encapsulates all calls to DOM APIs, which allows the Router to be
 * platform-agnostic.
 * This means that we can have different implementation of `PlatformLocation` for the different
 * platforms that Angular supports. For example, `@angular/platform-browser` provides an
 * implementation specific to the browser environment, while `@angular/platform-server` provides
 * one suitable for use with server-side rendering.
 *
 * The `PlatformLocation` class is used directly by all implementations of {@link LocationStrategy}
 * when they need to interact with the DOM APIs like pushState, popState, etc.
 *
 * {@link LocationStrategy} in turn is used by the {@link Location} service which is used directly
 * by the {@link /api/router/Router Router} in order to navigate between routes. Since all interactions between
 * {@link /api/router/Router Router} /
 * {@link Location} / {@link LocationStrategy} and DOM APIs flow through the `PlatformLocation`
 * class, they are all platform-agnostic.
 *
 * @publicApi
 */
@Injectable({providedIn: 'platform', useFactory: () => inject(BrowserPlatformLocation)})
export abstract class PlatformLocation {
  abstract getBaseHrefFromDOM(): string;
  abstract getState(): unknown;
  /**
   * Returns a function that, when executed, removes the `popstate` event handler.
   */
  abstract onPopState(fn: LocationChangeListener): VoidFunction;
  /**
   * Returns a function that, when executed, removes the `hashchange` event handler.
   */
  abstract onHashChange(fn: LocationChangeListener): VoidFunction;

  abstract get href(): string;
  abstract get protocol(): string;
  abstract get hostname(): string;
  abstract get port(): string;
  abstract get pathname(): string;
  abstract get search(): string;
  abstract get hash(): string;

  abstract replaceState(state: any, title: string, url: string): void;

  abstract pushState(state: any, title: string, url: string): void;

  abstract forward(): void;

  abstract back(): void;

  historyGo?(relativePosition: number): void {
    throw new Error(ngDevMode ? 'Not implemented' : '');
  }
}

/**
 * @description
 * Indicates when a location is initialized.
 *
 * @publicApi
 */
export const LOCATION_INITIALIZED = new InjectionToken<Promise<any>>(
  typeof ngDevMode !== undefined && ngDevMode ? 'Location Initialized' : '',
);

/**
 * @description
 * A serializable version of the event from `onPopState` or `onHashChange`
 *
 * @publicApi
 */
export interface LocationChangeEvent {
  type: string;
  state: any;
}

/**
 * @publicApi
 */
export interface LocationChangeListener {
  (event: LocationChangeEvent): any;
}

/**
 * `PlatformLocation` encapsulates all of the direct calls to platform APIs.
 * This class should not be used directly by an application developer. Instead, use
 * {@link Location}.
 *
 * @publicApi
 */
@Injectable({
  providedIn: 'platform',
  useFactory: () => new BrowserPlatformLocation(),
})
export class BrowserPlatformLocation extends PlatformLocation {
  private _location: Location;
  private _history: History;
  private _doc = inject(DOCUMENT);
  private textFragmentHash: string | null = null;
  private readonly initialPathQuery: string;
  private skipInitialReplace = false;

  constructor() {
    super();
    this._location = window.location;
    this._history = window.history;
    this.initialPathQuery = `${this._location.pathname}${this._location.search}`;
    this.textFragmentHash = this.detectInitialTextFragment();
    this.skipInitialReplace = !!this.textFragmentHash;
    if (TEXT_FRAGMENT_DEBUG) {
      // eslint-disable-next-line no-console
      console.warn(
        '[TextFragmentDebug] BrowserPlatformLocation init; hash:',
        this._location.hash,
        'href:',
        this._location.href,
        'detected:',
        this.textFragmentHash,
      );
    }
    if (TEXT_FRAGMENT_DEBUG && !this.textFragmentHash) {
      // eslint-disable-next-line no-console
      console.warn('[TextFragmentDebug] no text fragment detected in initial sources');
    }
  }

  override getBaseHrefFromDOM(): string {
    return getDOM().getBaseHref(this._doc)!;
  }

  override onPopState(fn: LocationChangeListener): VoidFunction {
    const window = getDOM().getGlobalEventTarget(this._doc, 'window');
    window.addEventListener('popstate', fn, false);
    return () => window.removeEventListener('popstate', fn);
  }

  override onHashChange(fn: LocationChangeListener): VoidFunction {
    const window = getDOM().getGlobalEventTarget(this._doc, 'window');
    window.addEventListener('hashchange', fn, false);
    return () => window.removeEventListener('hashchange', fn);
  }

  override get href(): string {
    return this._location.href;
  }
  override get protocol(): string {
    return this._location.protocol;
  }
  override get hostname(): string {
    return this._location.hostname;
  }
  override get port(): string {
    return this._location.port;
  }
  override get pathname(): string {
    return this._location.pathname;
  }
  override get search(): string {
    return this._location.search;
  }
  override get hash(): string {
    return this._location.hash;
  }
  override set pathname(newPath: string) {
    this._location.pathname = newPath;
  }

  override pushState(state: any, title: string, url: string): void {
    const normalizedUrl = this.ensureTextFragment(url, this.currentPathQuery());
    this._history.pushState(state, title, normalizedUrl ?? '');
  }

  override replaceState(state: any, title: string, url: string): void {
    const normalizedUrl = this.ensureTextFragment(url, this.currentPathQuery());
    if (this.skipInitialReplace && this.isSameInitialPath(normalizedUrl)) {
      if (TEXT_FRAGMENT_DEBUG) {
        // eslint-disable-next-line no-console
        console.warn('[TextFragmentDebug] skipping initial replaceState to preserve highlight');
      }
      this.skipInitialReplace = false;
      return;
    }
    this.skipInitialReplace = false;
    this._history.replaceState(state, title, normalizedUrl ?? '');
  }

  override forward(): void {
    this._history.forward();
  }

  override back(): void {
    this._history.back();
  }

  override historyGo(relativePosition: number = 0): void {
    this._history.go(relativePosition);
  }

  override getState(): unknown {
    return this._history.state;
  }

  private ensureTextFragment(
    url: string | URL | null | undefined,
    initialPathQuery: string,
  ): string | null {
    const fragment = this.textFragmentHash;
    if (!fragment) {
      return url == null ? null : String(url);
    }
    if (url == null || url === '') {
      if ((this._doc?.defaultView ?? window).location.hash.includes(TEXT_FRAGMENT_DIRECTIVE)) {
        this.textFragmentHash = null;
        return null;
      }
      return `${initialPathQuery}${fragment}`;
    }
    try {
      const resolved = new URL(String(url), this._location.href);
      const pathQuery = `${resolved.pathname}${resolved.search}`;
      if (pathQuery === initialPathQuery && !resolved.hash.includes(TEXT_FRAGMENT_DIRECTIVE)) {
        resolved.hash = fragment;
        return resolved.toString();
      }
      this.textFragmentHash = null;
      return String(url);
    } catch {
      this.textFragmentHash = null;
      return url == null ? null : String(url);
    }
  }

  private isSameInitialPath(url: string | URL | null | undefined): boolean {
    if (url == null) {
      return true;
    }
    const value = String(url);
    const fragmentIndex = value.indexOf('#');
    const pathQuery = fragmentIndex === -1 ? value : value.slice(0, fragmentIndex);
    return pathQuery === this.initialPathQuery;
  }

  private currentPathQuery(): string {
    return `${this._location.pathname}${this._location.search}`;
  }

  private detectInitialTextFragment(): string | null {
    const sources = [
      this.extractFragment(this._location.href),
      this.extractFragment(this.getNavigationEntryUrl()),
      this.extractFragmentFromFragmentDirective(),
    ];
    for (const fragment of sources) {
      if (fragment) {
        return fragment;
      }
    }
    return null;
  }

  private extractFragment(url: string | null | undefined): string | null {
    if (!url || !url.includes(TEXT_FRAGMENT_DIRECTIVE)) {
      return null;
    }
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) {
      return null;
    }
    return url.substring(hashIndex);
  }

  private getNavigationEntryUrl(): string | null {
    if (typeof performance === 'undefined') {
      return null;
    }
    const navEntries = performance.getEntriesByType?.('navigation') as
      | PerformanceNavigationTiming[]
      | undefined;
    if (navEntries && navEntries.length) {
      return navEntries[0].name;
    }
    const navEntry = (performance as any).navigation;
    if (navEntry && typeof navEntry === 'object' && 'type' in navEntry) {
      return (navEntry as any).name ?? null;
    }
    return null;
  }

  private extractFragmentFromFragmentDirective(): string | null {
    const fragmentDirective = (this._doc as any)?.fragmentDirective;
    const textRanges = fragmentDirective?.text;
    if (!Array.isArray(textRanges) || textRanges.length === 0) {
      return null;
    }
    const firstRange = textRanges[0];
    const textStart = firstRange?.textStart;
    const textEnd = firstRange?.textEnd;
    if (!textStart && !textEnd) {
      return null;
    }
    const encode = (value: string) =>
      value
        .replace(/\s+/g, ' ')
        .split(' ')
        .map((segment) => encodeURIComponent(segment))
        .join(' ');
    if (textStart && textEnd) {
      return `#:~:text=${encode(textStart)},${encode(textEnd)}`;
    }
    const text = textStart ?? textEnd;
    return text ? `#:~:text=${encode(text)}` : null;
  }
}
