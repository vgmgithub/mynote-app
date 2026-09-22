// pay-invoice.js — the receipt as a shareable image, drawn rather than printed.
//
// "Save receipt" used to hand the page to the browser's print dialog, which
// produced whatever it felt like: a header with the site URL, a footer with a
// page number, and a layout that changed with the phone. A receipt for money
// somebody actually paid should look the same every time and stand on its own
// once it leaves the app, so this draws one on a canvas and shares it as a PNG,
// the same way a Health Check snapshot goes out.
//
// It carries the anonymous name in the top corner. That is the one thing that
// lets support match a receipt to an install without anybody having to say who
// they are — the whole reason the name exists.
//
// It is a receipt, not a tax invoice: no GSTIN, no party addresses, and it says
// so in the footer rather than implying something it is not.
// The alias is passed in rather than fetched: this file then depends on nothing
// but pure helpers, so the receipt can be drawn and looked at on its own.
import { formatRupees, STATUS_LABEL } from './pay-core.js';

const W = 384;
const PAD = 18;
const FOOT_H = 46;
const FONT = '-apple-system, Segoe UI, Roboto, Arial, sans-serif';

const INK = '#0e1726';
const MUTED = '#8a94a6';
const LINE = '#e3e7ee';
const GOOD = '#15a06a';
const BAD = '#e2574c';
const WARN = '#c2830a';

function truncate(ctx, text, maxWidth) {
  const t0 = String(text == null ? '' : text);
  if (ctx.measureText(t0).width <= maxWidth) return t0;
  let t = t0;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

let _iconPromise = null;
function loadProIcon() {
  // Resolves to null rather than rejecting: a missing icon should cost the
  // receipt its logo, not the whole share.
  if (!_iconPromise) {
    _iconPromise = new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = 'icons/icon-pro.png';
    });
  }
  return _iconPromise;
}

function drawIcon(ctx, icon, x, y, size) {
  if (!icon) return;
  ctx.save();
  roundRect(ctx, x, y, size, size, size * 0.22);
  ctx.clip();
  ctx.drawImage(icon, x, y, size, size);
  ctx.restore();
}

function rule(ctx, y, x0, x1) {
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y + 0.5);
  ctx.lineTo(x1, y + 0.5);
  ctx.stroke();
}

const STATUS_COLOR = { success: GOOD, failed: BAD, unconfirmed: WARN };

// Every block's height is fixed and known, so the canvas is sized before a
// single pixel is drawn rather than measured afterwards.
function heightFor(rec) {
  const refs = (rec.paymentId ? 1 : 0) + (rec.orderId ? 1 : 0);
  return PAD + 46          // header
    + 46                   // title + number/date
    + 30                   // status pill
    + 24 + 42 + 34         // items head, line item, total
    + (refs ? 16 + refs * 17 + 12 : 0)
    + 60                   // backup note
    + FOOT_H;
}

