/* SegmentedControl adapted from Klyv UI, © 2026 Klyv contributors.
 * MIT license: assets/segmented-control-license.txt.
 * Standalone HTML/JS version of the supplied React radiogroup component.
 */
(() => {
  'use strict';
  const groups=[...document.querySelectorAll('.segmented-control[role="radiogroup"]')];
  const allOptions=groups.flatMap(group=>[...group.querySelectorAll('.segment[role="radio"]')]);
  function select(value) {
    allOptions.forEach(option=>{
      const selected=option.dataset.panel===value&&!option.disabled&&!option.hidden;
      option.setAttribute('aria-checked',String(selected));
      option.tabIndex=selected?0:-1;
    });
  }
  groups.forEach(group=>{
    const options=[...group.querySelectorAll('.segment[role="radio"]')];
    group.addEventListener('click',event=>{
      const option=event.target.closest('.segment[role="radio"]');
      if(option&&!option.disabled&&!option.hidden)select(option.dataset.panel);
    });
    group.addEventListener('keydown',event=>{
      const vertical=group.getAttribute('aria-orientation')==='vertical';
      const forward=vertical?'ArrowDown':'ArrowRight';
      const back=vertical?'ArrowUp':'ArrowLeft';
      if(![forward,back,'Home','End'].includes(event.key))return;
      const index=options.indexOf(event.target.closest('.segment[role="radio"]'));
      if(index<0)return;
      event.preventDefault();
      const enabled=options.filter(option=>!option.disabled&&!option.hidden);
      if(!enabled.length)return;
      let next;
      if(event.key==='Home')next=enabled[0];
      else if(event.key==='End')next=enabled[enabled.length-1];
      else{
        const step=event.key===forward?1:-1;
        for(let offset=1;offset<=options.length;offset++){
          const candidate=options[(index+step*offset+options.length*offset)%options.length];
          if(!candidate.disabled&&!candidate.hidden){next=candidate;break;}
        }
      }
      if(next){select(next.dataset.panel);next.focus();}
    });
  });
})();
