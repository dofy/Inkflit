// One list palette for note search and the command panel: the same markup,
// keyboard handling and open/close behaviour, with only the rows differing.
// Expects #<id>-panel, #<id>-input and #<id>-results in the page, plus an
// optional #<id>-crumb that names the open second level.
//
// An item with `children` opens a second level instead of being chosen;
// `rows(query, parent)` receives that item while the level is open. Escape,
// or Backspace in an empty field, returns to the first level with the same
// query and row still selected. A level opens on its row marked `current`.
export function createPalette({id, rows, renderRow, empty, choose, closed, levelChanged}) {
  const panel=document.getElementById(`${id}-panel`), input=document.getElementById(`${id}-input`), list=document.getElementById(`${id}-results`);
  const crumb=document.getElementById(`${id}-crumb`);
  let items=[], index=0, parent=null, saved=null;
  const setParent=(item, query='', position=null)=>{
    parent=item;input.value=query;
    if(crumb) { crumb.hidden=!parent;crumb.textContent=parent?.label ?? ''; }
    levelChanged?.(parent);
    items=rows(query,parent);
    index=position ?? Math.max(0,items.findIndex(row=>row.current));
    palette.render();input.focus();
  };
  const enter=item=>{ saved={query:input.value,index};setParent(item); };
  const back=()=>{ const previous=saved;saved=null;setParent(null,previous?.query ?? '',previous?.index ?? 0); };
  const palette={
    get open() { return !panel.hidden; },
    get items() { return items; },
    get parent() { return parent; },
    render() {
      items=rows(input.value,parent);
      index=Math.min(index,Math.max(0,items.length-1));
      list.replaceChildren();
      if(!items.length) {
        const message=document.createElement('div');message.className='palette-empty';message.textContent=empty(input.value,parent);
        list.append(message);input.removeAttribute('aria-activedescendant');return;
      }
      items.forEach((item,position)=>{
        const row=document.createElement('button');
        row.type='button';row.id=`${id}-option-${position}`;row.className='palette-row';
        row.setAttribute('role','option');row.setAttribute('aria-selected',String(position===index));
        renderRow(row,item);
        row.addEventListener('mousedown',event=>event.preventDefault());
        row.addEventListener('click',()=>palette.choose(position));
        list.append(row);
      });
      input.setAttribute('aria-activedescendant',`${id}-option-${index}`);
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});
    },
    show(query='') { panel.hidden=false;saved=null;setParent(null,query); },
    close() { if(panel.hidden)return;panel.hidden=true;closed?.(); },
    choose(position=index) {
      const item=items[position];if(!item)return;
      if(item.children) { enter(item);return; }
      palette.close();choose(item);
    },
    // Handles the palette's own keys; returns true when the key was used.
    handleKey(event) {
      if(event.metaKey || event.ctrlKey || event.altKey)return false;
      if(event.key==='Escape') { if(parent)back();else palette.close();return true; }
      if(event.key==='Backspace' && parent && !input.value) { back();return true; }
      if(event.key==='ArrowDown' || event.key==='ArrowUp') {
        if(items.length) { index=(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;palette.render(); }
        return true;
      }
      if(event.key==='Enter') { if(!event.repeat)palette.choose();return true; }
      return false;
    }
  };
  input.addEventListener('input',()=>{index=0;palette.render();});
  panel.addEventListener('mousedown',event=>{if(event.target===panel)palette.close();});
  return palette;
}
