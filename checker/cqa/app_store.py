"""Durable local records. Every evaluation revision and appeal is retained."""
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .io import ValidationError, digest, normalize_conversation


def now():
    return datetime.now(timezone.utc).isoformat()


class ConflictError(ValidationError):
    pass


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS conversations(key TEXT PRIMARY KEY, body TEXT NOT NULL, source TEXT NOT NULL, created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS evaluations(key TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, version INTEGER NOT NULL, updated TEXT NOT NULL, PRIMARY KEY(key,role));
                CREATE TABLE IF NOT EXISTS versions(key TEXT NOT NULL, role TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(key,role,version));
                CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS appeals(id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, body TEXT NOT NULL);
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA journal_mode=WAL')
            with db:
                yield db
        finally:
            db.close()

    def add_conversation(self, raw, source):
        conversation = normalize_conversation(raw)  # strips expected labels and unrecognized fields
        key = digest(conversation)[:24]
        with self.connect() as db:
            inserted = db.execute('INSERT OR IGNORE INTO conversations VALUES(?,?,?,?)',
                                  (key, json.dumps(conversation, ensure_ascii=False), source[:180], now())).rowcount
        return key, bool(inserted)

    def conversation(self, key):
        with self.connect() as db:
            row = db.execute('SELECT * FROM conversations WHERE key=?', (key,)).fetchone()
        if not row:
            raise ValidationError('Диалог не найден')
        return {'key': key, 'conversation': json.loads(row['body']), 'source': row['source'], 'created': row['created']}

    def conversations(self):
        with self.connect() as db:
            rows = db.execute('SELECT * FROM conversations ORDER BY created,key').fetchall()
        return [{'key': x['key'], 'conversation': json.loads(x['body']), 'source': x['source'], 'created': x['created']} for x in rows]

    def snapshot(self, include_versions=False):
        # A single read transaction avoids thousands of connection opens per page load.
        with self.connect() as db:
            db.execute('BEGIN')
            conversations = db.execute('SELECT * FROM conversations ORDER BY created,key').fetchall()
            results = db.execute('SELECT key,role,body FROM evaluations').fetchall()
            documents = {table: db.execute(f'SELECT body FROM {table} ORDER BY rowid DESC').fetchall()
                         for table in ('jobs', 'appeals', 'feedback')}
            versions = db.execute('SELECT * FROM versions ORDER BY version DESC').fetchall() if include_versions else []
        history = {}
        for row in versions:
            body = json.loads(row['body'])
            history.setdefault((row['key'], row['role']), []).append({'version': row['version'], 'created': row['created'],
                'score': body['score']['total'], 'origin': body.get('origin', 'model')})
        return {'conversations': [{'key': row['key'], 'conversation': json.loads(row['body']), 'source': row['source'], 'created': row['created']} for row in conversations],
                'results': {(row['key'], row['role']): json.loads(row['body']) for row in results},
                'versions': history, **{table: [json.loads(row['body']) for row in rows] for table, rows in documents.items()}}

    def result(self, key, role):
        with self.connect() as db:
            row = db.execute('SELECT body FROM evaluations WHERE key=? AND role=?', (key, role)).fetchone()
        return json.loads(row['body']) if row else None

    def put_result(self, key, role, result, expected_version=None):
        result = dict(result)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT version FROM evaluations WHERE key=? AND role=?', (key, role)).fetchone()
            old = row['version'] if row else 0
            if expected_version is not None and old != expected_version:
                raise ConflictError('Оценка уже изменилась. Откройте свежую версию и повторите апелляцию.')
            result.update(version=old + 1, updated_at=now())
            body = json.dumps(result, ensure_ascii=False)
            db.execute('INSERT OR REPLACE INTO evaluations VALUES(?,?,?,?,?)', (key, role, body, old + 1, result['updated_at']))
            db.execute('INSERT INTO versions VALUES(?,?,?,?,?)', (key, role, old + 1, body, result['updated_at']))
        return result

    def versions(self, key, role):
        with self.connect() as db:
            rows = db.execute('SELECT version,body,created FROM versions WHERE key=? AND role=? ORDER BY version DESC', (key, role)).fetchall()
        return [{'version': x['version'], 'created': x['created'], 'score': json.loads(x['body'])['score']['total'],
                 'origin': json.loads(x['body']).get('origin', 'model')} for x in rows]

    def documents(self, table):
        if table not in {'jobs', 'appeals', 'feedback'}:
            raise ValidationError('Неизвестная коллекция')
        with self.connect() as db:
            rows = db.execute(f'SELECT body FROM {table} ORDER BY rowid DESC').fetchall()
        return [json.loads(x['body']) for x in rows]

    def document(self, table, item_id):
        return next((x for x in self.documents(table) if x['id'] == item_id), None)

    def save(self, table, item):
        if table not in {'jobs', 'appeals', 'feedback'}:
            raise ValidationError('Неизвестная коллекция')
        with self.connect() as db:
            db.execute(f'INSERT OR REPLACE INTO {table} VALUES(?,?)', (item['id'], json.dumps(item, ensure_ascii=False)))
        return item

    def create(self, table, **fields):
        return self.save(table, dict(fields, id=uuid.uuid4().hex, created_at=now()))
