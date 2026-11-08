"""Reference examples, kept separate from inference input and benchmark labels."""
from pathlib import Path

from .io import ValidationError, digest, read_json
from .rubric import validate_answers


DEFAULT_PROFILE = Path(__file__).resolve().parent.parent / 'config/reference_examples.json'


def load_profile(rubric, path=DEFAULT_PROFILE):
    if not Path(path).exists():
        return None
    profile = read_json(path)
    if profile.get('rubric_hash') != digest(rubric):
        return None  # Custom checklist must not silently inherit a different calibration.
    if not isinstance(profile.get('examples'), list):
        raise ValidationError('Профиль примеров требует examples[]')
    for sample in profile['examples']:
        if sample.get('target_role') not in {'bot', 'operator'}:
            raise ValidationError('Неверная роль примера калибровки')
        validate_answers({'criteria': sample['criteria']}, rubric)
    if Path(path) == DEFAULT_PROFILE:
        feedback_path = DEFAULT_PROFILE.with_name('feedback_examples.json')
        if feedback_path.exists():
            feedback = read_json(feedback_path)
            if feedback.get('rubric_hash') == digest(rubric):
                for sample in feedback.get('examples', []):
                    if sample.get('approved') and sample.get('approved_criterion_ids'):
                        validate_answers({'criteria': sample['criteria']}, rubric)
                        profile['examples'].append(sample)
    return profile


def transcript_signature(conversation):
    return digest([(m['speaker'], m['text']) for m in conversation['transcript']])


def select_examples(profile, conversation, target_role, limit=2):
    if not profile:
        return []
    signature = transcript_signature(conversation)
    eligible = [x for x in profile['examples']
                if x['target_role'] == target_role
                and x['conversation_id'] != conversation['conversation_id']
                and x['transcript_signature'] != signature
                and x['language'] == conversation['language']
                and not x.get('warnings')]
    eligible.sort(key=lambda x: (x['score'], x['conversation_id']))
    feedback = [x for x in eligible if x.get('source') == 'confirmed_appeal']
    if feedback:
        feedback.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        chosen = [feedback[0]] + ([next(x for x in eligible if x is not feedback[0])] if len(eligible) > 1 else [])
        chosen = chosen[:limit]
    else:
        chosen = ([eligible[0]] + ([eligible[-1]] if len(eligible) > 1 else []))[:limit] if eligible else []
    return [{'conversation_id': x['conversation_id'], 'target_role': target_role,
             'source': x['source'], 'label_quality': 'user_approximate_reference',
             'transcript': x['transcript'],
             'criteria': [row for row in x['criteria'] if not x.get('approved_criterion_ids')
                          or row['criterion_id'] in x['approved_criterion_ids']]} for x in chosen]


def compact_examples(examples, criterion_ids):
    """Only reference rationale, never a second copy of the current conversation."""
    return [{'conversation_id': x['conversation_id'], 'target_role': x['target_role'],
             'label_quality': x['label_quality'],
             'criteria': [{k: row.get(k) for k in ('criterion_id', 'answer', 'value', 'na_code', 'reason')}
                          for row in x['criteria'] if row['criterion_id'] in criterion_ids]}
            for x in examples]
