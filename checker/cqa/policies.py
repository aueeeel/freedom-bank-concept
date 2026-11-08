"""Explicit, versioned business rules approved by the user; no keyword scoring."""
from copy import deepcopy
import re


def handoff_notice(text, approved_texts):
    if text.strip() in approved_texts:return True
    # Equivalent wording is accepted only alongside the configured system event
    # and an actual subsequent operator reply. Quoted/hypothetical notices do not count.
    value=re.sub(r'«[^»]*»|"[^"]*"','',text.casefold())
    if re.search(r'\b(?:если|например|suppose|if)\b|не (?:подключ|соедин|переда|будет оператора)|will not|won.t',value):return False
    actor=re.search(r'оператор|специалист|\b(?:agent|operator)\b',value)
    pending=re.search(r'ожидайте|подождите|please wait|hold on|передаю|соединяю|подключаю|перевожу',value)
    connection=re.search(r'подключ|соедин|переда|перевожу|\bjoin|\bconnect|\btransfer',value)
    return bool(actor and pending and connection)


def apply_role_policies(assessment, rubric, conversation, target_role):
    result, changes = deepcopy(assessment), []
    if target_role != 'bot' or conversation.get('channel') != 'agent chat':
        return result, changes
    messages = conversation['transcript']
    own = [i for i, m in enumerate(messages) if m['speaker'] == 'bot']
    if not own:
        return result, changes
    last = own[-1]
    previous_operator=max((i for i in range(last) if messages[i]['speaker']=='operator'),default=-1)
    for criterion in rubric['criteria']:
        rule = criterion.get('role_rules', {}).get('bot', {}).get('approved_handoff')
        if not rule:
            continue
        warning=next((i for i in reversed(own) if i>previous_operator
                      and handoff_notice(messages[i]['text'],rule.get('closing_texts',[]))),None)
        if warning is None:
            continue
        # A neutral bot follow-up does not erase the warning in its current phase.
        # The actual sequence must still be warning -> transfer -> operator reply.
        operator = next((i for i in range(last + 1, len(messages)) if messages[i]['speaker'] == 'operator'), None)
        if rule.get('require_operator_reply', True) and operator is None:
            continue
        stop = operator if operator is not None else len(messages)
        transfer = next((i for i in range(warning + 1, stop)
                         if messages[i]['speaker'] == 'system'
                         and messages[i]['text'].strip() in rule.get('system_events', [])), None)
        if transfer is None:
            continue
        for row in result['criteria']:
            if row['criterion_id'] != criterion['id']:
                continue
            before = deepcopy(row)
            refs = [warning, transfer] + ([operator] if operator is not None else [])
            row.update(answer='yes', value=None, basis='observed', checked_range=None,
                       na_code=None, na_reason=None, factual_support='not_needed',
                       knowledge_evidence=[], uncertainties=[],
                       explanation='Штатный сценарий завершения этапа бота выполнен: уведомление, '
                                   'системная передача и ответ оператора. По согласованному правилу '
                                   'отдельное прощание и итог решения от бота не требуются.',
                       evidence=[{'message_id': messages[i]['message_id'], 'quote': messages[i]['text']} for i in refs])
            if before != row:
                changes.append({'criterion_id': criterion['id'], 'rule_id': rule['rule_id'],
                                'before': before, 'after': deepcopy(row)})
    return result, changes
