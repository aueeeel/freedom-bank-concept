import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from cqa import learned_memory as memory
from cqa.io import read_json,digest,write_json


class MemoryTests(unittest.TestCase):
    def test_train_family_is_excluded_even_with_different_wording(self):
        conversation={'conversation_id':'training-variant-2','transcript':[{'speaker':'client','text':'Где мои документы?'}]}
        rubric={'version':'test'}
        entries=[{'family':family,'criterion_id':'03','signature':family,'vector':{},'target_role':'operator',
                  'scene':family,'lesson':family,'answer':'na','value':None,'reason':'Общая информация.'} for family in ['same','other']]
        data={'rubric_hash':digest(rubric),'training_ids':{'training-variant-2':'same'},'idf':{},'examples':entries}
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'memory.json';write_json(path.with_name('checklist.json'),rubric)
            with patch.object(memory,'PATH',path),patch.object(memory,'load_memory',return_value=data):
                result=memory.retrieve('03',conversation,'operator')
        self.assertEqual([x['lesson'] for x in result],['other'])

    def test_custom_rubric_does_not_inherit_training(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'memory.json';write_json(path.with_name('checklist.json'),{'version':'changed'})
            with patch.object(memory,'PATH',path),patch.object(memory,'load_memory',return_value={'rubric_hash':'old'}):
                self.assertEqual(memory.retrieve('01',{'conversation_id':'new','transcript':[]},'operator'),[])

    def test_tfidf_is_normalized_and_unknown_words_are_safe(self):
        vector=memory.vector('документы документы баланс',{'документы':1.0,'баланс':2.0})
        self.assertAlmostEqual(sum(value*value for value in vector.values()),1.0)
        self.assertEqual(memory.vector('unknown',{}),{})
