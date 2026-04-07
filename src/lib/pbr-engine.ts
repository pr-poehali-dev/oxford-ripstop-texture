const GENERATE_URL = "https://functions.poehali.dev/76de743a-27ec-4cc9-ac1e-8908beb4387b";

export type MapKey = "baseColor" | "normal" | "roughness" | "ao" | "gloss";

export const MAPS: Record<MapKey, { tag: string; label: string; hint: string }> = {
  baseColor: { tag: "BASE COLOR", label: "Цвет поверхности",   hint: "Слот: Diffuse / Base Color" },
  normal:    { tag: "NORMAL",     label: "Карта рельефа",      hint: "Слот: Normal / Bump" },
  roughness: { tag: "ROUGHNESS",  label: "Шероховатость",      hint: "Слот: Roughness" },
  ao:        { tag: "AO",         label: "Затенение впадин",   hint: "Слот: Ambient Occlusion" },
  gloss:     { tag: "GLOSS",      label: "Блеск / Glossiness", hint: "Слот: Specular / Reflection" },
};

export async function loadFlattenedTexture(size = 512): Promise<ImageData> {
  const resp = await fetch(`${GENERATE_URL}?size=${size}`);
  if (!resp.ok) throw new Error("Flatten error");
  const json = await resp.json();
  const bin = atob(json.data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: "image/png" });
  const bmp = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size });
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, size, size);
}

function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function gaussBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const sigma = radius / 2;
  const twoSigSq = 2 * sigma * sigma;
  const kernelSize = Math.ceil(radius * 2) | 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, weight = 0;
      for (let k = -kernelSize; k <= kernelSize; k++) {
        const xx = Math.max(0, Math.min(w - 1, x + k));
        const w_ = Math.exp(-(k * k) / twoSigSq);
        sum += src[y * w + xx] * w_;
        weight += w_;
      }
      tmp[y * w + x] = sum / weight;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, weight = 0;
      for (let k = -kernelSize; k <= kernelSize; k++) {
        const yy = Math.max(0, Math.min(h - 1, y + k));
        const w_ = Math.exp(-(k * k) / twoSigSq);
        sum += tmp[yy * w + x] * w_;
        weight += w_;
      }
      out[y * w + x] = sum / weight;
    }
  }
  return out;
}

function makeBaseColor(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const rF = new Float32Array(w * h);
  const gF = new Float32Array(w * h);
  const bF = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    rF[i] = data[i*4];
    gF[i] = data[i*4+1];
    bF[i] = data[i*4+2];
  }
  const blurR = gaussBlur(rF, w, h, 80);
  const blurG = gaussBlur(gF, w, h, 80);
  const blurB = gaussBlur(bF, w, h, 80);
  let avgL = 0;
  for (let i = 0; i < w * h; i++) avgL += luma(blurR[i], blurG[i], blurB[i]);
  avgL /= (w * h);
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const scale = avgL / Math.max(1, luma(blurR[i], blurG[i], blurB[i]));
    out.data[i*4]   = Math.max(0, Math.min(255, Math.round(rF[i] * scale)));
    out.data[i*4+1] = Math.max(0, Math.min(255, Math.round(gF[i] * scale)));
    out.data[i*4+2] = Math.max(0, Math.min(255, Math.round(bF[i] * scale)));
    out.data[i*4+3] = 255;
  }
  return out;
}

function makeNormal(src: ImageData, strength: number): ImageData {
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const smoothGray = gaussBlur(gray, w, h, 1.5);
  const g = (x: number, y: number) =>
    smoothGray[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = -g(x-1,y-1) - 2*g(x-1,y) - g(x-1,y+1) + g(x+1,y-1) + 2*g(x+1,y) + g(x+1,y+1);
      const dy = -g(x-1,y-1) - 2*g(x,y-1) - g(x+1,y-1) + g(x-1,y+1) + 2*g(x,y+1) + g(x+1,y+1);
      const nx = (dx / 255) * strength, ny = (dy / 255) * strength, nz = 1;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
      const i = (y * w + x) * 4;
      out.data[i]   = Math.round((nx/len*0.5+0.5)*255);
      out.data[i+1] = Math.round((ny/len*0.5+0.5)*255);
      out.data[i+2] = Math.round((nz/len*0.5+0.5)*255);
      out.data[i+3] = 255;
    }
  }
  return out;
}

