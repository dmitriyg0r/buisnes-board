"""Проверки временного локального backend; подготавливает двух пользователей для браузерного стенда."""
import concurrent.futures
import http.cookiejar
import json
import queue
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = 'http://127.0.0.1:8080/api'
PASSWORD = 'local-collaboration-test-only'

def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def request(opener, method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'Content-Type': 'application/json'})
    try:
        with opener.open(req, timeout=10) as response:
            body = response.read()
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        body = error.read()
        return error.code, json.loads(body) if body else None

clients = [client() for _ in range(3)]
for letter, opener in zip('ABC', clients):
    payload = {'email': f'collab-{letter.lower()}@example.test', 'password': PASSWORD, 'name': {'A': 'Анна', 'B': 'Борис', 'C': 'Посторонний'}[letter]}
    status, _ = request(opener, 'POST', '/auth/register', payload)
    if status != 201:
        status, _ = request(opener, 'POST', '/auth/login', payload)
    assert status in (200, 201), status
owner, colleague, outsider = clients
config = Path(__file__).with_name('model-collaboration-config.json')
project_id = json.loads(config.read_text()).get('projectId') if config.exists() else None
if not project_id or request(owner, 'GET', f'/projects/{project_id}/model')[0] != 200:
    status, project = request(owner, 'POST', '/projects', {'name': 'Локальная проверка совместных моделей'})
    assert status == 201
    project_id = project['id']
path = f'/projects/{project_id}'
status, invite = request(owner, 'POST', path + '/sharing/link')
assert status == 200
assert request(colleague, 'POST', '/invites/join', {'token': invite['token']})[0] == 200
assert request(outsider, 'POST', path + '/presence', {'editing': 'model:epc', 'x': 1, 'y': 2})[0] == 404
assert request(client(), 'POST', path + '/presence', {'editing': 'model:epc', 'x': 1, 'y': 2})[0] == 401
for invalid in [{'editing': 'model:'}, {'editing': 'doc:1'}, {'editing': 'model:epc', 'x': 1}, {'editing': 'model:epc', 'x': 1e8, 'y': 1}]:
    assert request(owner, 'POST', path + '/presence', invalid)[0] == 400
received = queue.Queue()
ready = threading.Event()
stop = threading.Event()
connection = []
def watch():
    try:
        stream = colleague.open(BASE + path + '/events', timeout=10)
        connection.append(stream)
        ready.set()
        while not stop.is_set():
            line = stream.readline()
            if line.startswith(b'data:'):
                received.put(json.loads(line[5:]))
    except Exception as error:
        if not stop.is_set():
            received.put(error)
threading.Thread(target=watch, daemon=True).start()
assert ready.wait(10), 'SSE не открылся'
for payload in [{'editing': 'model:epc', 'x': 120.5, 'y': 210}, {'editing': 'model:epc', 'x': None, 'y': None}, {'editing': None, 'x': None, 'y': None}]:
    assert request(owner, 'POST', path + '/presence', payload)[0] == 204
    event = received.get(timeout=5)
    assert isinstance(event, dict) and event['t'] == 'cursor' and event['editing'] == payload['editing'] and event['mx' if payload['editing'] else 'x'] == payload['x'] and event['n'] == 'Анна', event
# Живые кадры передаются по SSE, не меняя версию/содержимое модели.
_, before_drag = request(owner, 'GET', path + '/model')
for seq, phase in enumerate(['move', 'move', 'end', 'cancel'], 1):
    frame = {'model': 'model:epc', 'gesture': 'test', 'session': 'http', 'seq': seq, 'phase': phase,
             'changes': [] if phase == 'cancel' else [{'id': 'node', 'kind': 'node', 'x': seq * 20, 'y': 100}]}
    assert request(owner, 'POST', path + '/presence', {'model_drag': frame})[0] == 204
    event = received.get(timeout=5)
    assert event['t'] == 'model_drag' and event['model_drag'] == frame, event
assert request(owner, 'GET', path + '/model')[1] == before_drag
assert request(outsider, 'POST', path + '/presence', {'model_drag': frame})[0] == 404
assert request(owner, 'POST', path + '/presence', {'drag': [{'id': 'model:epc', 'x': 100, 'y': 200}]})[0] == 204
assert received.get(timeout=5)['t'] == 'drag'
status, original = request(owner, 'GET', path + '/model')
assert status == 200
barrier = threading.Barrier(2)
def write(index):
    barrier.wait()
    return request(clients[index], 'PUT', path + '/model', {'version': original['version'], 'data': original['data']})[0]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    assert sorted(pool.map(write, [0, 1])) == [200, 409]
stop.set()
Path(__file__).with_name('model-collaboration-config.json').write_text(json.dumps({'projectId': project_id}))
print('HTTP + PostgreSQL + SSE: доступ участников, запрет посторонним, валидация координат, курсор модели, уход курсора, закрытие редактора и конфликт версии — OK')
print('Готовы страницы /tests/model-collaboration-live.html?user=A и ?user=B; открывайте A через 127.0.0.1, B через localhost.')
