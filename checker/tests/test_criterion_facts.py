import unittest
from cqa.criterion_facts import to_assessment
from cqa.io import ValidationError


def transcript(*turns):
    return {'transcript':[{'message_id':f'm{i}', 'index':i, 'speaker':role, 'text':text, 'timestamp':'00:00'}
                          for i,(role,text) in enumerate(turns)]}


def assess(cid, conv, **facts):
    return to_assessment({'rationale':'Проверены конкретные реплики.', 'uncertainties':[], **facts}, {'id':cid}, conv, 'operator')['criteria'][0]


class FactScoringTests(unittest.TestCase):
    def test_satisfied_customer_and_conventional_help_closing(self):
        conv=transcript(('operator','Документы → Справки.'),('client','Справку вижу, спасибо.'),('operator','Рада помочь!'))
        row=assess('07',conv,farewell_ids=[],unanswered_followup_ids=[],customer_departure_ids=[],closing_opportunity='available')
        self.assertEqual(row['answer'],'yes')

    def test_kazakh_verification_is_completed_not_negated(self):
        from cqa.criterion_facts import verified_phrase
        self.assertTrue(verified_phrase('Клиенттің тұлғасы расталды.'))
        self.assertFalse(verified_phrase('Клиенттің тұлғасы расталмады.'))

    def test_final_explicit_question_followed_only_by_goodbye_is_incomplete(self):
        conv=transcript(('operator','Откройте документы.'),('client','А где они?'),('operator','Всего доброго!'))
        row=assess('07',conv,farewell_ids=['m2'],unanswered_followup_ids=[],customer_departure_ids=[],closing_opportunity='available')
        self.assertEqual(row['answer'],'no')

    def test_management_schema_requires_evidence_from_the_assessed_actor(self):
        from cqa.criterion_facts import facts_schema
        conv=transcript(('bot','Подключаю коллегу.'),('operator','Откройте раздел X.'),('client','Не понял, где?'))
        schema=facts_schema('06',conv,'operator')['properties']['actor_evidence_ids']
        self.assertEqual(schema['minItems'],1)
        self.assertEqual(schema['items']['enum'],['m1'])

    def test_client_confusion_does_not_replace_the_actor_reply(self):
        conv=transcript(('operator','Откройте раздел X.'),('client','Не понял, где?'))
        facts=dict(flow='one_issue',actor_evidence_ids=[],client_confusion_ids=['m1'],waiting='none',waiting_evidence_ids=[],redundant_question_ids=[])
        with self.assertRaises(ValidationError):assess('06',conv,**facts)
        row=assess('06',conv,**{**facts,'actor_evidence_ids':['m0']})
        self.assertEqual(row['value'],7)
        self.assertEqual([x['message_id'] for x in row['evidence']],['m0','m1'])

    def test_late_identity_does_not_authorize_previous_balance(self):
        conv = transcript(('client','Мой баланс?'),('operator','Ваш баланс 520000 тенге.'),
                          ('system','Идентификация успешно пройдена.'),('operator','У вас 20 акций.'))
        row = assess('03', conv, protected_events=[{'message_id':'m1','kind':'account_disclosure'},
                     {'message_id':'m3','kind':'account_disclosure'}], verification_confirmation_ids=['m2'])
        self.assertEqual(row['answer'],'no')
        self.assertEqual(row['evidence'][0]['message_id'],'m1')
        gross = assess('08', conv, insult_ids=[], off_company_paid_ids=[], confidential_disclosure_ids=['m1','m3'], verification_confirmation_ids=['m2'])
        self.assertEqual(gross['answer'],'yes')
        self.assertEqual([x['message_id'] for x in gross['evidence']],['m1'])

    def test_menu_help_does_not_require_identity(self):
        conv = transcript(('client','Где документы?'),('operator','Откройте Профиль → Документы.'))
        self.assertEqual(assess('03',conv,protected_events=[],verification_confirmation_ids=[])['answer'],'na')

    def test_company_or_navigation_is_not_personal_introduction(self):
        conv = transcript(('client','Hello'),('operator','Hi. Check Profile.'))
        self.assertEqual(assess('01',conv,greeting_quote='Hi.',introduction_quote='Check Profile.')['answer'],'no')

    def test_early_goodbye_does_not_close_new_unanswered_question(self):
        conv = transcript(('client','Тариф изменился?'),('operator','Да. До свидания!'),
                          ('client','А комиссию вернут?'),('system','Оператор завершил чат.'))
        row = assess('07',conv,farewell_ids=[],unanswered_followup_ids=['m2'],customer_departure_ids=[],closing_opportunity='available')
        self.assertEqual(row['answer'],'no')
        self.assertIn('m2',row['explanation'])

    def test_unanswered_material_question_caps_consultation(self):
        conv = transcript(('client','Где отчёт и как вернуть комиссию?'),('operator','Отчёт в Документах.'))
        row = assess('04',conv,request_parts=[{'client_message_id':'m0','importance':'material','outcome':'resolved','actor_evidence_ids':['m1']},
            {'client_message_id':'m0','importance':'material','outcome':'unanswered','actor_evidence_ids':[]}],
            no_substantive_request=False,requested_handoff_ids=[],client_success_confirmation_ids=[])
        self.assertEqual(row['value'],10)

    def test_customer_anger_alone_cannot_prove_staff_disrespect(self):
        conv = transcript(('client','Вы идиоты!'),('operator','Понимаю ваше недовольство, помогу разобраться.'))
        with self.assertRaises(ValidationError):
            assess('05',conv,respect='disrespectful',respect_evidence_ids=[],customer_context='distress_or_anger',
                   customer_context_ids=['m0'],response='acknowledged_and_helpful',response_evidence_ids=['m1'])

    def test_generic_hint_is_not_total_absence_of_answer(self):
        conv = transcript(('client','What is the standard tariff commission?'),('operator',"It's in the app."))
        row = assess('04',conv,request_parts=[{'client_message_id':'m0','importance':'material','outcome':'unanswered','actor_evidence_ids':[]}],
                     no_substantive_request=False,requested_handoff_ids=[],client_success_confirmation_ids=[],generic_guidance_ids=['m1'])
        self.assertEqual(row['value'],5)
        self.assertEqual(row['evidence'][0]['message_id'],'m1')

    def test_warned_wait_has_no_arbitrary_three_minute_penalty(self):
        conv = transcript(('operator','Проверка займёт 9 минут.'),('client','Хорошо, подожду.'),('operator','Проверка завершена.'))
        row = assess('06',conv,flow='clear',actor_evidence_ids=['m0','m2'],client_confusion_ids=[],waiting='warned',waiting_evidence_ids=['m0','m1'])
        self.assertEqual(row['value'],10)

    def test_acknowledgement_and_assistance_are_not_erased_by_incomplete_consultation(self):
        conv=transcript(('client','Я переживаю из-за комиссии.'),('operator','Понимаю ваше беспокойство. Передам расчёт на проверку.'),
                        ('client','Когда будет результат?'),('operator','Срок пока не назову.'))
        row=assess('05',conv,respect='respectful',respect_evidence_ids=['m1'],customer_context='distress_or_anger',
                   customer_context_ids=['m0'],response='uncertain',response_evidence_ids=['m1'],acknowledgement_ids=['m1'],dismissal_ids=[])
        self.assertEqual(row['answer'],'yes')

    def test_empathy_fact_protocol_keeps_customer_insult_separate(self):
        conv=transcript(('client','Вы идиоты, деньги не приходят!'),('operator','Понимаю ваше беспокойство. Проверю статус перевода.'))
        row=assess('05',conv,respect_evidence_ids=['m1'],disrespect_ids=[],customer_context='distress_or_anger',
                   customer_context_ids=['m0'],response_evidence_ids=['m1'],acknowledgement_ids=['m1'],dismissal_ids=[])
        self.assertEqual(row['answer'],'yes')

    def test_empathy_fact_protocol_detects_actual_staff_disrespect(self):
        conv=transcript(('client','Где документы?'),('operator','Вы вообще читать умеете? В профиле.'))
        row=assess('05',conv,respect_evidence_ids=[],disrespect_ids=['m1'],customer_context='neutral',
                   customer_context_ids=['m0'],response_evidence_ids=['m1'],acknowledgement_ids=[],dismissal_ids=['m1'])
        self.assertEqual(row['answer'],'no')