function makeRoughness(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = luma(data[i*4], data[i*4+1], data[i*4+2]);
  const smooth = gaussBlur(gray, w, h, 3);
  let mn = 255, mx = 0;
  for (let i = 0; i < w * h; i++) {
    const hf = Math.abs(gray[i] - smooth[i]);
    if (hf < mn) mn = hf;
    if (hf > mx) mx = hf;
  }
  const range = Math.max(1, mx - mn);
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const hf = Math.abs(gray[i] - smooth[i]);
    const v = Math.round(((hf - mn) / range) * 255);
    out.data[i*4] = out.data[i*4+1] = out.data[i*4+2] = v;
    out.data[i*4+3] = 255;
  }
  return out;
}

function makeAO(src: ImageData, radius: number): ImageData {
  const { width: w, height: h, data } = src;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = luma(data[i*4], data[i*4+1], data[i*4+2]);
  const blurred = gaussBlur(gray, w, h, radius * 4);
  let mn = 255, mx = 0;
  for (let i = 0; i < w * h; i++) {
    const diff = Math.max(0, blurred[i] - gray[i]);
    if (diff < mn) mn = diff;
    if (diff > mx) mx = diff;
  }
  const range = Math.max(1, mx - mn);
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const diff = Math.max(0, blurred[i] - gray[i]);
    const v = 255 - Math.round(((diff - mn) / range) * 200);
    out.data[i*4] = out.data[i*4+1] = out.data[i*4+2] = Math.max(0, Math.min(255, v));
    out.data[i*4+3] = 255;
  }
  return out;
}

function makeGloss(src: ImageData): ImageData {
  const { width: w, height: h, data } = src;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = luma(data[i*4], data[i*4+1], data[i*4+2]);
  let mn = 255, mx = 0;
  for (let i = 0; i < w * h; i++) { if (gray[i] < mn) mn = gray[i]; if (gray[i] > mx) mx = gray[i]; }
  const range = Math.max(1, mx - mn);
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(((gray[i] - mn) / range) * 255);
    out.data[i*4] = out.data[i*4+1] = out.data[i*4+2] = v;
    out.data[i*4+3] = 255;
  }
  return out;
}

function colorizeTexture(src: ImageData, hex: string): ImageData {
  const r0 = parseInt(hex.slice(1,3), 16);
  const g0 = parseInt(hex.slice(3,5), 16);
  const b0 = parseInt(hex.slice(5,7), 16);
  const { width: w, height: h, data } = src;
  const out = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const l = luma(data[i*4], data[i*4+1], data[i*4+2]) / 255;
    out.data[i*4]   = Math.max(0, Math.min(255, Math.round(r0 * l)));
    out.data[i*4+1] = Math.max(0, Math.min(255, Math.round(g0 * l)));
    out.data[i*4+2] = Math.max(0, Math.min(255, Math.round(b0 * l)));
    out.data[i*4+3] = 255;
  }
  return out;
}

function toDataURL(id: ImageData): string {
  const c = document.createElement("canvas");
  c.width = id.width; c.height = id.height;
  c.getContext("2d")!.putImageData(id, 0, 0);
  return c.toDataURL("image/png");
}

export function buildAllMaps(img: ImageData, normalStr: number, aoRadius: number, color: string): Record<MapKey, string> {
  const colored = color === "#808080" ? img : colorizeTexture(img, color);
  return {
    baseColor: toDataURL(makeBaseColor(colored)),
    normal:    toDataURL(makeNormal(img, normalStr)),
    roughness: toDataURL(makeRoughness(img)),
    ao:        toDataURL(makeAO(img, aoRadius)),
    gloss:     toDataURL(makeGloss(img)),
  };
}