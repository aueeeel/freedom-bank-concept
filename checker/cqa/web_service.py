import copy
import json
import re
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .appeals import reconsider
from .app_store import Store, ConflictError, now
from .calibration import transcript_signature
from .engine import Evaluator, review_reasons
from .evidence import enrich_assessment
from .io import ValidationError, digest, read_json, records_from_payload, write_json
from .local_provider import OllamaProvider, local_settings
from .policies import apply_role_policies
from .provider import ProviderError
from .rubric import calculate_score


class ProgressProvider:
    def __init__(self, inner, callback):
        self.inner, self.callback, self.done = inner, callback, set()

    @property
    def identity(self):
        return self.inner.identity

    @property
    def usage(self):
        return self.inner.usage

    @property
    def semantic_audit(self):
        return getattr(self.inner, 'semantic_audit', [])

    def structured(self, stage, instructions, payload, schema):
        ids = ','.join(c['id'] for c in payload.get('checklist', {}).get('criteria', []))
        self.callback(stage, ids, len(self.done), False)
        result = self.inner.structured(stage, instructions, payload, schema)
        self.done.add((stage, ids))
        self.callback(stage, ids, len(self.done), True)
        return result


class WebService:
    def __init__(self, root, database=None, provider_factory=None, seed=True):
        self.root = Path(root)
        self.rubric = read_json(self.root / 'config/checklist.json')
        self.knowledge = read_json(self.root / 'config/knowledge.example.json')
        self.store = Store(database or self.root / 'data/app/cqa.sqlite3')
        self.provider_factory = provider_factory or OllamaProvider
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='cqa-local-job')
        self.lock = threading.RLock()
        self.feedback_path = self.root / 'config/feedback_examples.json'
        for job in self.store.documents('jobs'):
            if job['status'] in {'running', 'queued'}:
                job.update(status='interrupted', message='Работа прервана перезапуском сервера. Сохранённые оценки доступны.')
                self.store.save('jobs', job)
        for appeal in self.store.documents('appeals'):
            if appeal['status'] in {'running', 'queued'}:
                appeal.update(status='failed', error='Проверка прервана перезапуском. Можно подать заново.')
                self.store.save('appeals', appeal)
        if seed:
            self.seed_reference()

    def seed_reference(self):
        path = self.root / 'data/calibration/reference_labels.json'
        if not path.exists():
            return
        for label in read_json(path)['records']:
            if not label['source'].endswith('.xlsx'):
                continue
            key, _ = self.store.add_conversation(label['conversation'], 'DEV • пример пользователя')
            role = label['target_role']
            if self.store.result(key, role):
                continue
            conv = self.store.conversation(key)['conversation']
            rows = []
            for rating in label['criteria']:
                cid = rating['criterion_id']
                definition = next(c for c in self.rubric['criteria'] if c['id'] == cid)
                raw_evidence = label.get('source_evidence', {}).get(cid, '') or ''
                evidence = []
                for m in conv['transcript']:
                    marker = f"{m['timestamp']} {m['speaker']}: {m['text']}"
                    if marker in raw_evidence:
                        evidence.append({'message_id': m['message_id'], 'quote': m['text']})
                row = {k: rating[k] for k in ('criterion_id', 'answer', 'value', 'na_code', 'na_reason')}
                row.update(explanation=rating.get('reason', ''), evidence=evidence,
                           basis='not_applicable' if row['answer'] == 'na' else 'observed' if evidence else 'omission',
                           checked_range={'start_message_id': conv['transcript'][0]['message_id'], 'end_message_id': conv['transcript'][-1]['message_id']},
                           factual_support='unverified' if cid == '04' else 'not_needed', knowledge_evidence=[],
                           uncertainties=['Приблизительная разметка пользователя; не новый вывод модели.'],
                           reference_evidence=raw_evidence)
                rows.append(row)
            assessment = {'criteria': rows, 'summary': label.get('assessment', 'Пример пользователя')}
            assessment, _ = apply_role_policies(assessment, self.rubric, conv, role)
            result = {'conversation_id': conv['conversation_id'], 'target_role': role, 'conversation': conv,
                      'rubric': self.rubric, 'knowledge': self.knowledge, 'primary_assessment': copy.deepcopy(assessment),
                      'final_assessment': assessment, 'display_assessment': enrich_assessment(assessment, conv),
                      'score': calculate_score(assessment, self.rubric), 'independent_review': None,
                      'final_score': None, 'status': 'reference', 'origin': 'reference',
                      'provider': {'model': 'Примерная разметка пользователя'}, 'source': label['source'],
                      'source_warnings': label['warnings'], 'review_reasons': [], 'disagreements': [],
                      'amendments': [], 'usage': []}
            self.store.put_result(key, role, result, expected_version=0)

    def upload(self, payload, name):
        records = records_from_payload(payload)
        if not records or len(records) > 500:
            raise ValidationError('Загрузите от 1 до 500 диалогов в одном файле')
        keys, inserted = [], 0
        for record in records:
            key, is_new = self.store.add_conversation(record, name or 'Загруженный JSON')
            keys.append(key)
            inserted += is_new
        return {'keys': keys, 'count': len(keys), 'new': inserted, 'existing': len(keys) - inserted}

    def detail(self, key):
        item = self.store.conversation(key)
        item['results'] = {role: self.store.result(key, role) for role in ('bot', 'operator')}
        item['versions'] = {role: self.store.versions(key, role) for role in ('bot', 'operator')}
        item['appeals'] = [x for x in self.store.documents('appeals') if x['key'] == key]
        return item

    def workspace(self):
        snapshot = self.store.snapshot(include_versions=True)
        items = [{**record,
                  'results': {role: snapshot['results'].get((record['key'], role)) for role in ('bot', 'operator')},
                  'versions': {role: snapshot['versions'].get((record['key'], role), []) for role in ('bot', 'operator')},
                  'appeals': [a for a in snapshot['appeals'] if a['key'] == record['key']]}
                 for record in snapshot['conversations']]
        return {'state': self.state(snapshot), 'items': items}

    def state(self, snapshot=None):
        snapshot = self.store.snapshot() if snapshot is None else snapshot
        items = []
        model_count = 0
        reference_count = 0
        for record in snapshot['conversations']:
            conv = record['conversation']
            row = {k: record[k] for k in ('key', 'source', 'created')}
            row.update(conversation_id=conv['conversation_id'], language=conv['language'], channel=conv['channel'],
                       message_count=len(conv['transcript']), roles=sorted({m['speaker'] for m in conv['transcript']} & {'bot', 'operator'}))
            row['results'] = {}
            for role in ('bot', 'operator'):
                result = snapshot['results'].get((record['key'], role))
                if result:
                    model_count += result.get('base_origin', result.get('origin')) == 'model'
                    reference_count += result.get('base_origin', result.get('origin')) == 'reference'
                    row['results'][role] = {'score': result['score']['total'], 'status': result['status'],
                        'origin': result.get('origin', 'model'), 'version': result['version'],
                        'gross': any(x['detected'] for x in result['score']['flags']),
                        'warnings': result.get('source_warnings', [])}
            items.append(row)
        appeals = snapshot['appeals']
        feedback = snapshot['feedback']
        return {'conversations': items, 'jobs': snapshot['jobs'][:8],
                'appeal_versions': [[x['id'], x['status'], x.get('outcome'), x.get('completed_at')] for x in appeals],
                'stats': {'conversations': len(items), 'model_evaluations': model_count,
                          'reference_evaluations': reference_count, 'appeals': len(appeals),
                          'approved_examples': sum(x.get('approved', False) for x in feedback)},
                'rubric': self.rubric, 'local_only': True,
                'model': local_settings()['model'] + ' • локально', 'provider': 'ollama'}

    def start_evaluation(self, keys, roles, only_unrated=False):
        if not isinstance(only_unrated, bool):
            raise ValidationError('only_unrated должен быть логическим значением')
        if not isinstance(keys, list) or not keys or len(keys) > 500 or len(set(keys)) != len(keys):
            raise ValidationError('Выберите от 1 до 500 различных диалогов')
        if not isinstance(roles, list) or not roles or not set(roles) <= {'bot', 'operator'}:
            raise ValidationError('Выберите бота и/или оператора')
        tasks, skipped = [], []
        for key in keys:
            conv = self.store.conversation(key)['conversation']
            for role in dict.fromkeys(roles):
                if conv['channel'] != 'agent chat' and role == 'bot':
                    skipped.append({'key': key, 'role': role, 'reason': 'Телефонное IVR оценивается отдельно от чат-бота.'})
                elif only_unrated and self.store.result(key, role):
                    skipped.append({'key': key, 'role': role, 'reason': 'Оценка уже сохранена; повтор не запрошен'})
                elif any(m['speaker'] == role for m in conv['transcript']):
                    tasks.append((key, role))
                else:
                    skipped.append({'key': key, 'role': role, 'reason': 'Нет реплик участника'})
        if not tasks:
            raise ValidationError('В выбранных диалогах нет подходящих участников')
        with self.lock:
            if any(x['status'] in {'running', 'queued'} for x in self.store.documents('jobs')):
                raise ConflictError('Уже идёт проверка. Дождитесь завершения или остановите её после текущей оценки.')
            job = self.store.create('jobs', kind='evaluation', status='queued', total=len(tasks), completed=0,
                                    failed=0, message='Ожидает локальную модель', cancel_requested=False,
                                    tasks=tasks, skipped=skipped, errors=[])
            self.executor.submit(self._evaluate, job['id'])
        return job

    def _update_job(self, job_id, **fields):
        with self.lock:
            job = self.store.document('jobs', job_id)
            job.update(fields)
            return self.store.save('jobs', job)

    def _evaluate(self, job_id):
        job = self._update_job(job_id, status='running')
        for key, role in job['tasks']:
            if self.store.document('jobs', job_id).get('cancel_requested'):
                self._update_job(job_id, status='cancelled', message='Остановлено после текущей оценки. Готовые результаты сохранены.')
                return
            conv = self.store.conversation(key)['conversation']
            try:
                def progress(stage, ids, done, finished):
                    stage_name = 'Повторная проверка' if stage == 'review' else 'Проверка'
                    self._update_job(job_id, message=f"{conv['conversation_id']} · {'бот' if role == 'bot' else 'оператор'} · {stage_name} C{ids}",
                                     criterion_steps_done=done, criterion_steps_total=16, current_key=key, current_role=role)
                provider = ProgressProvider(self.provider_factory(), progress)
                evaluator = Evaluator(provider, self.rubric, self.knowledge, self.root / 'cache/web')
                result = evaluator.evaluate(conv, role)
                result['origin'] = 'model'
                self.store.put_result(key, role, result)
                job['completed'] += 1
            except (ValidationError, ProviderError, OSError, ValueError) as exc:
                job['failed'] += 1
                error = str(exc) if isinstance(exc, (ValidationError, ProviderError)) else 'Ошибка локальной обработки'
                job['errors'].append({'key': key, 'role': role, 'error': error})
            self._update_job(job_id, completed=job['completed'], failed=job['failed'], errors=job['errors'])
        self._update_job(job_id, status='completed' if not job['failed'] else 'completed_with_errors',
                         message=f"Готово: {job['completed']}; ошибок: {job['failed']}")

    def appeal(self, key, role, criterion_id, argument, selected_ids, expected_version):
        if role not in {'bot', 'operator'} or criterion_id not in {c['id'] for c in self.rubric['criteria']}:
            raise ValidationError('Неизвестная роль или критерий')
        if not isinstance(argument, str) or not 5 <= len(argument.strip()) <= 4000:
            raise ValidationError('Опишите аргумент: от 5 до 4000 символов')
        conv = self.store.conversation(key)['conversation']
        if not isinstance(selected_ids, list) or len(selected_ids) > 20 or not set(selected_ids) <= {m['message_id'] for m in conv['transcript']}:
            raise ValidationError('Выбранные реплики не найдены')
        previous = self.store.result(key, role)
        if not previous:
            raise ValidationError('Сначала нужна оценка этого участника')
        if isinstance(expected_version, bool) or previous['version'] != expected_version:
            raise ConflictError('Оценка изменилась. Обновите диалог перед апелляцией.')
        with self.lock:
            if any(x['status'] in {'queued', 'running'} for x in self.store.documents('appeals')):
                raise ConflictError('Уже рассматривается апелляция. Дождитесь результата.')
            item = self.store.create('appeals', key=key, conversation_id=conv['conversation_id'], role=role,
                                     criterion_id=criterion_id, argument=argument.strip(), selected_message_ids=selected_ids,
                                     expected_version=expected_version, status='queued', outcome=None,
                                     message='Ожидает повторной проверки', feedback_approved=False)
            self.executor.submit(self._appeal, item['id'])
        return item

    def _appeal(self, appeal_id):
        item = self.store.document('appeals', appeal_id)
        item['status'] = 'running'
        self.store.save('appeals', item)
        try:
            previous = self.store.result(item['key'], item['role'])
            if previous['version'] != item['expected_version']:
                raise ConflictError('Оценка изменилась до начала рассмотрения. Подайте апелляцию по новой версии.')
            conv = self.store.conversation(item['key'])['conversation']
            def progress(message):
                item['message'] = message
                self.store.save('appeals', item)
            check = reconsider(self.provider_factory(), self.rubric, self.knowledge, conv, item['role'], previous,
                               item['criterion_id'], item['argument'], item['selected_message_ids'], progress)
            before = next(x for x in previous['final_assessment']['criteria'] if x['criterion_id'] == item['criterion_id'])
            item.update(check, before=before, before_score=previous['score']['total'])
            if check['disagreements']:
                item.update(status='completed', outcome='needs_review', message='Два прохода дали разные решения. Балл сохранён; требуется проверка.')
            else:
                decision = check['decision']
                changed = any(before.get(k) != decision.get(k) for k in ('answer', 'value', 'na_code'))
                updated = copy.deepcopy(previous)
                updated['final_assessment']['criteria'] = [copy.deepcopy(decision) if x['criterion_id'] == item['criterion_id'] else x for x in updated['final_assessment']['criteria']]
                updated['display_assessment'] = enrich_assessment(updated['final_assessment'], conv)
                updated['score'] = calculate_score(updated['final_assessment'], self.rubric)
                updated['final_score'] = None
                updated['status'] = 'needs_review'
                updated['origin'] = 'appeal'
                updated['base_origin'] = previous.get('base_origin', previous.get('origin', 'model'))
                updated['latest_appeal_criterion'] = item['criterion_id']
                updated.setdefault('amendments', []).append({'actor_type': 'ai_appeal', 'appeal_id': appeal_id,
                    'criterion_id': item['criterion_id'], 'before': before, 'after': decision,
                    'reason': item['argument'], 'timestamp': now()})
                updated = self.store.put_result(item['key'], item['role'], updated, expected_version=item['expected_version'])
                item.update(status='completed', outcome='changed' if changed else 'upheld',
                            after_score=updated['score']['total'], result_version=updated['version'],
                            message='Предварительная оценка изменена по фактам.' if changed else 'Решение подтверждено после повторной проверки.')
            item['completed_at'] = now()
        except (ValidationError, ProviderError, OSError, ValueError) as exc:
            item.update(status='failed', error=str(exc) if isinstance(exc, (ValidationError, ProviderError)) else 'Ошибка локальной проверки',
                        message='Проверка не завершена. Предыдущая оценка сохранена.')
        self.store.save('appeals', item)

    def approve_feedback(self, appeal_id):
        with self.lock:
            item = self.store.document('appeals', appeal_id)
            if not item or item['status'] != 'completed' or item['outcome'] not in {'changed', 'upheld'}:
                raise ValidationError('Нужна завершённая апелляция с согласованным решением')
            if item.get('feedback_approved'):
                raise ConflictError('Этот пример уже подтверждён')
            current = self.store.result(item['key'], item['role'])
            if current['version'] != item['result_version']:
                raise ConflictError('Оценка изменилась после апелляции. Подтвердите актуальное решение новой апелляцией.')
            conv = self.store.conversation(item['key'])['conversation']
            rows = [{k: row.get(k) for k in ('criterion_id', 'answer', 'value', 'na_code', 'na_reason')}
                    | {'reason': row['explanation']} for row in current['final_assessment']['criteria']]
            sample = {'conversation_id': conv['conversation_id'], 'target_role': item['role'], 'language': conv['language'],
                      'source': 'confirmed_appeal', 'criteria': rows, 'score': current['score']['total'], 'warnings': [],
                      'approved_criterion_ids': [item['criterion_id']], 'approved': True,
                      'transcript_signature': transcript_signature(conv), 'transcript': conv['transcript'],
                      'rubric_hash': digest(self.rubric), 'appeal_id': appeal_id}
            feedback = self.store.create('feedback', **sample)
            item['feedback_approved'] = True
            self.store.save('appeals', item)
            self._write_feedback()
            return feedback

    def revoke_feedback(self, feedback_id):
        with self.lock:
            item = self.store.document('feedback', feedback_id)
            if not item:
                raise ValidationError('Пример не найден')
            item['approved'] = False
            self.store.save('feedback', item)
            self._write_feedback()
            return {'revoked': True}

    def _write_feedback(self):
        examples = [x for x in self.store.documents('feedback') if x.get('approved') and x['rubric_hash'] == digest(self.rubric)]
        write_json(self.feedback_path, {'version': 'confirmed-appeals-v1', 'rubric_hash': digest(self.rubric), 'examples': examples})
