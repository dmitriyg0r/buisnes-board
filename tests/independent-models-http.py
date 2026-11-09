"""HTTP-проверка на изолированной временной БД Docker Compose: python3 tests/independent-models-http.py."""
import concurrent.futures
import http.cookiejar
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
import uuid

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
database = 'bb_test_' + uuid.uuid4().hex[:12]
subprocess.run(['docker', 'compose', 'exec', '-T', 'db', 'createdb', '-U', 'bb', database], cwd=root, check=True)
server = None
try:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = {**os.environ, 'DATABASE_URL': f'postgres://bb:bb@127.0.0.1:5432/{database}',
           'BIND_ADDR': f'127.0.0.1:{port}', 'ALLOW_REGISTRATION': 'true', 'COOKIE_SECURE': 'false'}
    server = subprocess.Popen(['cargo', 'run', '--manifest-path', 'backend/Cargo.toml'], cwd=root, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f'http://127.0.0.1:{port}/api'
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def request(method, path, payload=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(base + path, data=data, method=method, headers={'Content-Type': 'application/json'})
        try:
            with opener.open(req, timeout=10) as response:
                body = response.read()
                return response.status, json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            body = error.read()
            return error.code, json.loads(body) if body else None
    for _ in range(300):
        if server.poll() is not None:
            raise RuntimeError('Тестовый сервер завершился до запуска')
        try:
            if request('GET', '/health')[1]['db']:
                break
        except (OSError, urllib.error.URLError):
            time.sleep(.2)
    else:
        raise RuntimeError('Тестовый сервер не запустился')
    assert request('POST', '/auth/register', {'email': 'test@example.org', 'password': 'test-password', 'name': 'Тест'})[0] == 201
    status, project = request('POST', '/projects', {'name': 'Тест'})
    assert status == 201
    path = '/projects/' + project['id'] + '/model'
    status, initial = request('GET', path)
    assert status == 200
    old = initial['data']
    model = {'id': 'm1', 'title': 'UML', 'notation': 'future-notation', 'source': '{"future":true}', 'extra': {'keep': True}}
    data = {**old, 'models': [model], 'cardLinks': [{'id': 'l1', 'from': 'model:m1', 'to': 'doc:d1'}]}
    status, saved = request('PUT', path, {'version': initial['version'], 'data': data})
    assert status == 200 and saved['data'] == data
    assert request('PUT', path, {'version': saved['version'], 'data': old})[0] == 400
    assert request('PUT', path, {'version': initial['version'], 'data': old})[0] == 409
    for invalid in [None, {}, [model, model], [{'id': 'bad'}]]:
        assert request('PUT', path, {'version': saved['version'], 'data': {**data, 'models': invalid}})[0] == 400
    assert request('GET', path)[1]['data'] == data
    # Два клиента с одной версией не должны оба записаться.
    def write(title):
        changed = {**data, 'models': [{**model, 'title': title}]}
        return request('PUT', path, {'version': saved['version'], 'data': changed})[0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(write, ['A', 'B'])) == [200, 409]
    current = request('GET', path)[1]
    assert current['data']['models'][0]['extra'] == {'keep': True}
    deleted = {**current['data'], 'models': [], 'cardLinks': []}
    assert request('PUT', path, {'version': current['version'], 'data': deleted})[0] == 200
    assert request('GET', path)[1]['data'] == deleted
    print('HTTP + PostgreSQL: создание, сохранение, старый клиент, конфликт, валидация и удаление пройдены')
finally:
    if server:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
    subprocess.run(['docker', 'compose', 'exec', '-T', 'db', 'dropdb', '-U', 'bb', '--if-exists', '--force', database], cwd=root, check=True)