export async function buildInvoiceCanvas(rec, alias) {
  const icon = await loadProIcon();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const H = heightFor(rec);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Always on white, whatever theme the app is in: this is read by somebody
  // else, in something else.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';

  const right = W - PAD;
  let y = PAD;

  // ---- Header: who this is from, and which install it belongs to ----
  drawIcon(ctx, icon, PAD, y, 36);
  ctx.textAlign = 'left';
  ctx.font = '700 17px ' + FONT;
  ctx.fillStyle = INK;
  ctx.fillText('MyNotes', PAD + 46, y + 13);
  ctx.font = '600 10px ' + FONT;
  ctx.fillStyle = GOOD;
  ctx.fillText('PRO PLAN', PAD + 46, y + 29);

  if (alias) {
    ctx.textAlign = 'right';
    ctx.font = '700 11px ' + FONT;
    ctx.fillStyle = INK;
    ctx.fillText('@' + alias, right, y + 13);
    ctx.font = '400 8px ' + FONT;
    ctx.fillStyle = MUTED;
    ctx.fillText('your anonymous name', right, y + 27);
  }
  y += 46;
  rule(ctx, y, PAD, right);
  y += 18;

  // ---- What this document is ----
  ctx.textAlign = 'left';
  ctx.font = '700 14px ' + FONT;
  ctx.fillStyle = INK;
  ctx.fillText(rec.status === 'success' ? 'Payment receipt' : 'Payment record', PAD, y + 4);

  const when = new Date(rec.at);
  ctx.textAlign = 'right';
  ctx.font = '400 9px ' + FONT;
  ctx.fillStyle = MUTED;
  ctx.fillText(isNaN(when) ? '' : when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }), right, y + 4);
  y += 28;

  // ---- Status, said in a badge as well as a word ----
  const label = STATUS_LABEL[rec.status] || rec.status;
  const color = STATUS_COLOR[rec.status] || MUTED;
  ctx.textAlign = 'left';
  ctx.font = '700 10px ' + FONT;
  const pw = ctx.measureText(label.toUpperCase()).width + 20;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.12;
  roundRect(ctx, PAD, y - 2, pw, 22, 11);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(label.toUpperCase(), PAD + 10, y + 10);

  if (rec.testMode) {
    ctx.textAlign = 'right';
    ctx.font = '700 9px ' + FONT;
    ctx.fillStyle = WARN;
    ctx.fillText('TEST MODE · NO REAL MONEY', right, y + 10);
  }
  y += 30;

  // ---- What was bought ----
  ctx.textAlign = 'left';
  ctx.font = '600 8px ' + FONT;
  ctx.fillStyle = MUTED;
  ctx.fillText('DESCRIPTION', PAD, y + 8);
  ctx.textAlign = 'right';
  ctx.fillText('AMOUNT', right, y + 8);
  y += 16;
  rule(ctx, y, PAD, right);
  y += 8;

  ctx.textAlign = 'left';
  ctx.font = '600 12px ' + FONT;
  ctx.fillStyle = INK;
  ctx.fillText('MyNotes Pro Plan', PAD, y + 11);
  ctx.font = '400 9px ' + FONT;
  ctx.fillStyle = MUTED;
  ctx.fillText('One-time payment, not a subscription', PAD, y + 27);

  const amount = formatRupees(rec.amount) || '—';
  ctx.textAlign = 'right';
  ctx.font = '600 12px ' + FONT;
  ctx.fillStyle = INK;
  ctx.fillText(amount, right, y + 11);
  y += 34;
  rule(ctx, y, PAD, right);
  y += 8;

  ctx.textAlign = 'left';
  ctx.font = '700 12px ' + FONT;
  ctx.fillStyle = INK;
  ctx.fillText(rec.status === 'success' ? 'Total paid' : 'Total', PAD, y + 11);
  ctx.textAlign = 'right';
  ctx.font = '700 15px ' + FONT;
  ctx.fillStyle = rec.status === 'success' ? GOOD : INK;
  ctx.fillText(amount, right, y + 11);
  y += 34;

  // ---- The ids somebody would quote ----
  const refs = [];
  if (rec.paymentId) refs.push(['Transaction ID', rec.paymentId]);
  if (rec.orderId) refs.push(['Order ID', rec.orderId]);
  if (refs.length) {
    const boxH = refs.length * 17 + 12;
    ctx.fillStyle = '#f5f7fa';
    roundRect(ctx, PAD, y, right - PAD, boxH, 8);
    ctx.fill();
    let ry = y + 6;
    for (const [k, v] of refs) {
      ctx.textAlign = 'left';
      ctx.font = '400 9px ' + FONT;
      ctx.fillStyle = MUTED;
      ctx.fillText(k, PAD + 10, ry + 8);
      ctx.textAlign = 'right';
      ctx.font = '600 9px ' + FONT;
      ctx.fillStyle = INK;
      ctx.fillText(truncate(ctx, v, right - PAD - 110), right - 10, ry + 8);
      ry += 17;
    }
    y += boxH + 16;
  }

  // ---- The one thing a Pro member most needs to be told ----
  //
  // Paying does not put anything in a cloud. Somebody who has just spent money
  // is at their most likely to assume it did, so the receipt is exactly where
  // this belongs.
  ctx.fillStyle = '#fff8e6';
  roundRect(ctx, PAD, y, right - PAD, 48, 8);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.font = '700 10px ' + FONT;
  ctx.fillStyle = WARN;
  ctx.fillText('⚠  Take a regular backup', PAD + 10, y + 15);
  ctx.font = '400 9px ' + FONT;
  ctx.fillStyle = '#7a6420';
  ctx.fillText('Your records stay on this device only. Pro does not', PAD + 10, y + 30);
  ctx.fillText('back them up. Menu › Backup & Restore.', PAD + 10, y + 42);

  // ---- Footer ----
  const fy = H - FOOT_H;
  rule(ctx, fy, PAD, right);
  drawIcon(ctx, icon, PAD, fy + 11, 14);
  ctx.textAlign = 'left';
  ctx.font = '700 10px ' + FONT;
  ctx.fillStyle = INK;
  ctx.fillText('MyNotes', PAD + 20, fy + 18);
  ctx.font = '400 7.5px ' + FONT;
  ctx.fillStyle = MUTED;
  ctx.fillText(truncate(ctx, 'Computer-generated receipt, no signature needed. Not a tax invoice.', right - PAD), PAD, fy + 34);

  return canvas;
}

// Out through the share sheet where the phone has one, a download where it does
// not. Says what happened rather than announcing it: the caller owns the toast,
// which keeps this file free of anything that has to know about the app.
function shareCanvas(canvas, filename, title) {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { resolve('failed'); return; }
      const file = new File([blob], filename, { type: 'image/png' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title });
          resolve('shared');
          return;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') { resolve('cancelled'); return; }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve('saved');
    }, 'image/png');
  });
}

// Resolves 'shared', 'saved', 'cancelled' or 'failed'.
export async function shareInvoice(rec, alias) {
  try {
    const canvas = await buildInvoiceCanvas(rec, alias);
    const stamp = (rec.paymentId || rec.orderId || '').replace(/[^A-Za-z0-9_-]/g, '') || 'receipt';
    return await shareCanvas(canvas, 'mynotes-' + stamp + '.png', 'MyNotes receipt');
  } catch (_) {
    return 'failed';
  }
}
