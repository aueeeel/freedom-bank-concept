import unittest
from pathlib import Path
from cqa.io import read_json,normalize_conversation
from cqa.policies import apply_role_policies,handoff_notice
from cqa.observable_rules import extract
from cqa.criterion_facts import to_assessment

class HandoffVariantTests(unittest.TestCase):
    def conversation(self,notice,event=True,reply=True):
        turns=[('client','Подключите оператора.'),('bot',notice)]
        if event:turns.append(('system','Эскалация на оператора.'))
        if reply:turns.append(('operator','Здравствуйте! Я Анна.'))
        return normalize_conversation({'conversation_id':'handoff-variant','channel':'agent chat','language':'RU',
            'transcript':[{'timestamp':'00:00','speaker':role,'text':text} for role,text in turns]})
    def test_equivalent_warning_inside_greeting_and_actual_transfer(self):
        rubric=read_json(Path(__file__).resolve().parents[1]/'config/checklist.json')
        conv=self.conversation('Здравствуйте! Я виртуальный помощник. Пожалуйста, ожидайте, оператор скоро подключится.')
        row,changes=apply_role_policies({'criteria':[{'criterion_id':'07','answer':'no'}]},rubric,conv,'bot')
        self.assertEqual(row['criteria'][0]['answer'],'yes');self.assertTrue(changes)
        self.assertEqual(to_assessment(extract('04',conv,'bot'),{'id':'04'},conv,'bot')['criteria'][0]['value'],20)
    def test_warning_variation_does_not_replace_event_or_operator(self):
        rubric=read_json(Path(__file__).resolve().parents[1]/'config/checklist.json')
        for event,reply in [(False,True),(True,False)]:
            conv=self.conversation('Пожалуйста, ожидайте, оператор скоро подключится.',event,reply)
            row,changes=apply_role_policies({'criteria':[{'criterion_id':'07','answer':'no'}]},rubric,conv,'bot')
            self.assertEqual(row['criteria'][0]['answer'],'no');self.assertFalse(changes)
    def test_quoted_or_hypothetical_notice_is_not_an_actual_handoff_notice(self):
        self.assertFalse(handoff_notice('Пример фразы: «Пожалуйста, ожидайте, оператор скоро подключится».',[]))
        self.assertFalse(handoff_notice('Если захотите, подождите: оператор подключится.',[]))

