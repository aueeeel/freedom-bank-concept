import copy
import io
import json
import unittest

from cqa.local_provider import OllamaProvider,compact_schema,expand_compact
from cqa.schemas import assessment_schema,validate_shape
from cqa.evidence import validate_assessment
from cqa.io import ValidationError
from cqa.engine import Evaluator,resolve_criterion
from tests.test_checker import ScriptedProvider,conversation,assessment,ROOT
from cqa.io import read_json


class LocalProviderTests(unittest.TestCase):
    def test_local_profile_reads_each_criterion_twice(self):
        rubric=read_json(ROOT/'config/checklist.json')
        class PerCriterion:
            identity={'model':'test-local','provider':'ollama','evaluation_mode':'per_criterion','requires_manual_review':True}
            usage=[]
            calls=[]
            def structured(self,stage,prompt,payload,schema):
                self.calls.append((stage,payload['checklist']['criteria'][0]['id']))
                return assessment(payload['checklist'],payload['conversation'],payload['target_role'])
        provider=PerCriterion()
        result=Evaluator(provider,rubric).evaluate(conversation())
        self.assertEqual(len(provider.calls),16)
        self.assertEqual([c[0] for c in provider.calls],['judge']*8+['review']*8)
        self.assertEqual(result['score']['total'],100)
        self.assertIsNone(result['final_score'])

    def test_operator_evidence_cannot_select_bot_or_client(self):
        rubric=read_json(ROOT/'config/checklist.json')
        payload={'target_role':'operator','conversation':conversation(),'checklist':rubric}
        compact=compact_schema('judge',payload,assessment_schema(rubric))
        allowed=compact['properties']['criteria']['properties']['01']['anyOf'][0]['properties']['evidence_ids']['items']['enum']
        self.assertEqual(allowed,['m00002'])
    def test_compact_assessment_preserves_decisions_and_source_quotes(self):
        rubric=read_json(ROOT/'config/checklist.json')
        conv=conversation()
        original=assessment(rubric)
        compact={'criteria':{},'summary':original['summary']}
        for r in original['criteria']:
            checked=r['checked_range']
            compact['criteria'][r['criterion_id']]={
                'answer':r['answer'],'value':r['value'],'reason':r['explanation'],'basis':r['basis'],
                'evidence_ids':[e['message_id'] for e in r['evidence']],
                'checked_range':[checked['start_message_id'],checked['end_message_id']] if checked else None,
                'na_code':r['na_code'],'na_reason':r['na_reason'],'support':r['factual_support'],
                'knowledge':r['knowledge_evidence'],'uncertainties':r['uncertainties']}
        payload={'conversation':conv,'checklist':rubric}
        validate_shape(compact,compact_schema('judge',payload,assessment_schema(rubric)))
        expanded=expand_compact('judge',compact,payload)
        self.assertEqual(expanded,original)
        validate_assessment(expanded,rubric,conv,{'documents':[]},'bot')

    def test_compact_range_must_have_two_endpoints(self):
        with self.assertRaises(ValidationError):
            validate_shape(['one'],{'type':'array','items':{'type':'string'},'minItems':2,'maxItems':2})

    def test_cloud_address_rejected(self):
        for url in ('https://api.openai.com','http://example.com','http://user:password@localhost:11435'):
            with self.assertRaises(ValidationError): OllamaProvider(base_url=url)

    def test_local_contract(self):
        seen=[]
        def opener(request,timeout):
            seen.append((request,json.loads(request.data)))
            return io.BytesIO(b'{"done":true,"done_reason":"stop","message":{"content":"{\\"text\\":\\"ok\\"}"},"eval_count":4}')
        provider=OllamaProvider(opener=opener)
        schema={'type':'object','properties':{'text':{'type':'string'}},'required':['text'],'additionalProperties':False}
        self.assertEqual(provider.structured('facts','instructions',{'input':'x'},schema),{'text':'ok'})
        request,body=seen[0]
        self.assertEqual(request.full_url,'http://127.0.0.1:11435/api/chat')
        self.assertFalse(request.has_header('Authorization'))
        self.assertEqual(body['format'],schema)
        self.assertFalse(body['stream'])

    def test_local_results_require_expert_review(self):
        rubric=read_json(ROOT/'config/checklist.json')
        provider=ScriptedProvider(rubric)
        provider.identity={**provider.identity,'provider':'ollama','requires_manual_review':True}
        result=Evaluator(provider,rubric).evaluate(conversation())
        self.assertEqual(result['status'],'needs_review')
        self.assertIsNone(result['final_score'])
        self.assertEqual(result['score']['total'],100)
        row=copy.deepcopy(result['primary_assessment']['criteria'][0])
        changed=resolve_criterion(result,row,'expert','Проверено')
        self.assertEqual(changed['status'],'needs_review')


if __name__=='__main__': unittest.main()
