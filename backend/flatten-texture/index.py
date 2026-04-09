import urllib.request
import base64
import io
import json
import math
import numpy as np
from PIL import Image, ImageFilter

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}

VARIANTS = {
    "1": "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/files/06880bc5-a28f-41cf-8bc8-e0b9ae9eff70.jpg",
    "2": "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/files/01222b9a-2659-4daa-937e-955313dcd5be.jpg",
    "3": "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/files/28ca8acc-fde6-4407-892f-6aeed886f9a4.jpg",
    "4": "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/files/1caa0a89-819c-4193-8c5e-51826f9fcb04.jpg",
}


def flatten_lighting(img_arr):
    result = img_arr.astype(np.float64)
    for radius in [100, 50]:
        pil_tmp = Image.fromarray(result.clip(0, 255).astype(np.uint8))
        blurred = np.zeros_like(result)
        for ch in range(3):
            ch_blur = pil_tmp.split()[ch].filter(ImageFilter.GaussianBlur(radius=radius))
            blurred[:, :, ch] = np.array(ch_blur, dtype=np.float64)
        means = blurred.mean(axis=(0, 1), keepdims=True)
        result = result * means / np.maximum(blurred, 1.0)
    return result.clip(0, 255)


def normalize_contrast(arr):
    gray = np.mean(arr, axis=2)
    lo = np.percentile(gray, 1)
    hi = np.percentile(gray, 99)
    rng = max(hi - lo, 1.0)
    scale = 200.0 / rng
    offset = 28.0 - lo * scale
    result = arr.astype(np.float64) * scale + offset
    return result.clip(0, 255).astype(np.uint8)


def make_seamless(arr, size):
    h, w = arr.shape[:2]
    half_w, half_h = w // 2, h // 2

    src = arr.astype(np.float64)

    q_tl = src[:half_h, :half_w]
    q_tr = src[:half_h, half_w:half_w*2]
    q_bl = src[half_h:half_h*2, :half_w]
    q_br = src[half_h:half_h*2, half_w:half_w*2]

    qh, qw = q_tl.shape[:2]

    fade_x = np.linspace(0, 1, qw).reshape(1, qw, 1)
    fade_y = np.linspace(0, 1, qh).reshape(qh, 1, 1)

    top = q_tl * (1 - fade_x) + q_tr * fade_x
    bot = q_bl * (1 - fade_x) + q_br * fade_x
    blended = top * (1 - fade_y) + bot * fade_y

    tile = blended.clip(0, 255).astype(np.uint8)

    pil = Image.fromarray(tile)
    if pil.size[0] != size or pil.size[1] != size:
        pil = pil.resize((size, size), Image.LANCZOS)
    return np.array(pil)


def handler(event: dict, context) -> dict:
    """Берёт AI-текстуру Oxford 600D (4 варианта), выравнивает освещение и делает бесшовной"""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    params = event.get('queryStringParameters') or {}
    size = int(params.get('size', '1024'))
    size = max(256, min(1024, size))
    variant = params.get('variant', '2')
    if variant not in VARIANTS:
        variant = '2'

    url = VARIANTS[variant]
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()

    img = Image.open(io.BytesIO(raw)).convert('RGB')
    arr = np.array(img)

    arr = flatten_lighting(arr)
    arr = normalize_contrast(arr.astype(np.uint8))
    result = make_seamless(arr, size)

    pil = Image.fromarray(result)
    buf = io.BytesIO()
    pil.save(buf, format='PNG', optimize=True)
    encoded = base64.b64encode(buf.getvalue()).decode('utf-8')

    return {
        'statusCode': 200,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps({"data": encoded})
    }
