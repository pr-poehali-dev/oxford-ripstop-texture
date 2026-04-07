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

    for radius in [160, 80, 40, 20]:
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
    return result


def remove_specular(result):
    """Убирает specular блики — яркие пятна выше локального среднего"""
    gray = 0.2126 * result[:,:,0] + 0.7152 * result[:,:,1] + 0.0722 * result[:,:,2]
    pil_gray = Image.fromarray(gray.clip(0, 255).astype(np.uint8))

    for r in [4, 8, 16]:
        local_avg = np.array(pil_gray.filter(ImageFilter.GaussianBlur(radius=r)), dtype=np.float64)
        ratio = gray / np.maximum(local_avg, 1.0)
        dampen = np.where(ratio > 1.05, 1.05 / ratio, 1.0)
        result = result * dampen[:, :, np.newaxis]
        gray = 0.2126 * result[:,:,0] + 0.7152 * result[:,:,1] + 0.0722 * result[:,:,2]
        pil_gray = Image.fromarray(gray.clip(0, 255).astype(np.uint8))

    return result.clip(0, 255)


def equalize_edges(result):
    """Выравнивает яркость граней ячеек — все грани приводятся к одному значению"""
    gray = 0.2126 * result[:,:,0] + 0.7152 * result[:,:,1] + 0.0722 * result[:,:,2]
    h, w = gray.shape

    pil_g = Image.fromarray(gray.clip(0, 255).astype(np.uint8))
    smooth = np.array(pil_g.filter(ImageFilter.GaussianBlur(radius=2)), dtype=np.float64)

    sx = np.zeros_like(gray)
    sy = np.zeros_like(gray)
    sx[:, 1:-1] = np.abs(smooth[:, 2:] - smooth[:, :-2]) / 2.0
    sy[1:-1, :] = np.abs(smooth[2:, :] - smooth[:-2, :]) / 2.0
    edge_strength = np.sqrt(sx**2 + sy**2)

    edge_thresh = np.percentile(edge_strength, 75)
    edge_mask = edge_strength > edge_thresh

    if edge_mask.sum() < 100:
        return result

    edge_luma = gray[edge_mask]
    target_luma = np.median(edge_luma)

    pil_g2 = Image.fromarray(gray.clip(0, 255).astype(np.uint8))
    local_edge_avg = np.array(pil_g2.filter(ImageFilter.GaussianBlur(radius=12)), dtype=np.float64)

    correction = np.ones_like(gray)
    edge_local = local_edge_avg.copy()
    edge_local[edge_local < 1] = 1
    correction[edge_mask] = target_luma / edge_local[edge_mask]

    correction_smooth_arr = np.array(
        Image.fromarray((correction * 128).clip(0, 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(radius=6)
        ), dtype=np.float64
    ) / 128.0

    blend = np.minimum(edge_strength / max(edge_thresh, 1.0), 1.0)
    final_corr = 1.0 + (correction_smooth_arr - 1.0) * blend

    result = result * final_corr[:, :, np.newaxis]
    return result.clip(0, 255)


def normalize_contrast(result):
    """Финальная нормализация контраста"""
    gray = 0.2126 * result[:,:,0] + 0.7152 * result[:,:,1] + 0.0722 * result[:,:,2]
    mn, mx = np.percentile(gray, 2), np.percentile(gray, 98)
    rng = max(mx - mn, 1.0)
    norm = (gray - mn) / rng
    norm = norm.clip(0, 1)
    target_l = norm * 190 + 32
    scale = target_l / np.maximum(gray, 1.0)
    result = result * scale[:, :, np.newaxis]
    return result.clip(0, 255).astype(np.uint8)


def straighten_hex_grid(img_arr, out_size=512):
    """Детектит гексагональную сетку и морфит к идеальной геометрии"""
    h, w, c = img_arr.shape
    gray = np.mean(img_arr.astype(np.float64), axis=2)

    pil_g = Image.fromarray(gray.clip(0, 255).astype(np.uint8))
    smooth = np.array(pil_g.filter(ImageFilter.GaussianBlur(radius=1)), dtype=np.float64)

    sx = np.zeros_like(smooth)
    sy = np.zeros_like(smooth)
    sx[:, 1:-1] = np.abs(smooth[:, 2:] - smooth[:, :-2])
    sy[1:-1, :] = np.abs(smooth[2:, :] - smooth[:-2, :])
    edges = np.sqrt(sx**2 + sy**2)

    proj_x = edges.mean(axis=0)
    proj_y = edges.mean(axis=1)

    from numpy.fft import rfft

    fft_x = np.abs(rfft(proj_x - proj_x.mean()))
    fft_y = np.abs(rfft(proj_y - proj_y.mean()))

    min_freq = max(3, w // 100)
    max_freq_x = w // 8
    max_freq_y = h // 8

    peak_x = min_freq + np.argmax(fft_x[min_freq:max_freq_x])
    peak_y = min_freq + np.argmax(fft_y[min_freq:max_freq_y])

    period_x = w / peak_x if peak_x > 0 else 30
    period_y = h / peak_y if peak_y > 0 else 30

    n_cells_x = round(w / period_x)
    n_cells_y = round(h / period_y)

    if n_cells_x < 2 or n_cells_y < 2:
        pil_out = Image.fromarray(img_arr)
        if pil_out.size != (out_size, out_size):
            pil_out = pil_out.resize((out_size, out_size), Image.LANCZOS)
        return np.array(pil_out)

    ideal_px = period_x
    ideal_py = period_y

    result = np.zeros((out_size, out_size, c), dtype=np.uint8)
    src_h, src_w = img_arr.shape[:2]

    cx, cy = src_w / 2.0, src_h / 2.0
    ox, oy = out_size / 2.0, out_size / 2.0

    scale_x = ideal_px * n_cells_x / src_w
    scale_y = ideal_py * n_cells_y / src_h

    for out_y in range(out_size):
        for out_x in range(out_size):
            src_x = (out_x - ox) / scale_x + cx
            src_y = (out_y - oy) / scale_y + cy

            ix = int(src_x)
            iy = int(src_y)
            fx = src_x - ix
            fy = src_y - iy

            if 0 <= ix < src_w - 1 and 0 <= iy < src_h - 1:
                v = (img_arr[iy, ix] * (1-fx) * (1-fy) +
                     img_arr[iy, ix+1] * fx * (1-fy) +
                     img_arr[iy+1, ix] * (1-fx) * fy +
                     img_arr[iy+1, ix+1] * fx * fy)
                result[out_y, out_x] = v.clip(0, 255).astype(np.uint8)
            elif 0 <= ix < src_w and 0 <= iy < src_h:
                result[out_y, out_x] = img_arr[min(iy, src_h-1), min(ix, src_w-1)]

    return result


def make_seamless(img_arr, out_size=512):
    """Делает crossfade по краям для бесшовного тайлинга"""
    h, w, c = img_arr.shape

    if h != out_size or w != out_size:
        pil = Image.fromarray(img_arr)
        pil = pil.resize((out_size, out_size), Image.LANCZOS)
        img_arr = np.array(pil)
        h, w = out_size, out_size

    blend_w = w // 5
    result = img_arr.astype(np.float64)

    for i in range(blend_w):
        t = i / blend_w
        fade = 0.5 - 0.5 * np.cos(t * np.pi)
        left = result[:, i, :].copy()
        right = result[:, w - blend_w + i, :].copy()
        blended = left * fade + right * (1 - fade)
        result[:, i, :] = blended
        result[:, w - blend_w + i, :] = right * fade + left * (1 - fade)

    for i in range(blend_w):
        t = i / blend_w
        fade = 0.5 - 0.5 * np.cos(t * np.pi)
        top = result[i, :, :].copy()
        bottom = result[h - blend_w + i, :, :].copy()
        blended = top * fade + bottom * (1 - fade)
        result[i, :, :] = blended
        result[h - blend_w + i, :, :] = bottom * fade + top * (1 - fade)

    return Image.fromarray(result.clip(0, 255).astype(np.uint8))


def handler(event: dict, context) -> dict:
    """Нормализует текстуру: выравнивает освещение, грани, геометрию и делает бесшовный тайл"""
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

    result = flatten_lighting(arr)
    result = remove_specular(result)
    result = equalize_edges(result)
    result = normalize_contrast(result)

    straightened = straighten_hex_grid(result, size)
    seamless = make_seamless(straightened, size)

    buf = io.BytesIO()
    seamless.save(buf, format='PNG', optimize=True)
    encoded = base64.b64encode(buf.getvalue()).decode('utf-8')

    return {
        'statusCode': 200,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps({"data": encoded})
    }
