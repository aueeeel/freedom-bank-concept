"""Ground unambiguous events in text; defer uncertain interpretations to the model."""
import re
from .criterion_facts import verified_phrase,farewell_phrase,departure_phrase

def common(reason,**fields):return {'rationale':reason,'uncertainties':[],**fields}

def first_turn(messages,role):
    start=next(i for i,m in enumerate(messages) if m['speaker']==role)
    # The checklist requires greeting and introduction in the first response.
    # A later independently timestamped message cannot repair that first response.
    return [messages[start]]

def contact(conversation,role):
    own=first_turn(conversation['transcript'],role);text='\n'.join(m['text'] for m in own)
    language=conversation.get('language','').upper()
    patterns={'RU':r'здравствуйте|добрый день|доброе утро|добрый вечер|приветствую|привет',
              'EN':r'\bhello\b|\bhi\b|good (?:morning|afternoon|evening)|\bgreetings\b',
              'KZ':r'сәлеметсіз бе|сәлем|қайырлы (?:күн|таң|кеш)'}
    if language not in patterns:return None
    greeting=re.search(patterns[language],text,re.I)
    if role=='operator':
        introduction=re.search(r'(?:меня зовут|мо[её] имя|my name is|this is|I am|I.m|менің атым)\s+[^\s,.!?]+',text,re.I)
        if not introduction:introduction=re.search(r'\b(?:Я|Мен)\s+[А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]+',text)
    else:
        introduction=re.search(r'(?:Я|Мен|I am|I.m)\b[^.!?\n]{0,100}(?:бот|помощник|ассистент|көмекші|assistant|\bbot\b)[^.!?\n]*',text,re.I)
    # A name in an unfamiliar nominal introduction is left to the semantic model.
    if not introduction and re.search(r'(?:здравствуйте|hello|hi)[!,]\s+[A-ZА-ЯЁ][a-zа-яё]+\s*,',text):return None
    return common('Первый ход '+own[0]['message_id']+': '+('приветствие найдено' if greeting else 'приветствия на языке клиента нет')
                  +'; '+('личное представление найдено.' if introduction else 'личного представления нет.'),
                  greeting_quote=greeting.group() if greeting else '',introduction_quote=introduction.group() if introduction else '')


def protected_claims(conversation,role):
    events=[];unknown=[]
    patterns=[
      r'(?:ваш[а-яё]*\s+)?(?:обращени[а-яё]*|документ|заявк[а-яё]*)\s+[A-ZА-Я0-9][\w.-]{2,}[^.!?\n]{0,60}(?:закрыт[а-яё]*|готов[а-яё]*|подготовлен[а-яё]*|рассматрива[а-яё]*|проверка.{0,20}ид[её]т)[^.!?\n]*',
      r'(?:по вашей\s+)?[A-Z][A-Z0-9-]{3,}[^.!?\n]{0,35}(?:рассматривается|проверка.{0,20}ид[её]т|өтініші\s+қаралуда)[^.!?\n]*',
      r'конфиденциальн[а-яё]*\s+(?:токен|код|пароль)[^.!?\n]{0,120}:\s*\S+',
      r'(?:на вашем сч[её]те|ваш(?: свободный)? (?:баланс|остаток)|у вас(?: на сч[её]те)?)[^.!?\n]{0,55}\d[\d\s.,]*[^.!?\n]{0,35}',
      r'(?:ваш[а-яё]* (?:заявк[а-яё]*|перевод[а-яё]*|операци[а-яё]*)|на вашем сч[её]те)[^.!?\n]{0,120}(?:исполнен[а-яё]*|выполнен[а-яё]*|отклонен[а-яё]*|обработан[а-яё]*|ожида[а-яё]*[^.!?\n]{0,45}(?:расч[её]т|заверш|провер))[^.!?\n]*',
      r'your (?:available |account )?(?:balance|holdings)[^.!?\n]{0,50}\d[^.!?\n]*',
      r'(?:you have|you hold|your portfolio contains)[^.!?\n]{0,30}\d[^.!?\n]{0,45}(?:shares|stocks)[^.!?\n]*',
      r'your (?:order|transfer|withdrawal)[^.!?\n]{0,80}(?:completed|pending|processed|rejected)[^.!?\n]*',
      r'(?:сіздің[^.!?\n]{0,50}өтінім[^.!?\n]{0,30}(?:орындалды|орындалған)|шотыңызда[^.!?\n]{0,30}\d[^.!?\n]*)',
    ]
    for message in conversation['transcript']:
        if message['speaker']!=role:continue
        text=message['text']
        match=next((match for pattern in patterns if (match:=re.search(pattern,text,re.I))),None)
        if match:
            quote=match.group().strip()
            if re.search(r'например|допустим|предположим|если |могут|может |example|suppose|\bif\b|\bmay\b',quote,re.I):
                unknown.append(message['message_id']);continue
            events.append({'message_id':message['message_id'],'kind':'account_disclosure','quote':quote,'is_actual_disclosure_or_executed_action':True})
            continue
        action=re.search(r'(?:я (?:отменил[аи]?|изменил[аи]?|заблокировал[аи]?)|контактный адрес.{0,25}(?:обновл[её]н|измен[её]н|замен[её]н)|адрес.{0,50}(?:заменил[аи]?|обновил[аи]?|изменил[аи]?)|I (?:have )?(?:cancelled|changed|blocked))[^.!?\n]{0,60}',text,re.I)
        if action:
            events.append({'message_id':message['message_id'],'kind':'protected_action','quote':action.group(),'is_actual_disclosure_or_executed_action':True});continue
        personal=re.search(r'ваш|у вас|your |сіздің|шотыңыз',text,re.I)
        financial=re.search(r'баланс|остаток|портфел|заявк|перевод|операци|сч[её]т|средств|акци|balance|holdings|portfolio|order|transfer|шот|өтінім',text,re.I)
        safe=re.search(r'нужн|потребует|подтверд|идентификац|для провер|мож(?:но|ет|ете)|могут|после продаж|обычно|открой|посмотр|перейд|создай|пройд|не могу подтвердить|please verify|need.*verif|open |go to |can |may |must verify|сәйкестендіру|өтіңіз',text,re.I)
        if personal and financial and not safe:unknown.append(message['message_id'])
    return events,unknown


