import urllib.request
import base64
import io
import json
import math
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}

TEXTURE_URL = "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/files/06880bc5-a28f-41cf-8bc8-e0b9ae9eff70.jpg"

S3 = math.sqrt(3)


def flatten_lighting(img_arr):
    result = img_arr.astype(np.float64)
    for radius in [120, 60, 30]:
        pil_tmp = Image.fromarray(result.clip(0, 255).astype(np.uint8))
        blurred = np.zeros_like(result)
        for ch in range(3):
            ch_blur = pil_tmp.split()[ch].filter(ImageFilter.GaussianBlur(radius=radius))
            blurred[:, :, ch] = np.array(ch_blur, dtype=np.float64)
        means = blurred.mean(axis=(0, 1), keepdims=True)
        result = result * means / np.maximum(blurred, 1.0)
    return result.clip(0, 255)


def desaturate(arr):
    gray = np.mean(arr, axis=2, keepdims=True)
    return np.repeat(gray, 3, axis=2).clip(0, 255)


def normalize_levels(arr):
    gray = np.mean(arr, axis=2)
    lo = np.percentile(gray, 2)
    hi = np.percentile(gray, 98)
    rng = max(hi - lo, 1.0)
    norm = ((gray - lo) / rng).clip(0, 1)
    target = norm * 100 + 100
    scale = target / np.maximum(gray, 1.0)
    return (arr * scale[:, :, np.newaxis]).clip(0, 255).astype(np.uint8)


def make_seamless_tile(img_arr, tile_size):
    h, w = img_arr.shape[:2]
    cx, cy = w // 2, h // 2
    half = tile_size // 2
    x0 = max(0, cx - half)
    y0 = max(0, cy - half)
    crop = img_arr[y0:y0+tile_size, x0:x0+tile_size].astype(np.float64)
    ch, cw = crop.shape[:2]
    if ch < tile_size or cw < tile_size:
        crop = np.array(Image.fromarray(crop.clip(0,255).astype(np.uint8)).resize((tile_size, tile_size), Image.LANCZOS), dtype=np.float64)

    blend_w = tile_size // 4
    result = crop.copy()

    for i in range(blend_w):
        t = i / blend_w
        fade = 0.5 - 0.5 * math.cos(t * math.pi)
        j = tile_size - blend_w + i
        left = result[:, i, :].copy()
        right = result[:, j, :].copy()
        result[:, i, :] = left * fade + right * (1 - fade)
        result[:, j, :] = right * fade + left * (1 - fade)

    for i in range(blend_w):
        t = i / blend_w
        fade = 0.5 - 0.5 * math.cos(t * math.pi)
        j = tile_size - blend_w + i
        top = result[i, :, :].copy()
        bot = result[j, :, :].copy()
        result[i, :, :] = top * fade + bot * (1 - fade)
        result[j, :, :] = bot * fade + top * (1 - fade)

    return result.clip(0, 255).astype(np.uint8)


def hex_vertices(cx, cy, R):
    pts = []
    for i in range(6):
        angle = math.radians(60 * i + 30)
        pts.append((cx + R * math.cos(angle), cy + R * math.sin(angle)))
    return pts


def draw_hex_grid(size, cell_R, line_w):
    W = S3 * cell_R
    H = 2.0 * cell_R

    img = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(img)

    rows = int(math.ceil(size / (H * 0.75))) + 4
    cols = int(math.ceil(size / W)) + 4

    for row in range(-2, rows):
        for col in range(-2, cols):
            off = W * 0.5 if (row & 1) else 0.0
            cx = col * W + off
            cy = row * H * 0.75
            verts = hex_vertices(cx, cy, cell_R)
            for i in range(6):
                x1, y1 = verts[i]
                x2, y2 = verts[(i + 1) % 6]
                draw.line([(x1, y1), (x2, y2)], fill=255, width=line_w)

    return np.array(img, dtype=np.float64) / 255.0


def handler(event: dict, context) -> dict:
    """Комбинирует AI-текстуру ткани с процедурной гексагональной ripstop-сеткой"""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    params = event.get('queryStringParameters') or {}
    size = int(params.get('size', '1024'))
    size = max(256, min(1024, size))

    req = urllib.request.Request(TEXTURE_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()
    img = Image.open(io.BytesIO(raw)).convert('RGB')
    arr = np.array(img)

    arr = flatten_lighting(arr)
    arr = desaturate(arr)
    arr = normalize_levels(arr)

    tile = make_seamless_tile(arr, size)

    cell_R = size / 16.0
    line_w = max(2, int(round(size / 256.0)))

    grid = draw_hex_grid(size, cell_R, line_w)
    grid_blur = np.array(
        Image.fromarray((grid * 255).clip(0,255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(radius=1.2)
        ), dtype=np.float64
    ) / 255.0

    base = tile.astype(np.float64)
    ridge_bright = 35.0
    for ch in range(3):
        base[:, :, ch] += grid_blur * ridge_bright

    base = base.clip(0, 255).astype(np.uint8)

    pil = Image.fromarray(base)
    buf = io.BytesIO()
    pil.save(buf, format='PNG', optimize=True)
    encoded = base64.b64encode(buf.getvalue()).decode('utf-8')

    return {
        'statusCode': 200,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps({"data": encoded})
    }
