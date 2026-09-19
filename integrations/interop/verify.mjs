/**
 * Drives the three interop paths in a real browser.
 *
 * What each check is really asking:
 *
 * - a custom element is just an element — props are properties, and an event
 *   with a hyphen in its name reaches a Firsthand handler;
 * - a React component renders, calls back into Firsthand, and takes updated props
 *   from it;
 * - a styled component styles, and a prop that only feeds a declaration's
 *   value does not multiply the stylesheet.
 *
 *   npm install && npm test
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, 'dist');

// Playwright lives in the repository root, not in this package: the
// integration is deliberately outside the workspace, so a bare import would
// not resolve, and an absolute path would only work on one machine.
const { chromium } = await import(
  pathToFileURL(resolve(here, '..', '..', 'node_modules', '@playwright/test', 'index.mjs')).href
);

console.log('building…');
execFileSync(process.execPath, [resolve(here, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
  cwd: here,
  stdio: 'inherit',
});

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((request, response) => {
  let path = (request.url ?? '/').split('?')[0];
  if (path.endsWith('/')) path += 'index.html';
  readFile(join(dist, path))
    .then((body) => {
      response.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'text/plain' });
      response.end(body);
    })
    .catch(() => {
      response.writeHead(404);
      response.end('not found');
    });
});
// Port 0: a run that crashed and left its server behind must not make the
// next run test the previous build.
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];
const check = async (what, run) => {
  try {
    await run();
    console.log(`ok   ${what}`);
  } catch (error) {
    failures.push(what);
    console.error(`FAIL ${what}\n     ${String(error)}`);
  }
};

await page.goto(`http://127.0.0.1:${String(port)}/`);
await page.locator('[data-testid="sl-button"]').waitFor();

// --- Web components ---------------------------------------------------------

await check('a custom element renders and its click reaches Firsthand', async () => {
  const button = page.getByTestId('sl-button');
  // Shoelace really upgraded it, rather than leaving an unknown element.
  const upgraded = await button.evaluate((element) => element.shadowRoot !== null);
  if (!upgraded) {
    throw new Error('sl-button was never upgraded: the custom element did not register');
  }
  await button.click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="sl-button"]')?.textContent?.includes('1') === true,
  );
});

await check('an event with a hyphen in its name reaches a Firsthand handler', async () => {
  // `on:sl-change` — no casing of an identifier produces that name.
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByTestId('sl-switch').click();
  await page.waitForFunction(
    (was) => getComputedStyle(document.body).backgroundColor !== was,
    before,
  );
});

await check('a custom element property set from a signal updates it', async () => {
  await page.getByTestId('sl-rating').evaluate((element) => {
    element.value = 5;
    element.dispatchEvent(new CustomEvent('sl-change', { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="rating-echo"]')?.textContent === 'Rated 5 of 5',
  );
});

// --- React ------------------------------------------------------------------

await check('a MUI component renders through the bridge', async () => {
  const classes = await page.getByTestId('mui-button').getAttribute('class');
  if (classes === null || !classes.includes('MuiButton')) {
    throw new Error(`no MUI classes on the button: ${String(classes)}`);
  }
});

await check('a React event calls back into Firsthand, and Firsthand updates React', async () => {
  const chip = page.getByTestId('mui-chip');
  const before = await chip.textContent();
  await page.getByTestId('mui-button').click();
  // The counter is Firsthand's; the chip is React's; the click came from React.
  await page.waitForFunction(
    (was) => document.querySelector('[data-testid="mui-chip"]')?.textContent !== was,
    before,
  );
});

await check('a MUI slider drives a Firsthand signal', async () => {
  const slider = page.getByTestId('mui-slider').locator('input[type="range"]');
  await slider.evaluate((input) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '70');
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="volume-echo"]')?.textContent === 'Volume 70',
  );
});

// --- Styled -----------------------------------------------------------------

await check('styled components style, and share one rule across instances', async () => {
  const swatch = page.getByTestId('swatch-3');
  const colour = await swatch.evaluate((element) => getComputedStyle(element).backgroundColor);
  if (!colour.startsWith('rgb')) {
    throw new Error(`the swatch has no background: ${colour}`);
  }

  // Five swatches, five different hues, and the hue is a value interpolation:
  // one rule, not five.
  const counts = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll('style[data-firsthand-styled]')];
    const rules = sheets.flatMap((sheet) => [...sheet.childNodes].map((node) => node.textContent));
    const swatchClass = document
      .querySelector('[data-testid="swatch-0"]')
      ?.className.split(' ')[0]
      ?.split('-')[0];
    return {
      total: rules.length,
      forSwatch: rules.filter((rule) => rule?.startsWith(`.${String(swatchClass)}`)).length,
    };
  });
  if (counts.forSwatch > 2) {
    throw new Error(`${String(counts.forSwatch)} rules for the swatches; expected at most 2`);
  }
  console.log(
    `     (${String(counts.total)} rules in the sheet, ${String(counts.forSwatch)} for five swatches)`,
  );
});

await check('a block interpolation swaps the class, and only that', async () => {
  const before = await page.getByTestId('swatch-0').getAttribute('class');
  await page.getByTestId('swatch-0').click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="swatch-echo"]')?.textContent ===
      'Swatch 0 is highlighted',
  );
  const after = await page.getByTestId('swatch-0').getAttribute('class');
  if (before === after) {
    throw new Error('the highlighted swatch did not change class');
  }
});

await check('a React component written directly as an element renders', async () => {
  // `@firsthandjs/react/auto`, not `fromReact`: no bridge was declared for this
  // component anywhere in the application.
  const alert = page.getByTestId('mui-alert');
  await alert.waitFor();
  const classes = await alert.evaluate((element) =>
    element.querySelector('.MuiAlert-root') === null ? element.className : 'MuiAlert-root',
  );
  if (!String(classes).includes('MuiAlert')) {
    throw new Error(`MUI did not render it: ${String(classes)}`);
  }
});

await check('one MUI theme reaches every bridged root', async () => {
  const colour = () =>
    page.getByTestId('mui-alert').evaluate((element) => {
      const root = element.querySelector('.MuiAlert-root') ?? element;
      return getComputedStyle(root).backgroundColor;
    });

  const before = await colour();
  // The Shoelace switch drives the theme; MUI is on the other side of the page
  // and follows it only because a provider wraps every bridged root.
  await page.getByTestId('sl-switch').click();
  await page.waitForFunction((was) => {
    const element = document.querySelector('[data-testid="mui-alert"]');
    const root = element?.querySelector('.MuiAlert-root') ?? element;
    return root !== null && getComputedStyle(root).backgroundColor !== was;
  }, before);
  await page.getByTestId('sl-switch').click();
});

await check('a styled component styled again wins on specificity', async () => {
  const panel = page.getByTestId('roomy-panel');
  const [classes, padding] = await panel.evaluate((element) => [
    element.className.split(' ').length,
    getComputedStyle(element).paddingLeft,
  ]);
  if (classes !== 2) {
    throw new Error(`expected both classes on the element, found ${String(classes)}`);
  }
  if (padding !== '36px') {
    throw new Error(`the outer declaration did not win: padding-left is ${padding}`);
  }
});

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} of 8 checks failed`);
  process.exit(1);
}
console.log('\nWeb components, React components and styled components all work in Firsthand.');