def safety(conversation,role):
    events,unknown=protected_claims(conversation,role)
    if unknown:return None
    verified=[m['message_id'] for m in conversation['transcript'] if m['speaker']=='system' and verified_phrase(m['text'])]
    return common('Фактические защищённые действия: '+(', '.join(e['message_id'] for e in events) or 'не обнаружены')
                 +'. Системные подтверждения личности: '+(', '.join(verified) or 'отсутствуют')+'.',
                 protected_events=events,verification_confirmation_ids=verified)


def needs(conversation,role):
    messages=conversation['transcript'];own=[m for m in messages if m['speaker']==role]
    client=[m for m in messages if m['speaker']=='client']
    if not client:return None
    questions=[];repeated=[]
    for message in own:
        value=message['text'].casefold();prior_text=' '.join(m['text'] for m in client if m['index']<message['index']);prior=prior_text.casefold()
        if re.search(r'на каком(?: именно)? рынке|which market',value) and re.search(r'американ|сша|us market|american',prior):repeated.append(message['message_id'])
        if re.search(r'желаете.{0,30}соедин|хотите.{0,30}соедин|would you like.{0,20}(?:connect|agent)',value) and re.search(r'соедините|подключите|нужен оператор|оператор нужен|connect me|need an agent',prior):repeated.append(message['message_id'])
        if re.search(r'(?:хотите|нужен|нужна|нужны|желаете).{0,25}оператор.{0,15}\?',value) and re.search(r'(?:подключите|соедините|позовите).{0,25}оператор|нужен оператор|оператор нужен',prior):repeated.append(message['message_id'])
        if re.search(r'приложени.{0,15}или.{0,15}(?:веб|сайт)|app or (?:the )?website',value) and re.search(r'в приложении|на сайте|using the app|on the website',prior):repeated.append(message['message_id'])
        if re.search(r'(?:какого|какой) банк',value) and re.search(r'из (?:банка )?[A-ZА-ЯЁ][\w.-]+',prior_text):repeated.append(message['message_id'])
        if '?' not in value:continue
        if re.search(r'соглас|данных|кодовое слово|дата рождения|identity|code word|date of birth|чем могу помочь|how can i help',value):continue
        if re.search(r'из какого банка|какой банк|когда.{0,25}(?:отправ|подал)|каком шаге|какая ошибка|текст ошибки|приложени.{0,15}или.{0,15}(?:веб|сайт)|app or (?:the )?website',value):questions.append(message['message_id'])
    if repeated:
        return common('Повтор уже сообщённого: '+', '.join(repeated)+'.',initial_details_sufficient=False,missing_detail='',uses_known_context=False,
                      discovery_question_ids=[],context_ids=[client[0]['message_id']],repeated_known_question_ids=repeated)
    first=client[0]['text'].casefold()
    if questions and not re.search(r' и | а также | and ',first):
        return common('В '+', '.join(questions)+' задан вопрос о недостающей детали, а не идентификации.',initial_details_sufficient=False,missing_detail='Уточняемая деталь обращения',
                      uses_known_context=True,discovery_question_ids=questions,context_ids=[client[0]['message_id']],repeated_known_question_ids=[])
    if not questions:
        navigation=re.search(r'где|как.{0,20}(?:откры|скача)|не (?:могу )?найти|раздел.{0,20}не наш|нужно скачать|нужн[аоы].{0,15}(?:справк|документ|выписк)|where|қайдан',first) and re.search(r'документ|справк|отч[её]т|выписк|раздел|report|document|statement|құжат',first)
        vague=re.search(r'не работает|ничего не получается|not working',first)
        handoff=role=='bot' and re.search(r'оператор|operator|agent',first) and len(first)<120
        personal_balance=re.search(r'мой (?:баланс|остаток)|my (?:account )?balance',first) and not re.search(r'нескольк.{0,15}сч[её]т|два сч[её]та|multiple accounts',first)
        if navigation or vague or handoff or personal_balance:
            sufficient=bool(navigation or handoff or personal_balance)
            return common('Общая навигация/передача не требует уточнений.' if sufficient else 'Причина технической проблемы не выяснялась.',
                initial_details_sufficient=sufficient,missing_detail='' if sufficient else 'Конкретный шаг и проявление ошибки',uses_known_context=True,
                discovery_question_ids=[],context_ids=[client[0]['message_id']],repeated_known_question_ids=[])
    return None


