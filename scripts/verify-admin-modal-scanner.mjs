import assert from 'node:assert/strict';
import ts from 'typescript';
import { scanAdminModals, scanLifecycleReferences, classifyModalEntries } from './admin-modal-scanner.mjs';
const file = `${process.cwd()}/packages/portal-mojo/src/admin/__modal_fixture.tsx`;
const relative = file.replace(process.cwd() + '/', '');
const preamble = `import { modal as dialogs, DetailView as D, formModal as form } from '../ui';`;
function scan(text, reviewed = []) {
    const options = { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ESNext };
    const host = ts.createCompilerHost(options); const get = host.getSourceFile.bind(host);
    host.getSourceFile = (name, ...args) => name === file ? ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) : get(name, ...args);
    host.fileExists = (original => name => name === file || original(name))(host.fileExists.bind(host));
    const program = ts.createProgram([file], options, host);
    return { ...scanAdminModals(program, new Set([relative]), reviewed), lifecycle: scanLifecycleReferences(program, [program.getSourceFile(file)]) };
}
const fixture = scan(`${preamble} const columns = [{key:'action', label:'Action', render:()=>null}]; const sections=[{key:'overview',label:'Overview',render:()=>null}]; function child(){return dialogs.open<string>(close => <Editor/>)} function parent(){return child()} function Demo(){return <D title="Example" sections={[...sections, ...(true ? [{key:'x',label:'Other',render:()=>null}] : [])]} />}`);
assert.equal(fixture.unresolved.length, 0);
assert.equal(fixture.sections.length, 2, 'Unrelated Action table column must not be interpreted as a detail section');
assert(fixture.entries.some(entry => entry.launcher === 'child'), 'Named helper forwarding must be linked');
assert(fixture.entries.some(entry => entry.launcher === 'modal.open'), 'Generic imported alias must resolve');
for (const text of [
 `${preamble} const show=dialogs.open; factory(show);`,
 `${preamble} dialogs[unknown](x);`,
 `${preamble} const sections = makeSections(); function Demo(){return <D sections={sections}/>}`,
 `${preamble} let sections=[]; sections[0]={key:'delete',label:'Delete',render:()=>null}; function Demo(){return <D sections={sections}/>}`,
 `${preamble} let sections=[]; sections=makeSections(); function Demo(){return <D sections={sections}/>}`,
 `${preamble} const sections=[]; factory(sections); function Demo(){return <D sections={sections}/>}`,
 `${preamble} const sections=[]; const row=sections[0]; function Demo(){return <D sections={sections}/>}`,
]) assert(scan(text).unresolved.length > 0, `Unknown syntax must fail classification: ${text}`);
const namespace = scan(`import * as ui from '../ui'; function Demo(){return <ui.DetailView sections={[{key:'overview',label:'Overview',render:()=>null}]}/>} const {open: show}=ui.modal; show<string>(close=><Body/>);`);
assert(namespace.entries.some(entry => entry.launcher === 'DetailView'));
assert(namespace.entries.some(entry => entry.launcher === 'modal.open'));
assert.deepEqual(namespace.unresolved, []);
const unknownText=`${preamble} function Demo(){return <D sections={makeSections()}/>}`; const unknown=scan(unknownText).unresolved[0]; const mapping={...unknown,classification:'record',runtimeCase:'dynamic-sections-fixture',sections:[]}; assert.equal(scan(unknownText,[mapping]).unresolved.length,0); assert(scan(unknownText.replace('makeSections','changedSections'),[mapping]).unresolved.some(item=>item.reason==='stale reviewed mapping'));
console.log('Admin modal scanner fixtures passed: aliases/generics/namespaces/destructuring/forwarding, resolved sections, fail-closed unknown forms and stale reviewed mappings.');

const deletion=scan(`import { FileModel as Files } from './storage/models'; const records=Files; const erase=records['useDelete']; factory(erase);`); assert(deletion.lifecycle.some(item=>item.symbol==='FileModel.useDelete'),'Aliased/computed forbidden deletion references must remain visible across roots');
const semantic=scan(`${preamble} function editor(){return dialogs.open(close=><ConfigEditor/>)} function caller(){return editor()}`);
assert(classifyModalEntries(semantic.entries,[]).some(problem=>problem.includes('Unreviewed modal body')));
const direct=semantic.entries.find(entry=>entry.launcher==='modal.open'); assert.deepEqual(classifyModalEntries(semantic.entries,[{id:direct.id,fingerprint:direct.fingerprint,category:'editor',purpose:'Configuration editor'}]),[]); assert(semantic.entries.every(entry=>entry.category==='editor'),'Forwarders inherit reviewed editor classification');
