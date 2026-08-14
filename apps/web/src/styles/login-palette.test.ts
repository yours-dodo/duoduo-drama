import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const globalStyles = readFileSync(
  new URL('./global.css', import.meta.url),
  'utf8',
);
const loginStyles = [...globalStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, selector]) => selector.includes('login-page'))
  .map(([, , declarations]) => declarations)
  .join('\n');
const loginFooterStyles =
  [...globalStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.includes('body.login-page .site-footer'))
    .reverse()
    .find(
      ([, , declarations]) =>
        declarations.includes('background: #151517;') &&
        declarations.includes(
          'border-top: 1px solid rgba(245, 243, 239, 0.12);',
        ),
    )?.[2] ?? '';
const darkLoginFooterStyles =
  [...globalStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) =>
      selector.includes("html[data-theme='dark'] body.login-page .site-footer"),
    )
    .at(-1)?.[2] ?? '';

describe('login page palette', () => {
  it('keeps login-specific surfaces and status colors out of the green family', () => {
    expect(loginStyles).not.toMatch(
      /#(?:0b1712|102219|172d22|0d1c15|a4b3aa|d4dfd7|8fd4a9|9bd1ad|d8e0da|707a73|1a251e|718278|eef4ef|e5eee6|f8fbf8|163124|526b5b|2d4b39|267a49|162b1f|e9efe9|f5f7f4|2a7a4b)|rgba\((?:35,\s*93,\s*61|214,\s*238,\s*220|5,\s*14,\s*9|229,\s*238,\s*230|22,\s*49,\s*36|22,\s*43,\s*31)/i,
    );
  });

  it('uses a gray band to separate the footer from the black canvas', () => {
    expect(loginFooterStyles).toContain('background: #151517;');
    expect(loginFooterStyles).toContain(
      'border-top: 1px solid rgba(245, 243, 239, 0.12);',
    );
    expect(darkLoginFooterStyles).toContain('background: #151517;');
  });
});
