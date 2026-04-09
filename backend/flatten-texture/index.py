import urllib.request
import base64
import io
import json
import numpy as np
from PIL import Image, ImageFilter

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}

TEXTURE_URL = "https://cdn.poehali.dev/projects/5a15539d-2e23-46d4-9ae4-0b3d25a0b619/files/06880bc5-a28f-41cf-8bc8-e0b9ae9eff70.jpg"


def flatten_lighting(img_arr):
    result = img_arr.astype(np.float64)
    for radius in [150, 80, 40]:
        pil_tmp = Image.fromarray(result.clip(0, 255).astype(np.uint8))
        blurred = np.zeros_like(result)
        for ch in range(3):
            ch_blur = pil_tmp.split()[ch].filter(ImageFilter.GaussianBlur(radius=radius))
            blurred[:, :, ch] = np.array(ch_blur, dtype=np.float64)
        means = blurred.mean(axis=(0, 1), keepdims=True)
        result = result * means / np.maximum(blurred, 1.0)
    return result.clip(0, 255)


def desaturate_to_neutral(arr):
    gray = np.mean(arr, axis=2, keepdims=True)
    return (gray * np.ones((1, 1, 3))).clip(0, 255)


def unify_edges(result):
    gray = np.mean(result, axis=2)
    smooth = np.array(
        Image.fromarray(gray.clip(0, 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(radius=2)
        ), dtype=np.float64
    )
    sx = np.zeros_like(smooth)
    sy = np.zeros_like(smooth)
    sx[:, 1:-1] = np.abs(smooth[:, 2:] - smooth[:, :-2]) / 2.0
    sy[1:-1, :] = np.abs(smooth[2:, :] - smooth[:-2, :]) / 2.0
    edge_str = np.sqrt(sx**2 + sy**2)

    thresh = np.percentile(edge_str, 70)
    edge_mask = edge_str > thresh
    if edge_mask.sum() < 50:
        return result

    target = np.median(gray[edge_mask])
    local = np.array(
        Image.fromarray(gray.clip(0, 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(radius=10)
        ), dtype=np.float64
    )
    corr = np.ones_like(gray)
    corr[edge_mask] = target / np.maximum(local[edge_mask], 1.0)

    corr_smooth = np.array(
        Image.fromarray((corr * 128).clip(0, 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(radius=5)
        ), dtype=np.float64
    ) / 128.0

    blend = np.minimum(edge_str / max(thresh, 1.0), 1.0)
    final = 1.0 + (corr_smooth - 1.0) * blend
    return (result * final[:, :, np.newaxis]).clip(0, 255)


def normalize_neutral(result, target_mid=145):
    gray = np.mean(result, axis=2)
    lo = np.percentile(gray, 1)
    hi = np.percentile(gray, 99)
    rng = max(hi - lo, 1.0)
    norm = ((gray - lo) / rng).clip(0, 1)
    target = norm * 160 + 65
    scale = target / np.maximum(gray, 1.0)
    return (result * scale[:, :, np.newaxis]).clip(0, 255).astype(np.uint8)


def make_seamless(img_arr, size=512):
    h, w = img_arr.shape[:2]
    if h != size or w != size:
        img_arr = np.array(Image.fromarray(img_arr).resize((size, size), Image.LANCZOS))
        h, w = size, size

    blend_w = size // 4
    result = img_arr.astype(np.float64)

    for i in range(blend_w):
        t = i / blend_w
        fade = 0.5 - 0.5 * np.cos(t * np.pi)
        j = w - blend_w + i
        left = result[:, i, :].copy()
        right = result[:, j, :].copy()
        mixed_l = left * fade + right * (1 - fade)
        mixed_r = right * fade + left * (1 - fade)
        result[:, i, :] = mixed_l
        result[:, j, :] = mixed_r

    for i in range(blend_w):
        t = i / blend_w
        fade = 0.5 - 0.5 * np.cos(t * np.pi)
        j = h - blend_w + i
        top = result[i, :, :].copy()
        bot = result[j, :, :].copy()
        mixed_t = top * fade + bot * (1 - fade)
        mixed_b = bot * fade + top * (1 - fade)
        result[i, :, :] = mixed_t
        result[j, :, :] = mixed_b

    edge = 8
    for i in range(edge):
        t = i / edge
        fade = t * t * (3 - 2 * t)
        result[i, :, :] = result[i, :, :] * fade + result[edge, :, :] * (1 - fade)
        result[h - 1 - i, :, :] = result[h - 1 - i, :, :] * fade + result[h - 1 - edge, :, :] * (1 - fade)
        result[:, i, :] = result[:, i, :] * fade + result[:, edge, :] * (1 - fade)
        result[:, w - 1 - i, :] = result[:, w - 1 - i, :] * fade + result[:, w - 1 - edge, :] * (1 - fade)

    return Image.fromarray(result.clip(0, 255).astype(np.uint8))


def handler(event: dict, context) -> dict:
    """Загружает AI-текстуру Oxford 600D, выравнивает в нейтральный серый, делает бесшовной"""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    params = event.get('queryStringParameters') or {}
    size = int(params.get('size', '512'))
    size = max(256, min(1024, size))

    req = urllib.request.Request(TEXTURE_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()

    img = Image.open(io.BytesIO(raw)).convert('RGB')
    arr = np.array(img)

    arr = flatten_lighting(arr)
    arr = desaturate_to_neutral(arr)
    arr = unify_edges(arr)
    arr = normalize_neutral(arr)
    seamless = make_seamless(arr, size)

    buf = io.BytesIO()
    seamless.save(buf, format='PNG', optimize=True)
    encoded = base64.b64encode(buf.getvalue()).decode('utf-8')

    return {
        'statusCode': 200,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps({"data": encoded})
    }
