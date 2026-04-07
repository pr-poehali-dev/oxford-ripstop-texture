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


def hex_dist(px, py, R):
    ax, ay = abs(px), abs(py)
    s3h = math.sqrt(3) * 0.5
    return min(R - ay, R - (0.5 * ay + s3h * ax))


def nearest_hex(px, py, W, H):
    row = round(py / (H * 0.75))
    off = W * 0.5 if (row & 1) else 0.0
    col = round((px - off) / W)
    bx, by, bd = 0.0, 0.0, 1e18
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            r2, c2 = row + dr, col + dc
            o2 = W * 0.5 if (r2 & 1) else 0.0
            cx, cy = c2 * W + o2, r2 * H * 0.75
            d = (px - cx) ** 2 + (py - cy) ** 2
            if d < bd:
                bd, bx, by = d, cx, cy
    return bx, by


def phash(x, y):
    h = (x * 374761393 + y * 668265263 + 13) & 0x7FFFFFFF
    h = ((h >> 13) ^ h) * 1274126177 & 0x7FFFFFFF
    return ((h >> 16) ^ h & 255) / 255.0


def generate_honeycomb(size=512):
    S3 = math.sqrt(3)
    R = 21.0
    W = S3 * R
    H = 2.0 * R
    EDGE_T = 3.0
    ANTI = 1.2

    EDGE_BASE = 160
    EDGE_RIP = 12
    CELL_HI = 120
    CELL_LO = 85
    VERTEX_DIM = 0.55

    img = np.zeros((size, size, 3), dtype=np.uint8)

    for y in range(size):
        fy = float(y)
        for x in range(size):
            fx = float(x)
            cx, cy = nearest_hex(fx, fy, W, H)
            lx, ly = fx - cx, fy - cy
            d = hex_dist(lx, ly, R)
            n = (phash(x, y) - 0.5) * 6.0

            if d < EDGE_T + ANTI:
                rip = math.sin((fx * 0.45 + fy * 0.25) * 0.9) * 0.5 + 0.5
                el = EDGE_BASE + rip * EDGE_RIP + n * 0.4

                alx, aly = abs(lx), abs(ly)
                corner = 1.0
                if aly > R * 0.82:
                    corner = max(0.45, 1.0 - (aly - R * 0.82) / (R * 0.18) * 0.55)
                side_d = R - (0.5 * aly + S3 * 0.5 * alx)
                if side_d < R * 0.18:
                    cf = max(0.45, side_d / (R * 0.18))
                    corner = min(corner, cf)
                el *= corner

                if d < EDGE_T:
                    v = int(max(0, min(255, el)))
                else:
                    blend = (d - EDGE_T) / ANTI
                    depth = min(1.0, 0.0)
                    cell_v = CELL_LO + (CELL_HI - CELL_LO) * depth
                    v = int(max(0, min(255, el * (1.0 - blend) + cell_v * blend)))
                img[y, x] = [v, v, v]
            else:
                depth = min(1.0, (d - EDGE_T - ANTI) / 10.0)
                base = CELL_LO + (CELL_HI - CELL_LO) * depth

                wx = math.sin(fx * 1.7) * 0.25
                wy = math.sin(fy * 2.1) * 0.25
                wc = math.sin((fx + fy) * 0.8) * 0.12
                base += (wx + wy + wc) * 10

                if x % 3 == 0 or y % 3 == 0:
                    base -= 4.0

                base += n
                v = int(max(0, min(255, base)))
                img[y, x] = [v, v, v]

    return img


def make_tileable(img_arr, size):
    S3 = math.sqrt(3)
    R = 21.0
    W = S3 * R
    H = 2.0 * R

    cols = int(size / W)
    rows = int(size / (H * 0.75))
    if cols < 2:
        cols = 2
    if rows < 2:
        rows = 2
    if rows % 2 == 1:
        rows += 1

    tile_w = int(round(cols * W))
    tile_h = int(round(rows * H * 0.75))

    crop = img_arr[:min(tile_h, img_arr.shape[0]), :min(tile_w, img_arr.shape[1])]
    out = Image.fromarray(crop)
    if out.size != (size, size):
        out = out.resize((size, size), Image.LANCZOS)
    return out


def handler(event: dict, context) -> dict:
    """Генерирует процедурную текстуру Oxford 600D с идеальной геометрией гексагонов"""
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    params = event.get('queryStringParameters') or {}
    size = int(params.get('size', '512'))
    size = max(256, min(1024, size))

    raw = generate_honeycomb(size + 64)
    seamless = make_tileable(raw, size)

    buf = io.BytesIO()
    seamless.save(buf, format='PNG', optimize=True)
    encoded = base64.b64encode(buf.getvalue()).decode('utf-8')

    return {
        'statusCode': 200,
        'headers': {**CORS, 'Content-Type': 'application/json'},
        'body': json.dumps({"data": encoded})
    }
