import copy
from pathlib import Path
import tempfile
import unittest

from cqa.calibration import load_profile, select_examples, transcript_signature
from cqa.engine import Evaluator
from cqa.io import digest, normalize_conversation, read_json, write_json
from cqa.policies import apply_role_policies
from cqa.rubric import calculate_score
from test_checker import ScriptedProvider, assessment

ROOT = Path(__file__).resolve().parents[1]


def handoff(lang='RU'):
    texts = {'RU': ('Пожалуйста, ожидайте. Оператор скоро подключится к чату.', 'Эскалация на оператора.'),
             'KZ': ('Күте тұрыңыз, оператор жақында чатқа қосылады.', 'Чат операторға жіберілді.'),
             'EN': ('Please wait. An agent will join the chat shortly.', 'Chat transferred to an agent.')}
    closing, event = texts[lang]
    return normalize_conversation({'conversation_id': 'policy-test', 'language': lang, 'channel': 'agent chat',
        'transcript': [{'speaker': s, 'text': t, 'timestamp': f'00:0{i}'} for i, (s, t) in enumerate([
            ('client', 'Operator, please'), ('bot', closing), ('system', event),
            ('operator', 'Hello, I am Alex. How can I help?')])]})


class ReferenceRulesTests(unittest.TestCase):
    def setUp(self):
        self.rubric = read_json(ROOT / 'config/checklist.json')

    def original(self, conv, role='bot'):
        a = assessment(self.rubric, conv, role)
        a['criteria'][6].update(answer='no', basis='omission', evidence=[], checked_range={
            'start_message_id': conv['transcript'][0]['message_id'],
            'end_message_id': conv['transcript'][-1]['message_id']})
        return a

    def test_confirmed_handoff_earns_closing_in_three_languages(self):
        for lang in ('RU', 'KZ', 'EN'):
            with self.subTest(lang=lang):
                conv = handoff(lang)
                a = self.original(conv)
                updated, changes = apply_role_policies(a, self.rubric, conv, 'bot')
                self.assertEqual(updated['criteria'][6]['answer'], 'yes')
                self.assertEqual(len(changes), 1)
                self.assertEqual(a['criteria'][6]['answer'], 'no')
                self.assertEqual(calculate_score(updated, self.rubric)['total'] - calculate_score(a, self.rubric)['total'], 5)

    def test_promise_or_system_event_alone_cannot_complete_handoff(self):
        for missing_role in ('system', 'operator'):
            conv = handoff()
            conv['transcript'] = [m for m in conv['transcript'] if m['speaker'] != missing_role]
            result, changes = apply_role_policies(self.original(conv), self.rubric, conv, 'bot')
            self.assertEqual(result['criteria'][6]['answer'], 'no')
            self.assertFalse(changes)

    def test_system_event_after_operator_is_not_handoff_confirmation(self):
        conv = handoff()
        conv['transcript'][2], conv['transcript'][3] = conv['transcript'][3], conv['transcript'][2]
        _, changes = apply_role_policies(self.original(conv), self.rubric, conv, 'bot')
        self.assertFalse(changes)

    def test_neutral_bot_followup_does_not_erase_completed_handoff(self):
        conv=handoff()
        extra={'speaker':'bot','text':'Хорошо, я на связи.','timestamp':'00:01'}
        raw=[{k:m[k] for k in ('speaker','text','timestamp')} for m in conv['transcript']]
        raw.insert(2,extra)
        conv=normalize_conversation({**conv,'transcript':raw})
        result,changes=apply_role_policies(self.original(conv),self.rubric,conv,'bot')
        self.assertEqual(result['criteria'][6]['answer'],'yes')
        self.assertTrue(changes)

    def test_previous_handoff_is_not_reused_for_a_later_bot_phase(self):
        conv=handoff()
        raw=[{k:m[k] for k in ('speaker','text','timestamp')} for m in conv['transcript']]
        raw.extend([{'speaker':'client','text':'У меня новый вопрос.','timestamp':'00:05'},
                    {'speaker':'bot','text':'Ждите, оператор появится.','timestamp':'00:06'}])
        conv=normalize_conversation({**conv,'transcript':raw})
        _,changes=apply_role_policies(self.original(conv),self.rubric,conv,'bot')
        self.assertFalse(changes)

    def test_operator_and_ivr_do_not_inherit_bot_exception(self):
        conv = handoff()
        _, changes = apply_role_policies(self.original(conv, 'operator'), self.rubric, conv, 'operator')
        self.assertFalse(changes)
        conv['channel'] = 'voice call'
        _, changes = apply_role_policies(self.original(conv), self.rubric, conv, 'bot')
        self.assertFalse(changes)

    def test_pipeline_applies_rule_and_preserves_raw_judgments_across_cache(self):
        conv = handoff()
        def absent(a):
            a['criteria'][6] = self.original(conv)['criteria'][6]
        provider = ScriptedProvider(self.rubric, change_primary=absent, change_review=absent)
        with tempfile.TemporaryDirectory(dir=ROOT) as temp:
            evaluator = Evaluator(provider, self.rubric, cache_dir=temp, calibration={})
            for result in (evaluator.evaluate(conv), evaluator.evaluate(conv)):
                self.assertEqual(result['score']['total'], 100)
                self.assertEqual(result['primary_assessment']['criteria'][6]['answer'], 'yes')
                self.assertEqual(result['raw_primary_assessment']['criteria'][6]['answer'], 'no')
                self.assertTrue(result['policy_adjustments']['primary'])

    def test_reference_selection_excludes_same_id_and_renamed_duplicate_text(self):
        conv = handoff()
        def example(cid, text, score):
            c = copy.deepcopy(conv)
            c['transcript'][0]['text'] = text
            return {'conversation_id': cid, 'language': 'RU', 'target_role': 'bot', 'source': 'test',
                    'score': score, 'criteria': [], 'transcript': c['transcript'],
                    'transcript_signature': transcript_signature(c)}
        profile = {'examples': [example(conv['conversation_id'], 'different', 10),
                    example('renamed', conv['transcript'][0]['text'], 20),
                    example('legitimate', 'different request', 30)]}
        selected = select_examples(profile, conv, 'bot')
        self.assertEqual([x['conversation_id'] for x in selected], ['legitimate'])

    def test_custom_checklist_disables_mismatched_reference_profile(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as temp:
            path = Path(temp) / 'profile.json'
            write_json(path, {'rubric_hash': 'old-checklist', 'examples': []})
            self.assertIsNone(load_profile(self.rubric, path))


if __name__ == '__main__':
    unittest.main()
