import base64
import io
import json
import math
import numpy as np
from PIL import Image

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}

S3 = math.sqrt(3)


def hex_dist(lx, ly, R):
    ax, ay = abs(lx), abs(ly)
    return min(R - ay, R - (0.5 * ay + S3 * 0.5 * ax))


def nearest_hex_center(px, py, W, H):
    row = round(py / (H * 0.75))
    off = W * 0.5 if (row & 1) else 0.0
    col = round((px - off) / W)
    best_cx, best_cy, best_d = 0.0, 0.0, 1e18
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            r2, c2 = row + dr, col + dc
            o2 = W * 0.5 if (r2 & 1) else 0.0
            cx = c2 * W + o2
            cy = r2 * H * 0.75
            d = (px - cx) ** 2 + (py - cy) ** 2
            if d < best_d:
                best_d = d
                best_cx = cx
                best_cy = cy
    return best_cx, best_cy


def basketweave(x, y, thread_pitch):
    px = x % thread_pitch
    py = y % thread_pitch
    hp = thread_pitch * 0.5
    over_x = px < hp
    over_y = py < hp
    if over_x == over_y:
        return 0.65
    else:
        return 0.45


def noise_hash(x, y):
    h = (x * 374761393 + y * 668265263 + 13) & 0x7FFFFFFF
    h = ((h >> 13) ^ h) * 1274126177 & 0x7FFFFFFF
    return ((h >> 16) ^ (h & 255)) / 255.0


def generate_oxford_600d(size=1024):
    R = 40.0
    W = S3 * R
    H = 2.0 * R

    EDGE_THICK = 5.0
    ANTI = 1.5
    THREAD_PITCH = 8.0

    EDGE_VAL = 185.0
    CELL_MID = 140.0

    cols_needed = int(math.ceil(size / W)) + 2
    rows_needed = int(math.ceil(size / (H * 0.75))) + 2
    if rows_needed % 2 == 1:
        rows_needed += 1

    tile_w = int(round(cols_needed * W))
    tile_h = int(round(rows_needed * H * 0.75))
    gen_w = max(tile_w, size + 64)
    gen_h = max(tile_h, size + 64)

    img = np.zeros((gen_h, gen_w), dtype=np.float64)

    ys = np.arange(gen_h, dtype=np.float64)
    xs = np.arange(gen_w, dtype=np.float64)

    for y_int in range(gen_h):
        fy = float(y_int)
        for x_int in range(gen_w):
            fx = float(x_int)
            cx, cy = nearest_hex_center(fx, fy, W, H)
            lx = fx - cx
            ly = fy - cy
            d = hex_dist(lx, ly, R)

            n = (noise_hash(x_int, y_int) - 0.5) * 4.0

            if d < EDGE_THICK + ANTI:
                v = EDGE_VAL + n * 0.3

                if d > EDGE_THICK:
                    t = (d - EDGE_THICK) / ANTI
                    bw = basketweave(x_int, y_int, THREAD_PITCH)
                    cell_v = CELL_MID * bw / 0.55 + n
                    v = v * (1.0 - t) + cell_v * t
                img[y_int, x_int] = v
            else:
                bw = basketweave(x_int, y_int, THREAD_PITCH)
                v = CELL_MID * bw / 0.55 + n

                depth_fade = min(1.0, (d - EDGE_THICK - ANTI) / 8.0)
                v -= depth_fade * 12.0

                img[y_int, x_int] = v

    img = np.clip(img, 0, 255)

    crop = img[:tile_h, :tile_w]
    pil = Image.fromarray(crop.astype(np.uint8), mode='L')
    if pil.size[0] != size or pil.size[1] != size:
        pil = pil.resize((size, size), Image.LANCZOS)
    return pil


def handler(event: dict, context) -> dict:
    """Генерирует процедурную текстуру Oxford 600D: крупные гексагоны + basketweave + толстые грани"""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    params = event.get('queryStringParameters') or {}
    size = int(params.get('size', '1024'))
    size = max(256, min(1024, size))

    pil = generate_oxford_600d(size)

    rgb = Image.merge('RGB', [pil, pil, pil])
    buf = io.BytesIO()
    rgb.save(buf, format='PNG', optimize=True)
    encoded = base64.b64encode(buf.getvalue()).decode('utf-8')

    return {
        'statusCode': 200,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps({"data": encoded})
    }
