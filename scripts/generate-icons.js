#!/usr/bin/env node
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BLUE = '#4A90D9';
const WHITE = '#FFFFFF';

// Draw a pill capsule icon on the canvas
function drawPillIcon(ctx, cx, cy, size) {
  const pillW = size * 0.55;
  const pillH = size * 0.22;
  const r = pillH / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 6); // slight tilt

  // Full capsule outline
  ctx.beginPath();
  ctx.moveTo(-pillW / 2 + r, -pillH / 2);
  ctx.lineTo(pillW / 2 - r, -pillH / 2);
  ctx.arc(pillW / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(-pillW / 2 + r, pillH / 2);
  ctx.arc(-pillW / 2 + r, 0, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = WHITE;
  ctx.fill();

  // Left half slightly darker to show capsule halves
  ctx.save();
  ctx.beginPath();
  ctx.rect(-pillW / 2 - 1, -pillH / 2 - 1, pillW / 2 + 1, pillH + 2);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(-pillW / 2 + r, -pillH / 2);
  ctx.lineTo(0, -pillH / 2);
  ctx.lineTo(0, pillH / 2);
  ctx.lineTo(-pillW / 2 + r, pillH / 2);
  ctx.arc(-pillW / 2 + r, 0, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();
  ctx.restore();

  // Plus/cross below the pill
  ctx.restore();
  const crossSize = size * 0.12;
  const crossThick = size * 0.04;
  const crossY = cy + size * 0.22;
  ctx.fillStyle = WHITE;
  ctx.fillRect(cx - crossSize / 2, crossY - crossThick / 2, crossSize, crossThick);
  ctx.fillRect(cx - crossThick / 2, crossY - crossSize / 2, crossThick, crossSize);
}

// Generate master 1024x1024 icon
function generateMaster() {
  const S = 1024;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');

  // Background with rounded corners
  const r = S * 0.22; // iOS-style corner radius
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(S - r, 0);
  ctx.quadraticCurveTo(S, 0, S, r);
  ctx.lineTo(S, S - r);
  ctx.quadraticCurveTo(S, S, S - r, S);
  ctx.lineTo(r, S);
  ctx.quadraticCurveTo(0, S, 0, S - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = BLUE;
  ctx.fill();

  // Draw pill icon centered
  drawPillIcon(ctx, S / 2, S * 0.42, S);

  // App name text
  ctx.fillStyle = WHITE;
  ctx.font = `bold ${S * 0.065}px -apple-system, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MediTrack', S / 2, S * 0.72);

  return canvas;
}

// Resize canvas to target size
function resize(srcCanvas, targetSize) {
  const canvas = createCanvas(targetSize, targetSize);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0, targetSize, targetSize);
  return canvas;
}

// Generate a logo-only version (no text, no background) for splash screen
function generateSplashLogo() {
  const S = 512;
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');

  // Transparent background — draw just the pill + cross in white
  drawPillIcon(ctx, S / 2, S * 0.42, S);

  // Plus/cross is already drawn by drawPillIcon, but let's add the text
  ctx.fillStyle = WHITE;
  ctx.font = `bold ${S * 0.08}px -apple-system, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MediTrack', S / 2, S * 0.72);

  return canvas;
}

function savePNG(canvas, filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(filePath, buf);
  console.log(`  ✓ ${path.relative(ROOT, filePath)} (${canvas.width}x${canvas.height})`);
}

// --- Main ---
console.log('Generating app icons...\n');
const master = generateMaster();

// iOS icons
const IOS_DIR = path.join(ROOT, 'ios/MedicineTracker/Images.xcassets/AppIcon.appiconset');
const IOS_SIZES = [
  { size: 20, scale: 2, px: 40,   file: 'Icon-20@2x.png' },
  { size: 20, scale: 3, px: 60,   file: 'Icon-20@3x.png' },
  { size: 29, scale: 2, px: 58,   file: 'Icon-29@2x.png' },
  { size: 29, scale: 3, px: 87,   file: 'Icon-29@3x.png' },
  { size: 40, scale: 2, px: 80,   file: 'Icon-40@2x.png' },
  { size: 40, scale: 3, px: 120,  file: 'Icon-40@3x.png' },
  { size: 60, scale: 2, px: 120,  file: 'Icon-60@2x.png' },
  { size: 60, scale: 3, px: 180,  file: 'Icon-60@3x.png' },
  { size: 1024, scale: 1, px: 1024, file: 'Icon-1024.png' },
];

console.log('iOS icons:');
for (const entry of IOS_SIZES) {
  const resized = resize(master, entry.px);
  savePNG(resized, path.join(IOS_DIR, entry.file));
}

// Android icons
const ANDROID_RES = path.join(ROOT, 'android/app/src/main/res');
const ANDROID_SIZES = [
  { dir: 'mipmap-mdpi',    px: 48  },
  { dir: 'mipmap-hdpi',    px: 72  },
  { dir: 'mipmap-xhdpi',   px: 96  },
  { dir: 'mipmap-xxhdpi',  px: 144 },
  { dir: 'mipmap-xxxhdpi', px: 192 },
];

console.log('\nAndroid icons:');
for (const entry of ANDROID_SIZES) {
  const resized = resize(master, entry.px);
  savePNG(resized, path.join(ANDROID_RES, entry.dir, 'ic_launcher.png'));
  savePNG(resized, path.join(ANDROID_RES, entry.dir, 'ic_launcher_round.png'));
}

// Splash logo (white on transparent)
console.log('\nSplash logo:');
const splashLogo = generateSplashLogo();
savePNG(splashLogo, path.join(ROOT, 'assets/bootsplash-logo.png'));

console.log('\nDone! All icons generated.');