def closing(conversation,role):
    messages=conversation['transcript'];own=[m for m in messages if m['speaker']==role]
    if any(re.search(r'например|сказал|цитат|фраза|for example',m['text'],re.I) and farewell_phrase(m['text']) for m in own):return None
    farewells=[m for m in own if farewell_phrase(m['text'])]
    last=own[-1]
    later=[m for m in messages if m['index']>last['index']]
    closer=r'(?:бот|bot)' if role=='bot' else r'(?:оператор|сотрудник|agent|operator)'
    closed=any(m['speaker']=='system' and re.search(closer+r'.{0,20}(?:заверш|закр|closed|ended)'+(r'|чат заверш[её]н оператором' if role=='operator' else ''),m['text'],re.I) for m in later)
    follow=[m['message_id'] for m in later if m['speaker']=='client' and ('?' in m['text'] or re.search(r'ещ[её] вопрос|ещ[её] хочу|another question',m['text'],re.I))]
    departed=[m['message_id'] for m in later if m['speaker']=='system' and departure_phrase(m['text'])]
    request_pattern=r'напишите|уточните|подскажите|расскажите|сообщите|please (?:tell|describe)|проверяю|подождите|ожидайте'
    awaiting='?' in last['text'] or bool(re.search(request_pattern,last['text'],re.I))
    if not awaiting and departed:
        earlier=[m for m in own if '?' in m['text'] or re.search(request_pattern,m['text'],re.I)]
        if earlier:
            replies=[m for m in messages if m['speaker']=='client' and m['index']>earlier[-1]['index']]
            awaiting=bool(replies) and all(re.search(r'секунду|перечитаю|читаю|one moment|reading|бір сәт|оқып',m['text'],re.I) for m in replies)
    if farewells or closed or departed and awaiting:
        return common('Проверены фактическое прощание, новые вопросы и завершение системы.',farewell_ids=[m['message_id'] for m in farewells],
                      unanswered_followup_ids=follow,customer_departure_ids=departed,
                      closing_opportunity='interrupted' if departed and awaiting else 'available')
    return None

