/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {parseTemplate} from '../../../src/render3/view/template';

const ERROR_MESSAGE = 'Conditional ng-content is not supported.';

describe('conditional ng-content diagnostics', () => {
  it('should report an error when <ng-content> is inside a control flow block', () => {
    const template = parseTemplate(
      `
        @if (showContent) {
          <ng-content select="[header]"></ng-content>
        }
      `,
      'test.html',
    );

    expect(template.errors).not.toBeNull();
    const messages = template.errors!.map((error) => error.msg);
    expect(messages).toContain(ERROR_MESSAGE);
  });

  it('should not report an error for <ng-content> outside control flow blocks', () => {
    const template = parseTemplate('<ng-content></ng-content>', 'test.html');
    expect(template.errors).toBeNull();
  });
});
