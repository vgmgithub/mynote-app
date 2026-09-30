// app.js was split into several modules (the code did not change, only where it lives). Tests that check the
// app's source for a piece of code read them together, so a test does not care which file the code sits in.
import { readFileSync } from 'node:fs';
const PARTS = ['app.js', 'app-lock-ui.js', 'feature-picker.js', 'stocks-profiles.js', 'home-rates.js', 'ocr-ui.js'];
export const appSource = () => PARTS.map((f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')).join('\n');
