#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
qa_dir=$(mktemp -d /tmp/inkflit-auto.XXXXXX)
qa_app="$qa_dir/Test.app"
ditto build/Inkflit.app "$qa_app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.seven.inkflit.auto.$(basename "$qa_dir" | tr -cd '[:alnum:]')" "$qa_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/DefaultsMigration.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift tests/NativeCodeEditingTest.swift -o "$qa_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$qa_app"
python3 - "$qa_app/Contents/MacOS/Inkflit" "$qa_dir" <<'PY'
import os, sys, json, time, tempfile, subprocess, select, base64, pathlib, signal
binary, root = sys.argv[1:]
root=pathlib.Path(root); store=root/'store'
for name in ('notes','backups','trash'): (store/name).mkdir(parents=True,exist_ok=True)
def filename(id): return base64.urlsafe_b64encode(id.encode()).decode().rstrip('=')+'.md'
notes=[{'id':'first','content':'Alpha 中文','updated':'1'},{'id':'second','content':'Beta note','updated':'2'}]
for n in notes:(store/'notes'/filename(n['id'])).write_text(n['content'])
(store/'index.json').write_text(json.dumps({'version':1,'notes':[{'id':n['id'],'updated':n['updated']} for n in notes],'selected':'first'}))
socket=str(root/'bridge.sock');env=os.environ.copy();env.update(QUICKNOTE_ISOLATED_TEST='1',INKFLIT_AUTOMATION_TEST='1',INKFLIT_FILE_STORAGE_TEST='1',QUICKNOTE_DATA_PATH=str(store/'index.json'),INKFLIT_SOCKET_PATH=socket,INKFLIT_AUTOMATION_EDIT_TEST='1',INKFLIT_EDIT_READY_PATH=str(root/'editing-ready'),INKFLIT_HIDDEN_READY_PATH=str(root/'hidden-ready'))
app=subprocess.Popen([binary],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
mcp=None
try:
 for _ in range(100):
  if os.path.exists(socket): break
  if app.poll() is not None: raise RuntimeError('test application exited: '+app.stderr.read().decode(errors='replace'))
  time.sleep(.1)
 else: raise RuntimeError('automation socket did not start')
 assert os.stat(socket).st_mode & 0o777 == 0o600
 for _ in range(400):
  if (root/'editing-ready').exists(): break
  if app.poll() is not None: raise RuntimeError('editor test exited: '+app.stderr.read().decode(errors='replace'))
  time.sleep(.025)
 else: raise RuntimeError('editor did not enter the test state')
 assert (store/'notes'/filename('first')).read_text()=='Alpha 中文', 'edit should still be pending before MCP request'
 mcp=subprocess.Popen([binary,'--mcp'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 ident=0
 def request(method,params=None):
  global ident
  ident+=1; value={'jsonrpc':'2.0','id':ident,'method':method}
  if params is not None:value['params']=params
  mcp.stdin.write(json.dumps(value,ensure_ascii=False)+'\n');mcp.stdin.flush()
  if not select.select([mcp.stdout],[],[],10)[0]:raise RuntimeError('MCP request timed out: '+method)
  response=json.loads(mcp.stdout.readline());assert response.get('id')==ident,response
  assert 'error' not in response,response
  return response['result']
 def call(name, args={}, error=False):
  result=request('tools/call',{'name':name,'arguments':args})
  assert bool(result.get('isError'))==error,result
  return json.loads(result['content'][0]['text'])
 init=request('initialize',{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'test','version':'1'}})
 assert init['protocolVersion']=='2025-11-25'
 tools=request('tools/list')['tools'];assert {t['name'] for t in tools}=={'list_notes','get_note','search_notes','create_note','append_note','replace_note','delete_note'}
 assert call('append_note',{'id':'first','content':'Agent addition'})['result']['note']['content']=='xAlpha 中文\nAgent addition'
 assert (store/'notes'/filename('first')).read_text()=='xAlpha 中文\nAgent addition'
 for _ in range(200):
  if (root/'hidden-ready').exists(): break
  if app.poll() is not None: raise RuntimeError('editor test exited while hiding')
  time.sleep(.025)
 else: raise RuntimeError('application did not hide')
 sdk=os.environ.get('INKFLIT_QA_MCP_SDK')
 if sdk:
  program="""
    import {pathToFileURL} from 'node:url';
    const base=process.argv[1],binary=process.argv[2];
    const {Client}=await import(pathToFileURL(base+'/dist/esm/client/index.js'));
    const {StdioClientTransport}=await import(pathToFileURL(base+'/dist/esm/client/stdio.js'));
    const client=new Client({name:'inkflit-qa',version:'1'});
    await client.connect(new StdioClientTransport({command:binary,args:['--mcp'],env:process.env}));
    const {tools}=await client.listTools();
    if(!tools.some(t=>t.name==='append_note'))throw Error('MCP SDK did not discover append_note');
    const result=await client.callTool({name:'get_note',arguments:{id:'first'}});
    if(result.isError || !JSON.parse(result.content[0].text).result.note.content.includes('Agent addition'))throw Error('MCP SDK did not read note');
    await client.close();
    console.log('PASS official MCP SDK client discovery and call');
  """
  sdk_result=subprocess.run(['node','--input-type=module','-e',program,sdk,binary],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
  assert sdk_result.returncode==0,sdk_result.stderr
  print(sdk_result.stdout.strip())
 assert [x['content'] for x in call('list_notes')['result']['notes']]==['xAlpha 中文\nAgent addition','Beta note']
 assert call('search_notes',{'query':'中文'})['result']['results'][0]['id']=='first'
 assert call('get_note',{'index':2})['result']['note']['content']=='Beta note'
 assert call('append_note',{'index':2,'content':'New line'})['result']['note']['content']=='Beta note\nNew line'
 assert (store/'notes'/filename('second')).read_text()=='Beta note\nNew line'
 assert call('replace_note',{'id':'second','content':'Replacement'})['result']['note']['content']=='Replacement'
 assert any(p.read_text()=='Beta note' for p in (store/'backups'/filename('second')[:-3]).glob('*.md'))
 # Independent MCP processes write concurrently; the app must serialize them.
 import concurrent.futures
 def parallel_append(i):
  requests=[{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'parallel','version':'1'}}},
            {'jsonrpc':'2.0','method':'notifications/initialized'},
            {'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'append_note','arguments':{'id':'second','content':f'parallel-{i}'}}}]
  proc=subprocess.run([binary,'--mcp'],env=env,input=''.join(json.dumps(r)+'\n' for r in requests),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
  assert proc.returncode==0,proc.stderr
  replies=[json.loads(line) for line in proc.stdout.splitlines()]
  assert not replies[-1]['result'].get('isError'),replies
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: list(pool.map(parallel_append,range(6)))
 parallel=(store/'notes'/filename('second')).read_text().splitlines()
 assert parallel[0]=='Replacement' and set(parallel[1:])=={f'parallel-{i}' for i in range(6)} and len(parallel)==7,parallel
 made=call('append_note',{'content':'Created by append'})['result']['note']; assert made['index']==1
 made2=call('replace_note',{'content':'Created by replace'})['result']['note']; assert made2['index']==1
 made3=call('create_note',{'content':'Explicit creation'})['result']['note'];assert made3['index']==1
 count=len(call('list_notes')['result']['notes'])
 tail=call('create_note',{'content':'Tail','position':'last'})['result']['note'];assert tail['index']==count+1
 middle=call('create_note',{'content':'Middle','position':2})['result']['note'];assert middle['index']==2
 head=call('create_note',{'content':'Head','position':'first'})['result']['note'];assert head['index']==1
 before=call('list_notes')['result']['notes'];assert 'error' in call('create_note',{'content':'bad','position':999},error=True);assert 'error' in call('create_note',{'content':'bad','position':'middle'},error=True);assert call('list_notes')['result']['notes']==before
 assert call('delete_note',{'id':made['id']})['result']['deleted']==made['id']
 assert any(p.read_text()=='Created by append' for p in (store/'trash'/filename(made['id'])[:-3]).glob('*.md'))
 assert 'error' in call('get_note',{'index':999},error=True)
 assert 'error' in call('delete_note',{},error=True)
 assert 'error' in call('append_note',{'id':'first','index':1,'content':'bad'},error=True)
 external=store/'notes'/filename('first'); external.write_text('external change')
 assert 'error' in call('append_note',{'id':'first','content':'must not overwrite'},error=True)
 assert external.read_text()=='external change'
 assert call('get_note',{'id':'first'})['result']['note']['content']=='xAlpha 中文\nAgent addition'
 print('PASS MCP handshake, pending edits, hidden window, concurrent requests, search, create, append, replace, delete, backups, trash and conflict protection')
finally:
 if mcp:
  mcp.stdin.close()
  try:mcp.wait(timeout=3)
  except subprocess.TimeoutExpired:mcp.terminate();mcp.wait(timeout=3)
 app.terminate()
 try:app.wait(timeout=5)
 except subprocess.TimeoutExpired:app.kill();app.wait(timeout=3)
PY

# Exercise the editor search and URL handler in fresh isolated stores.
python3 - "$qa_app/Contents/MacOS/Inkflit" "$qa_dir" <<'PY2'
import os,sys,json,base64,pathlib,subprocess
binary,root=sys.argv[1:];root=pathlib.Path(root)
for appearance,language in [('light','en'),('dark','zh-Hant')]:
 store=root/('ui-'+appearance)
 for name in ('notes','backups','trash'): (store/name).mkdir(parents=True,exist_ok=True)
 notes=[{'id':'first','content':'Alpha 中文','updated':'1'},{'id':'second','content':'Beta note','updated':'2'}]
 for note in notes:
  filename=base64.urlsafe_b64encode(note['id'].encode()).decode().rstrip('=')+'.md'
  (store/'notes'/filename).write_text(note['content'])
 (store/'index.json').write_text(json.dumps({'version':1,'notes':[{'id':n['id'],'updated':n['updated']} for n in notes],'selected':'first'}))
 env=os.environ.copy();env.update(QUICKNOTE_ISOLATED_TEST='1',INKFLIT_AUTOMATION_TEST='1',INKFLIT_AUTOMATION_UI_TEST='1',INKFLIT_TEST_APPEARANCE=appearance,INKFLIT_TEST_UI_LANGUAGE=language,INKFLIT_SEARCH_CAPTURE=str(root/('search-'+appearance+'.png')),INKFLIT_FILE_STORAGE_TEST='1',QUICKNOTE_DATA_PATH=str(store/'index.json'),INKFLIT_SOCKET_PATH=str(root/('ui-'+appearance+'.sock')))
 try: result=subprocess.run([binary],env=env,timeout=20)
 except subprocess.TimeoutExpired: sys.exit('FAIL: native search and scheme test timed out')
 if result.returncode:sys.exit(result.returncode)
 print('PASS native search and scheme:',appearance,language)
print('Search snapshots:',root)
PY2
