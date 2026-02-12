// import '@testing-library/jest-dom/extend-expect';
// import '@testing-library/jest-dom';

if (typeof global.structuredClone !== 'function') {
  // Jest's jsdom environment may not expose structuredClone.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { structuredClone } = require('node:util');
    if (typeof structuredClone === 'function') {
      global.structuredClone = structuredClone;
    }
  } catch (err) {
    // noop - fallback below
  }
}

if (typeof global.structuredClone !== 'function') {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

if (typeof global.TextEncoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TextEncoder, TextDecoder } = require('node:util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}
