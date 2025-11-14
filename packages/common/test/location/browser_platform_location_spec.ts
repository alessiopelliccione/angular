/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {BrowserPlatformLocation} from '@angular/common';

describe('BrowserPlatformLocation (text fragments)', () => {
  let originalHash: string;

  beforeEach(() => {
    originalHash = window.location.hash;
  });

  afterEach(() => {
    window.location.hash = originalHash;
  });

  it('skips the first replaceState when the initial navigation rewrites the same URL', () => {
    window.location.hash = '#:~:text=highlight';
    const platformLocation = new BrowserPlatformLocation();
    const replaceSpy = spyOn(window.history, 'replaceState').and.callThrough();
    const currentUrlWithoutHash = `${window.location.pathname}${window.location.search}`;

    platformLocation.replaceState(null, '', currentUrlWithoutHash);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#:~:text=highlight');

    platformLocation.replaceState(null, '', '/new-route');
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });
});
