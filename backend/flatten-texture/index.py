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


def flatten_lighting(img_arr):
    """Многопроходное выравнивание освещения — убирает градиент и блики полностью"""
    h, w, c = img_arr.shape
    result = img_arr.astype(np.float64)

    for radius in [120, 60, 30]:
        blurred = np.zeros_like(result)
        pil_tmp = Image.fromarray(result.clip(0, 255).astype(np.uint8))
        for ch in range(3):
            ch_img = pil_tmp.split()[ch]
            ch_blur = ch_img.filter(ImageFilter.GaussianBlur(radius=radius))
            blurred[:, :, ch] = np.array(ch_blur, dtype=np.float64)

        channel_means = blurred.mean(axis=(0, 1), keepdims=True)
        safe_blur = np.maximum(blurred, 1.0)
        result = result * channel_means / safe_blur

    result = result.clip(0, 255)

    gray = 0.2126 * result[:,:,0] + 0.7152 * result[:,:,1] + 0.0722 * result[:,:,2]
    pil_gray = Image.fromarray(gray.clip(0, 255).astype(np.uint8))
    local_avg = np.array(pil_gray.filter(ImageFilter.GaussianBlur(radius=6)), dtype=np.float64)
    spec_mask = gray / np.maximum(local_avg, 1.0)
    dampen = np.where(spec_mask > 1.08, 1.08 / spec_mask, 1.0)
    result *= dampen[:, :, np.newaxis]

    gray2 = 0.2126 * result[:,:,0] + 0.7152 * result[:,:,1] + 0.0722 * result[:,:,2]
    mn, mx = gray2.min(), gray2.max()
    rng = max(mx - mn, 1.0)
    norm = (gray2 - mn) / rng
    target_l = norm * 200 + 28
    scale = target_l / np.maximum(gray2, 1.0)
    result *= scale[:, :, np.newaxis]

    return result.clip(0, 255).astype(np.uint8)


def make_seamless(img_arr, out_size=512):
    """Обрезает центр и делает crossfade по краям для бесшовного тайлинга"""
    h, w, c = img_arr.shape
    margin = min(w, h) // 8
    cx, cy = w // 2, h // 2
    half = min(cx - margin, cy - margin, out_size)
    crop = img_arr[cy - half:cy + half, cx - half:cx + half].copy()
    ch, cw = crop.shape[:2]

    blend_w = cw // 6
    result = crop.astype(np.float64)

    for i in range(blend_w):
        t = i / blend_w
        fade = 0.5 - 0.5 * np.cos(t * np.pi)
        result[:, i, :] = crop[:, i, :] * fade + crop[:, cw - blend_w + i, :] * (1 - fade)
        result[:, cw - blend_w + i, :] = crop[:, cw - blend_w + i, :] * fade + crop[:, i, :] * (1 - fade)

    for i in range(blend_w):
        t = i / blend_w
        fade = 0.5 - 0.5 * np.cos(t * np.pi)
        result[i, :, :] = result[i, :, :] * fade + result[ch - blend_w + i, :, :] * (1 - fade)
        result[ch - blend_w + i, :, :] = result[ch - blend_w + i, :, :] * fade + result[i, :, :] * (1 - fade)

    out = Image.fromarray(result.clip(0, 255).astype(np.uint8))
    if out.size != (out_size, out_size):
        out = out.resize((out_size, out_size), Image.LANCZOS)
    return out


def handler(event: dict, context) -> dict:
    """Нормализует освещение текстуры и делает бесшовный тайл 512x512"""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    params = event.get('queryStringParameters') or {}
    url = params.get('url', '')
    size = int(params.get('size', '512'))
    size = max(256, min(1024, size))

    if not url:
        return {
            'statusCode': 400,
            'headers': {**CORS, 'Content-Type': 'application/json'},
            'body': json.dumps({"error": "url param required"})
        }

    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()

    img = Image.open(io.BytesIO(raw)).convert('RGB')
    arr = np.array(img)

    flat = flatten_lighting(arr)
    seamless = make_seamless(flat, size)

    buf = io.BytesIO()
    seamless.save(buf, format='PNG', optimize=True)
    encoded = base64.b64encode(buf.getvalue()).decode('utf-8')

    return {
        'statusCode': 200,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps({"data": encoded})
    }