def consultation(conversation,role):
    messages=conversation['transcript'];own=[m for m in messages if m['speaker']==role]
    client=[m for m in messages if m['speaker']=='client']
    if not client:return None
    def result(parts,reason,success=(),handoff=()):
        return common(reason,request_parts=parts,no_substantive_request=False,requested_handoff_ids=list(handoff),
                      client_success_confirmation_ids=list(success),generic_guidance_ids=[])
    def part(ref,outcome,proof,importance='material'):
        return {'client_message_id':ref,'importance':importance,'outcome':outcome,'actor_evidence_ids':proof}
    paid=[m for m in own if re.search(r'лично мне|мне лично|pay me personally',m['text'],re.I)
          and re.search(r'частн|в обход|private service',m['text'],re.I)
          and re.search(r'переведите|перечислит|нужно.{0,30}плат|pay me',m['text'],re.I)
          and not re.search(r'не (?:переводите|перечисляйте|платите)|не предлагаю|цитирую|цитата',m['text'],re.I)]
    if paid:
        return result([part(client[0]['message_id'],'wrong',[paid[0]['message_id']])],
                      'Вместо официальной помощи проверяемый требует личную оплату частной услуги в обход компании.')
    if role=='bot':
        from pathlib import Path
        from .io import read_json
        from .policies import apply_role_policies
        rubric=read_json(Path(__file__).resolve().parent.parent/'config/checklist.json')
        _,changes=apply_role_policies({'criteria':[{'criterion_id':'07','answer':'no'}]},rubric,conversation,role)
        requests=[m for m in client if m['index']<own[-1]['index'] and re.search(r'оператор|специалист|agent|operator',m['text'],re.I)]
        if changes and requests:
            return result([part(requests[-1]['message_id'],'actionable_next_step',[own[-1]['message_id']])],
                          'Запрошенная передача фактически выполнена: предупреждение, системное событие и ответ оператора.',handoff=[requests[-1]['message_id']])
        return None
    success=[m for m in client if re.search(r'наш[её]л|скачал|открыл|открылось|нашла|получилось|\bfound\b|\bopened\b|таптым|жібердім',m['text'],re.I)
             and not re.search(r'не помог|не решил|не наш[её]л|не скачал|not solved|not found|but.{0,25}(?:cannot|missing|failed)',m['text'],re.I)]
    route=[m for m in own if ('→' in m['text'] or re.search(r'откройте.{0,20}профиль|open profile',m['text'],re.I))]
    personal,_=protected_claims(conversation,role)
    requested=' '.join(m['text'] for m in client).casefold()
    relevant_personal=[]
    for event in personal:
        quote=event['quote'].casefold()
        if (re.search(r'ожида|расч[её]т|pending|settle',quote) and re.search(r'деньг|средств|продал|вывод|вывести|доступн|funds|withdraw|settle',requested)) or (re.search(r'баланс|остаток|на вашем сч[её]те|balance',quote) and re.search(r'баланс|остаток|сколько.{0,15}денег|balance',requested)) or any(re.search(topic,quote) and re.search(topic,requested) for topic in ['заявк','перевод','операци','order','transfer']):
            relevant_personal.append(event['message_id'])
    positive=route or [m for m in own if m['message_id'] in relevant_personal]
    if success:
        resource_groups=[r'документ|справк|document|құжат',r'отч[её]т|report|есеп']
        for group in resource_groups:
            if not re.search(group,requested,re.I):continue
            before_confirmation=[m for m in own if re.search(group,m['text'],re.I) and any(s['index']>m['index'] for s in success)]
            if before_confirmation:positive=[before_confirmation[-1]]+positive;break
    if not positive and success:
        positive=[m for m in own if re.search(r'профил|документ|отч[её]т|document|report',m['text'],re.I)]
    if not positive:
        hints=[];unrelated=[];other=[]
        for message in own:
            text=message['text']
            hint=re.search(r'где-то в приложении|вс[её] (?:есть |написано )?в приложении|it.s in the app|somewhere in the app',text,re.I)
            smalltalk=re.search(r'сегодня хорошая погода|today.{0,10}(?:weather|sunny)',text,re.I)
            remaining=text
            for pattern,flags in [(r'здравствуйте[!. ]*',re.I),(r'меня зовут\s+\w+[!. ]*',re.I),
                                  (r'\b[Яя]\s+[А-ЯЁ][а-яё]+[!. ]*',0),(r'хорошо,? я на связи[!. ]*',re.I)]:
                remaining=re.sub(pattern,'',remaining,flags=flags)
            if hint:
                remaining=remaining.replace(hint.group(),'');hints.append(message['message_id'])
            if smalltalk:
                remaining=remaining.replace(smalltalk.group(),'');unrelated.append(message['message_id'])
            if re.search(r'[^\W\d_]',remaining,re.UNICODE):other.append(message['message_id'])
        business_request=bool(re.search(r'документ|справк|отч[её]т|комисси|возврат|денег|деньги|перевод|заявлен|report|document|refund|commission|money|құжат|өтініш',requested,re.I))
        if not other and (hints or unrelated) and business_request:
            if hints:return common('Дана только общая подсказка без нужного маршрута.',request_parts=[part(client[0]['message_id'],'vague',hints)],
                no_substantive_request=False,requested_handoff_ids=[],client_success_confirmation_ids=[],generic_guidance_ids=hints)
            return result([part(client[0]['message_id'],'unanswered',[])],'Содержательный запрос есть, но ответ ограничен нерелевантной светской репликой.')
        return None
    last=own[-1]['index']
    unanswered=[m for m in client if m['index']>last and '?' in m['text']]
    initial=client[0]
    proof=[positive[0]['message_id']]
    if unanswered:
        later=unanswered[-1]
        secondary=bool(re.search(r'какого цвета|цвет значка|просто интересно|icon colo[u]?r',later['text'],re.I))
        if not secondary and not re.search(r'комисси|возврат|верну|когда|куда|результат|срок|refund|fee|when|where|қай|нәтиже',later['text'],re.I):return None
        return result([part(initial['message_id'],'resolved',proof),part(later['message_id'],'unanswered',[],'secondary' if secondary else 'material')],
                      'Дан содержательный ответ, но последующий '+('необязательный' if secondary else 'существенный')+' вопрос остался без ответа.',
                      success=[m['message_id'] for m in success])
    optional=re.search(r'какого цвета|цвет значка|просто интересно|icon colo[u]?r',initial['text'],re.I)
    if optional and not any(re.search(r'синий|зел[её]ный|красный|blue|green|red',m['text'],re.I) for m in own):
        return result([part(initial['message_id'],'resolved',proof),part(initial['message_id'],'unanswered',[],'secondary')],
                      'Основная навигационная задача решена, необязательная деталь о значке не раскрыта.',success=[m['message_id'] for m in success])
    simple=initial['text'].count('?')<=1 and not re.search(r' и | а также | and |;|а ещ[её]',initial['text'],re.I)
    shared_resource=any(re.search(pattern,initial['text'],re.I) and any(re.search(pattern,m['text'],re.I) for m in route)
                        for pattern in [r'документ|выписк|document|statement|құжат',r'отч[её]т|report|есеп',r'тариф|tariff',r'возврат|refund',r'заявк|обращен|request|өтініш'])
    if route and simple and (success or shared_resource):
        return result([part(initial['message_id'],'resolved',proof)],'На единственный навигационный запрос дана конкретная инструкция.',
                      success=[m['message_id'] for m in success])
    return None

