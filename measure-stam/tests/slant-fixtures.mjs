import { createCanvas } from '@napi-rs/canvas';

function grayRaster(width, height, background = 242) {
  return { width, height, format: 'gray', data: new Uint8Array(width * height).fill(background) };
}

function inkPixel(raster, x, y, value = 12) {
  const column = Math.round(x);
  const row = Math.round(y);
  if (column < 0 || column >= raster.width || row < 0 || row >= raster.height) return;
  raster.data[row * raster.width + column] = value;
}

function irregularRoof(raster, x, y, width, thickness = 8) {
  for (let column = x; column < x + width; column++) {
    const upperVariation = column % 19 === 0 ? 1 : 0;
    const lowerVariation = column % 23 === 0 ? 1 : 0;
    for (let row = y + upperVariation; row < y + thickness + lowerVariation; row++) {
      inkPixel(raster, column, row, 8 + (column + row) % 9);
    }
  }
}

function irregularThigh(raster, { rootX, rootY, tipX, tipY, thickness = 8 }) {
  for (let row = rootY; row <= tipY; row++) {
    const progress = (row - rootY) / Math.max(1, tipY - rootY);
    const center = rootX + (tipX - rootX) * progress + Math.sin(progress * Math.PI * 3) * .55;
    const rowThickness = Math.max(5, thickness + ((row - rootY) % 11 === 0 ? 1 : 0) - (progress > .78 ? 1 : 0));
    const left = Math.round(center - (rowThickness - 1) / 2);
    for (let column = left; column < left + rowThickness; column++) {
      inkPixel(raster, column, row, 7 + (column * 3 + row) % 11);
    }
  }
  // A modest, asymmetrical terminal thickening keeps the fixture closer to
  // photographed STaM than a perfect rectangular test bar.
  for (let offsetY = 0; offsetY < 3; offsetY++) {
    const center = Math.round(tipX + offsetY * .6);
    for (let column = center - 4; column <= center + 4 + offsetY; column++) {
      inkPixel(raster, column, tipY + offsetY, 9);
    }
  }
}

function shortVav(raster, x, roofY) {
  irregularRoof(raster, x, roofY, 24, 7);
  irregularThigh(raster, {
    rootX: x + 18,
    rootY: roofY + 4,
    tipX: x + 20,
    tipY: roofY + 27,
    thickness: 7
  });
}

export const IRREGULAR_SLANT_EXPECTATIONS = Object.freeze([
  Object.freeze({ id: 'attached-right-slant', rootX: 82, tipX: 90, angleDeg: -5.7 }),
  Object.freeze({ id: 'attached-left-slant', rootX: 134, tipX: 126, angleDeg: 5.7 }),
  Object.freeze({ id: 'attached-near-vertical', rootX: 298, tipX: 299, angleDeg: -.7 })
]);

export function irregularFixtureRoleForRootX(rootX) {
  const attached = IRREGULAR_SLANT_EXPECTATIONS.find(expected => Math.abs(rootX - expected.rootX) <= 12);
  if (attached) return attached.id;
  if (Math.abs(rootX - 184) <= 15) return 'disconnected-he-leg';
  if (rootX >= 330) return 'short-vav';
  return `unexpected-root-${Math.round(rootX)}`;
}

export function irregularSlantRowFixture() {
  const raster = grayRaster(390, 132);

  irregularRoof(raster, 20, 24, 70, 8);
  irregularThigh(raster, { rootX: 82, rootY: 27, tipX: 90, tipY: 108, thickness: 9 });

  irregularRoof(raster, 126, 23, 74, 8);
  irregularThigh(raster, { rootX: 134, rootY: 26, tipX: 126, tipY: 106, thickness: 9 });

  // Deliberately disconnected left leg of a he.  It is long, close to the
  // roof and stem-width-sized, so proximity-only roof checks misclassify it.
  irregularThigh(raster, { rootX: 184, rootY: 42, tipX: 186, tipY: 91, thickness: 8 });

  irregularRoof(raster, 238, 25, 68, 8);
  irregularThigh(raster, { rootX: 298, rootY: 28, tipX: 299, tipY: 109, thickness: 8 });

  // A nearby short vav has roof support but is not a full-height thigh.
  shortVav(raster, 338, 26);

  // Sparse scan noise and tag-like marks must not alter the candidate set.
  for (const [x, y] of [[7, 18], [15, 113], [215, 66], [326, 119], [375, 10]]) inkPixel(raster, x, y, 26);
  return raster;
}

export function paddedIrregularSlantFixture(height = 500) {
  const row = irregularSlantRowFixture();
  const padded = grayRaster(row.width, height, 255);
  for (let y = 0; y < row.height; y++) {
    padded.data.set(row.data.subarray(y * row.width, (y + 1) * row.width), y * padded.width);
  }
  return padded;
}

export function grayRasterCanvas(raster) {
  const canvas = createCanvas(raster.width, raster.height);
  const context = canvas.getContext('2d');
  const imageData = context.createImageData(raster.width, raster.height);
  for (let index = 0; index < raster.data.length; index++) {
    const value = raster.data[index];
    const offset = index * 4;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}
