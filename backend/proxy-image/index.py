import urllib.request
import base64
import io
from PIL import Image

def handler(event: dict, context) -> dict:
    """Проксирует изображение, масштабирует до 512x512, возвращает base64 PNG"""
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            'body': ''
        }

    params = event.get('queryStringParameters') or {}
    url = params.get('url', '')

    if not url:
        return {
            'statusCode': 400,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': '{"error": "url param required"}'
        }

    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read()

    img = Image.open(io.BytesIO(raw)).convert('RGB')
    img = img.resize((512, 512), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    encoded = base64.b64encode(buf.getvalue()).decode('utf-8')

    return {
        'statusCode': 200,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
        },
        'body': f'{{"data": "{encoded}"}}'
    }