def empathy(conversation,role):
    own=[m for m in conversation['transcript'] if m['speaker']==role]
    client=[m for m in conversation['transcript'] if m['speaker']=='client']
    hostile=[]
    for m in own:
        if re.search(r'(?:нужно перечислить|переведите).{0,40}(?:мне лично|лично мне)',m['text'],re.I) and re.search(r'частн|в обход',m['text'],re.I) and not re.search(r'не переводите|цитирую|цитата',m['text'],re.I):
            hostile.append(m['message_id'])
        if re.search(r'(?:вы|ты).{0,12}(?:идиот|туп[аоы]|безмозгл|читать умеете)|ваши проблемы|ваши (?:переживания|сложности)\s*[—-]\s*ваши (?:трудности|проблемы)|ждите молча|сами разбирайтесь|отстаньте|мазамды алма|you.{0,8}(?:idiot|stupid)',m['text'],re.I):
            if re.search(r'сказал|назвал|цитат|цитирую|например|for example|called you',m['text'],re.I):return None
            hostile.append(m['message_id'])
    acknowledgement=[m['message_id'] for m in own if re.search(r'понимаю.{0,90}(?:беспокой|недоволь|разниц|неудоб|раздраж|страх|пережив)|understand.{0,65}(?:frustrat|worr|concern|inconven)',m['text'],re.I)]
    helpful=[m['message_id'] for m in own if re.search(r'проверим|проверю|помогу|поможем|передам.{0,50}провер|help you|check (?:the|your)',m['text'],re.I)
             and not re.search(r'не (?:проверю|помогу)|will not help|won.t help',m['text'],re.I)]
    distress=[m['message_id'] for m in client if re.search(r'переживаю|боюсь|страшно|неудобно|идиот|не объяснили|раздраж|злюсь|недовол|worr|afraid|frustrat|angry|қорқ',m['text'],re.I)]
    neutral_help=[m['message_id'] for m in own if '→' in m['text'] or re.search(r'передаю|соединю|помогу.{0,20}связаться|подготовлю подключение|оператор.{0,20}подключ',m['text'],re.I)]
    courteous=[m['message_id'] for m in own if re.search(r'здравствуйте|добрый день|сәлеметсіз|hello|\bhi\b|пожалуйста',m['text'],re.I)]
    suspect=any(re.search(r'вообще|элементарно|сами разбира|опять вы|не умеете|очевидно же',m['text'],re.I) for m in own)
    if not hostile and not (acknowledgement and helpful):
        if not distress and courteous and neutral_help and not suspect:
            return common('На нейтральный/практический запрос дан вежливый полезный следующий шаг; ритуальное извинение не требуется.',
                respect_evidence_ids=courteous,disrespect_ids=[],customer_context='practical_difficulty',customer_context_ids=[],
                response_evidence_ids=neutral_help,acknowledgement_ids=[],dismissal_ids=[])
        return None
    return common('Неуважительные реплики: '+(', '.join(hostile) or 'не обнаружены')+'. Признание конкретного переживания: '
                  +(', '.join(acknowledgement) or 'не обнаружено')+'. Предложение помощи: '+(', '.join(helpful) or 'не обнаружено')+'.',
                  respect_evidence_ids=acknowledgement,disrespect_ids=hostile,
                  customer_context='distress_or_anger' if distress else 'practical_difficulty',customer_context_ids=distress,
                  response_evidence_ids=helpful,acknowledgement_ids=acknowledgement,dismissal_ids=hostile)

