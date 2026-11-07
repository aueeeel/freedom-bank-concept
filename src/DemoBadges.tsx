import * as React from 'react';
import {TeamLanyardRail, type LanyardMember} from './TeamLanyardRail';

const PORTRAITS='assets/team-portraits.png';
const MEMBERS: LanyardMember[]=[
  {id:'demo-01',name:'Алия Садыкова',role:'Поддержка клиентов',team:'Freedom · Service',image:PORTRAITS,portraitIndex:0,tone:1,drop:8,bio:'Помогаю разобраться в деталях и найти простое решение. Верю, что хороший сервис начинается с внимания.',tags:['Забота','Диалог','Поддержка']},
  {id:'demo-02',name:'Данияр Омаров',role:'Цифровые продукты',team:'Freedom · Product',image:PORTRAITS,portraitIndex:1,tone:2,drop:22,bio:'Превращаю идеи в понятные цифровые продукты. Ищу решения, которые делают повседневные дела удобнее.',tags:['Продукт','Идеи','Развитие']},
  {id:'demo-03',name:'Амина Нурлан',role:'Дизайн сервиса',team:'Freedom · Design',image:PORTRAITS,portraitIndex:2,tone:3,drop:2,bio:'Создаю интерфейсы, в которых легко ориентироваться. Люблю ясность, аккуратные детали и живые истории.',tags:['Дизайн','Опыт','Детали']},
  {id:'demo-04',name:'Тимур Асанов',role:'Безопасность',team:'Freedom · Technology',image:PORTRAITS,portraitIndex:3,tone:4,drop:16,bio:'Думаю о надёжности на каждом шаге. Считаю, что забота о людях начинается с внимания к их данным.',tags:['Технологии','Надёжность','Команда']},
];
const LABELS={flip:'Нажмите или используйте Enter, чтобы перевернуть бейдж',back:'Нажмите ещё раз или Esc, чтобы вернуть портрет',show:'Показать сотрудника'};

export function DemoBadges(){
  return <>
    <div className="team-intro">
      <h1 className="team-title">Люди, которые <span>рядом.</span></h1>
      <p className="team-lead">Разные характеры. Общая идея — делать каждый день свободнее.</p>
    </div>
    <TeamLanyardRail className="team-lanyard" items={MEMBERS} labels={LABELS} caption="Потяните за бейдж — познакомимся ближе." autoplay={false} />
    <div className="team-page-bottom"><p>Демонстрационная команда: имена и портреты вымышлены.</p><a className="button button-secondary" href="/">Вернуться к карте</a></div>
  </>;
}
