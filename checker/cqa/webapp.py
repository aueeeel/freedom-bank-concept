"""Same-origin local web app; the privately hosted static UI can use an allowed origin."""
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import urllib.request

from .app_store import ConflictError
from .io import ValidationError, read_json
from .web_service import WebService
from .local_provider import local_settings
from . import PIPELINE_VERSION


def make_server(service, static_dir, port=8088, allowed_origins=()):
    static_dir = Path(static_dir).resolve()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def allowed(self):
            actual_port = self.server.server_address[1]
            hosts = {f'localhost:{actual_port}', f'127.0.0.1:{actual_port}'}
            origins = {f'http://localhost:{actual_port}', f'http://127.0.0.1:{actual_port}', *allowed_origins}
            return self.headers.get('Host') in hosts and (not self.headers.get('Origin') or self.headers['Origin'] in origins)

        def headers_for(self, status, content_type, length):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(length))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            origin = self.headers.get('Origin')
            if self.allowed() and origin:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            self.end_headers()

        def send_json(self, status, value):
            body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
            self.headers_for(status, 'application/json; charset=utf-8', len(body))
            self.wfile.write(body)

        def do_OPTIONS(self):
            if not self.allowed():
                return self.send_json(403, {'error': 'Origin/Host запрещён'})
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin', ''))
            self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type,X-CQA-Client')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Vary', 'Origin')
            self.end_headers()

        def do_GET(self):
            if not self.allowed():
                return self.send_json(403, {'error': 'Origin/Host запрещён'})
            path = urlsplit(self.path).path
            try:
                if path == '/api/health':
                    model = local_settings()['model']
                    model_ready = False
                    try:
                        with urllib.request.urlopen('http://127.0.0.1:11435/api/tags', timeout=2) as response:
                            tags = json.load(response)
                            model_ready = any(x['name'] == model for x in tags.get('models', []))
                    except (OSError, ValueError):
                        pass
                    return self.send_json(200, {'ok': True, 'local_only': True, 'model_ready': model_ready,
                        'model': model, 'version': PIPELINE_VERSION, 'paid_api_used': False})
                if path == '/api/state':
                    return self.send_json(200, service.state())
                if path == '/api/workspace':
                    return self.send_json(200, service.workspace())
                if path.startswith('/api/conversations/'):
                    return self.send_json(200, service.detail(path.split('/')[-1]))
                if path == '/api/appeals':
                    return self.send_json(200, service.store.documents('appeals'))
                if path == '/api/feedback':
                    return self.send_json(200, service.store.documents('feedback'))
                assets = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/favicon.svg': 'favicon.svg'}
                if path not in assets:
                    return self.send_json(404, {'error': 'Страница не найдена'})
                file = static_dir / assets[path]
                body = file.read_bytes()
                content_type = mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
                self.headers_for(200, content_type + ('; charset=utf-8' if file.suffix != '.svg' else ''), len(body))
                self.wfile.write(body)
            except ValidationError as exc:
                self.send_json(400, {'error': str(exc)})
            except (OSError, ValueError, KeyError):
                self.send_json(500, {'error': 'Не удалось прочитать локальные данные'})

        def do_POST(self):
            if not self.allowed() or self.headers.get('X-CQA-Client') != 'web':
                return self.send_json(403, {'error': 'Origin/Host или заголовок клиента запрещён'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 20_000_000 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    return self.send_json(400, {'error': 'Нужен JSON размером до 20 MB'})
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValidationError('Ожидается объект запроса')
                path = urlsplit(self.path).path
                if path == '/api/uploads':
                    result = service.upload(data.get('payload'), str(data.get('name', 'JSON')))
                elif path == '/api/evaluate':
                    result = service.start_evaluation(data.get('keys'), data.get('roles'), data.get('only_unrated', False))
                elif path == '/api/appeals':
                    result = service.appeal(data.get('key'), data.get('role'), data.get('criterion_id'),
                                            data.get('argument'), data.get('selected_message_ids', []), data.get('expected_version'))
                elif path.startswith('/api/feedback/') and path.endswith('/revoke'):
                    result = service.revoke_feedback(path.split('/')[-2])
                elif path.startswith('/api/appeals/') and path.endswith('/approve'):
                    result = service.approve_feedback(path.split('/')[-2])
                elif path.startswith('/api/jobs/') and path.endswith('/cancel'):
                    job_id = path.split('/')[-2]
                    if not service.store.document('jobs', job_id):
                        raise ValidationError('Задача не найдена')
                    result = service._update_job(job_id, cancel_requested=True, message='Остановится после текущей оценки')
                else:
                    return self.send_json(404, {'error': 'Действие не найдено'})
                self.send_json(200, result)
            except ConflictError as exc:
                self.send_json(409, {'error': str(exc)})
            except ValidationError as exc:
                self.send_json(400, {'error': str(exc)})
            except (ValueError, KeyError, TypeError):
                self.send_json(400, {'error': 'Проверьте формат запроса'})
            except OSError:
                self.send_json(500, {'error': 'Не удалось сохранить локальные данные'})

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def serve_web(root, port=8088, static_dir=None):
    root = Path(root)
    origins_path = root / 'config/web-origins.json'
    origins = read_json(origins_path).get('allowed_origins', []) if origins_path.exists() else []
    static_dir = static_dir or root.parent / 'review-ui'
    service = WebService(root)
    server = make_server(service, static_dir, port, origins)
    print(f'CQA website: http://127.0.0.1:{server.server_address[1]}', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        service.executor.shutdown(wait=False, cancel_futures=True)