def management(conversation,role):
    own=[m for m in conversation['transcript'] if m['speaker']==role]
    clients=[m for m in conversation['transcript'] if m['speaker']=='client' and m['index']>own[0]['index']]
    confusion=[m['message_id'] for m in clients if re.search(r'что такое|что значит|не понимаю|нет,.{0,20}(?:мне нужен|я просил)|what is|what does|do not understand',m['text'],re.I)
               or re.search(r'\b(?:do not know|don.t know) [A-Z]{2,}\b',m['text'])]
    discovered=needs(conversation,role)
    redundant=discovered.get('repeated_known_question_ids',[]) if discovered else []
    close=closing(conversation,role)
    if close and close['unanswered_followup_ids']:
        reminders=[m['message_id'] for m in clients if re.search(r'не объяснили|не ответили|я уже (?:писал|написал|говорил)|already told|did not answer',m['text'],re.I)]
        if reminders:confusion=list(dict.fromkeys(confusion+reminders+close['unanswered_followup_ids']))
    contradictory=[m['message_id'] for m in own if re.search(r'есть и (?:его|е[её]|их) нет|ничего не делайте и одновременно',m['text'],re.I)]
    if not confusion and not contradictory and len(redundant)<2:
        from datetime import datetime
        def seconds(text):
            try:
                if 'T' in text:return datetime.fromisoformat(text).timestamp()
                parts=[float(p) for p in text.split(':')]
                return sum(p*60**i for i,p in enumerate(reversed(parts))) if len(parts) in {2,3} else None
            except ValueError:return None
        number_words={'одной':1,'один':1,'двух':2,'два':2,'тр[её]х':3,'три':3,'пяти':5,'пять':5,'девяти':9,'девять':9,'бес':5}
        for warning in own:
            duration=re.search(r'(\d+)\s*(?:минут|minutes)',warning['text'],re.I)
            minutes=int(duration.group(1)) if duration else next((n for word,n in number_words.items() if re.search(r'\b'+word+r'\s+минут',warning['text'],re.I)),None)
            agreed=[m for m in clients if m['index']>warning['index'] and re.search(r'да,? подожду|иә,? күтемін|yes.{0,15}wait|хорошо,? подожду',m['text'],re.I)]
            finish=own[-1]
            started=seconds(warning['timestamp']);ended=seconds(finish['timestamp'])
            prior_times=[seconds(m['timestamp']) for m in conversation['transcript'] if m['index']<=warning['index']]
            prior_paced=all(t is not None for t in prior_times) and all(b-a<=60 for a,b in zip(prior_times,prior_times[1:]))
            complaint=any(re.search(r'молчите|сколько ждать|жду.{0,20}минут|долго|waiting.{0,15}long',m['text'],re.I) for m in clients)
            if minutes and agreed and not complaint and prior_paced and finish['index']>agreed[0]['index'] and started is not None and ended is not None and 0<=ended-started<=minutes*60+30:
                return common('Предупреждение об ожидании, согласие клиента и ответ в пределах названного времени подтверждены репликами.',
                    flow='clear',actor_evidence_ids=[warning['message_id'],finish['message_id']],client_confusion_ids=[],waiting='warned',
                    waiting_evidence_ids=[warning['message_id'],agreed[0]['message_id']],redundant_question_ids=[])
        route=consultation(conversation,role)
        calm=not any(re.search(r'непонят|не понимаю|не работает|не получается|не ответ|не объяс|жду|молчите|долго|do not understand|not work|waiting',m['text'],re.I) for m in clients)
        if route and all(p['outcome'] in {'resolved','actionable_next_step'} for p in route['request_parts']) and calm:
            times=[seconds(m['timestamp']) for m in conversation['transcript']]
            # This is a conservative positive shortcut, not a service-time penalty threshold.
            tightly_paced=all(t is not None for t in times) and all(b-a<=60 for a,b in zip(times,times[1:]))
            if tightly_paced:
                return common('Короткий связный навигационный обмен: конкретный маршрут, без переспросов, жалоб на ожидание и незакрытых запросов.',
                    flow='clear',actor_evidence_ids=[own[0]['message_id'],own[-1]['message_id']],client_confusion_ids=[],
                    waiting='none',waiting_evidence_ids=[],redundant_question_ids=[])
        return None
    return common('Запросы пояснить или повторно ответить: '+(', '.join(confusion) or 'нет')+'. Повтор известных вопросов: '+(', '.join(redundant) or 'нет')+'. Противоречия: '+(', '.join(contradictory) or 'нет')+'.',
                  flow='incoherent' if contradictory else 'repeated_confusion' if len(confusion)>=2 or len(redundant)>=2 else 'one_issue',
                  actor_evidence_ids=contradictory or [own[0]['message_id']],client_confusion_ids=confusion,
                  waiting='none',waiting_evidence_ids=[],redundant_question_ids=redundant)

def gross(conversation,role):
    own=[m for m in conversation['transcript'] if m['speaker']==role]
    insults=[];paid=[]
    for m in own:
        text=m['text']
        if re.search(r'(?:вы|ты).{0,8}(?:идиот|тупой|тупая|безмозгл)|you.{0,8}(?:idiot|stupid)',text,re.I):
            if re.search(r'сказал|назвал|цитат|цитирую|например|for example|called you',text,re.I):return None
            insults.append(m['message_id'])
        self_payment=re.search(r'лично мне|мне лично|ма[ғг]ан жеке|pay me personally',text,re.I)
        private_service=re.search(r'частн|мимо компании|в обход|компаниядан тыс|жеке қызмет|private service',text,re.I)
        if self_payment and private_service:paid.append(m['message_id'])
    events,_=protected_claims(conversation,role)
    confirmed=[m for m in conversation['transcript'] if m['speaker']=='system' and verified_phrase(m['text'])]
    disclosed=[e['message_id'] for e in events if e['kind']=='account_disclosure' and not any(c['index']<next(m['index'] for m in own if m['message_id']==e['message_id']) for c in confirmed)]
    if not (insults or paid or disclosed):return None
    return common('Подтверждённые нарушения проверяемого: '+', '.join(insults+paid+disclosed)+'.',
                  insult_ids=insults,off_company_paid_ids=paid,confidential_disclosure_ids=disclosed,
                  verification_confirmation_ids=[m['message_id'] for m in confirmed])


def extract(criterion_id,conversation,role):
    function={'01':contact,'02':needs,'03':safety,'04':consultation,'05':empathy,'06':management,'07':closing,'08':gross}.get(criterion_id)
    return function(conversation,role) if function else None
