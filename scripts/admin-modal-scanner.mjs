import ts from 'typescript';
import { createHash } from 'node:crypto';

export const fingerprint = text => createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 20);
export const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
export function scanAdminModals(program, targetFiles, reviewed = []) {
    const checker = program.getTypeChecker();
    const entries = [], sections = [], unresolved = [];
    const usedMappings = new Set();
    const symbol = node => { let s = checker.getSymbolAtLocation(node); if (s?.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s); return s; };
    const declaration = node => symbol(node)?.valueDeclaration;
    const unwrap = node => { while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression; return node; };
    const ownerNode = node => { for (let p = node.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p) || ts.isArrowFunction(p) && ts.isVariableDeclaration(p.parent)) return ts.isArrowFunction(p) ? p.parent : p; return node.getSourceFile(); };
    const targetOf = node => { const d = declaration(node); return d?.name ? `${fileName(d)}:${d.name.getText()}` : null; };
    const owner = node => ownerNode(node).name?.getText() ?? '<module>';
    const fileName = node => node.getSourceFile().fileName.replace(process.cwd() + '/', '');
    const unclassified = (node, reason) => {
        const expression = node.getText(); const file = fileName(node); const hash = fingerprint(expression);
        const mapping = reviewed.find(m => m.file === file && m.fingerprint === hash && m.reason === reason);
        if (mapping?.classification && mapping?.runtimeCase && mapping?.expression === expression) { usedMappings.add(mapping); return mapping; }
        unresolved.push({ file, expression, fingerprint: hash, reason }); return null;
    };
    const wrappers = new Map();
    const targetSources = [...program.getSourceFiles()].filter(s => targetFiles.has(fileName(s)));
    function reference(node, seen = new Set()) {
        node = unwrap(node); if (!node || seen.has(node)) return null; seen.add(node);
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const base = reference(node.expression, seen);
            if (base === 'ui-namespace') { const name = ts.isPropertyAccessExpression(node) ? node.name.text : null; return ['modal', 'DetailView', 'formModal'].includes(name) ? name : null; }
            if (base === 'modal') {
                const name = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
                return name && ['open', 'detail', 'confirm', 'drawer'].includes(name) ? `modal.${name}` : null;
            }
        }
        if (ts.isIdentifier(node)) {
            if (checker.getSymbolAtLocation(node)?.declarations?.some(ts.isNamespaceImport)) return 'ui-namespace';
            const d = declaration(node);
            if (d && ts.isNamespaceImport(d)) return 'ui-namespace';
            if (d && /\/ui\/modal\.tsx$/.test(d.getSourceFile().fileName) && node.text === 'modal' || d && /\/ui\/modal\.tsx$/.test(d.getSourceFile().fileName) && d.name?.getText() === 'modal') return 'modal';
            if (d && /\/ui\/DetailView\.tsx$/.test(d.getSourceFile().fileName) && d.name?.getText() === 'DetailView') return 'DetailView';
            if (d && /\/ui\/FormFields\.tsx$/.test(d.getSourceFile().fileName) && d.name?.getText() === 'formModal') return 'formModal';
            if (wrappers.has(d)) return wrappers.get(d);
            if (d && ts.isVariableDeclaration(d) && d.initializer) return reference(d.initializer, seen);
            if (d && ts.isBindingElement(d) && ts.isObjectBindingPattern(d.parent) && ts.isVariableDeclaration(d.parent.parent)) {
                const base = reference(d.parent.parent.initializer, seen);
                const name = d.propertyName?.getText() ?? d.name.getText();
                if (base === 'modal' && ['open','detail','confirm','drawer'].includes(name)) return `modal.${name}`;
            }
        }
        return null;
    }
    for (let changed = true; changed;) {
        changed = false;
        for (const source of targetSources) walk(source, node => {
            if (!ts.isCallExpression(node) || !reference(node.expression)) return;
            const outer = ownerNode(node); const name = outer.name?.getText();
            if (name && !/^[A-Z]/.test(name) && !wrappers.has(outer)) { wrappers.set(outer, name); changed = true; }
        });
    }
    function resolveSections(node, seen = new Set()) {
        node = unwrap(node); if (!node) return []; if (seen.has(node)) { unclassified(node, 'cyclic section expression'); return []; } seen = new Set(seen).add(node);
        if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(e => resolveSections(ts.isSpreadElement(e) ? e.expression : e, seen));
        if (ts.isConditionalExpression(node)) return [...resolveSections(node.whenTrue, seen), ...resolveSections(node.whenFalse, seen)];
        if (ts.isObjectLiteralExpression(node)) {
            const props = new Map(); for (const p of node.properties) {
                if (ts.isSpreadAssignment(p)) { unclassified(p, 'section object spread'); continue; }
                if (ts.isPropertyAssignment(p)) props.set(p.name.getText().replace(/['"]/g, ''), p.initializer);
            }
            if (props.has('divider')) return [];
            if (!props.has('render') || !props.has('key') || !props.has('label')) { unclassified(node, 'incomplete section object'); return []; }
            const label = props.get('label'); if (!ts.isStringLiteral(label)) unclassified(label, 'dynamic section label');
            return [{ file: fileName(node), owner: owner(node), key: props.get('key').getText(), label: ts.isStringLiteral(label) ? label.text : label.getText(), fingerprint: fingerprint(node.getText()) }];
        }
        if (ts.isIdentifier(node)) {
            const d = declaration(node);
            if (d && ts.isVariableDeclaration(d) && d.initializer) {
                const initial = resolveSections(d.initializer, seen); const scope = ownerNode(d);
                walk(scope, child => {
                    if (ts.isBinaryExpression(child) && child.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && child.operatorToken.kind <= ts.SyntaxKind.LastAssignment) { let target = child.left; while (ts.isElementAccessExpression(target) || ts.isPropertyAccessExpression(target)) target = target.expression; if (symbol(target) === symbol(node)) unclassified(child, 'section assignment'); }
                    if ((ts.isElementAccessExpression(child) || ts.isPropertyAccessExpression(child)) && symbol(child.expression) === symbol(node) && !ts.isCallExpression(child.parent) && !ts.isBinaryExpression(child.parent)) unclassified(child, 'section property access');
                    if (ts.isIdentifier(child) && child !== d.name && symbol(child) === symbol(node) && ts.isCallExpression(child.parent) && child.parent.arguments.includes(child)) unclassified(child, 'section forwarding');
                    if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && symbol(child.expression.expression) === symbol(node)) {
                        if (child.expression.name.text === 'push') initial.push(...child.arguments.flatMap(a => resolveSections(a, seen)));
                        else unclassified(child, 'section mutation');
                    }
                });
                return initial;
            }
        }
        const mapping = unclassified(node, 'section expression');
        return mapping?.sections ?? [];
    }
    for (const source of targetSources) {
        const counts = new Map(); const handledReferences = new Set();
        walk(source, node => {
            const call = ts.isCallExpression(node) ? reference(node.expression) : null;
            const jsx = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
            const tag = jsx ? reference(node.tagName) ?? node.tagName.getText() : null;
            const dynamicImport = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
            const kind = call && call !== 'modal' && call !== 'DetailView' ? call : tag === 'DetailView' || tag === 'dialog' ? tag : dynamicImport ? 'import' : null;
            if (kind) {
                if (call) handledReferences.add(node.expression);
                if (jsx) handledReferences.add(node.tagName);
                const key = `${fileName(source)}:${owner(node)}:${kind}`; const ordinal = counts.get(key) ?? 0; counts.set(key, ordinal + 1);
                const body = new Set(); walk(node, child => { if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) body.add(child.tagName.getText()); });
                entries.push({ id: `${key}:${ordinal}`, file: fileName(source), owner: owner(node), launcher: kind, body: [...body], category: ['DetailView','modal.detail'].includes(kind) ? 'record' : kind === 'modal.confirm' ? 'confirmation' : kind === 'formModal' ? 'editor' : dynamicImport ? 'dependency' : 'action', parent: owner(node), target: call && !call.startsWith('modal.') && call !== 'formModal' ? targetOf(node.expression) : null, fingerprint: fingerprint(node.getText()) });
                if (dynamicImport && !ts.isStringLiteral(node.arguments[0])) unclassified(node, 'dynamic import path');
                if (tag === 'DetailView') {
                    const attr = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.text === 'sections');
                    if (attr?.initializer && ts.isJsxExpression(attr.initializer)) sections.push(...resolveSections(attr.initializer.expression)); else unclassified(node, 'missing explicit DetailView sections');
                }
            }
        });
        // Known imports may only occur in the finite reference forms above.
        // Passing one into an arbitrary factory must be explicitly mapped.
        walk(source, node => {
            if (!ts.isIdentifier(node) || !reference(node)) return;
            const p = node.parent;
            if (ts.isImportSpecifier(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p) || ts.isJsxClosingElement(p) || ts.isJsxClosingElement(p.parent) || handledReferences.has(node)) return;
            if (handledReferences.has(p) || ts.isBindingElement(p) && p.name === node || ts.isPropertyAccessExpression(p) && p.name === node) return;
            if (ts.isCallExpression(p) && p.expression === node) return;
            if (ts.isFunctionDeclaration(p) && p.name === node || ts.isVariableDeclaration(p) && p.name === node) return;
            if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === node) {
                if (reference(p) && (ts.isCallExpression(p.parent) || ts.isVariableDeclaration(p.parent) || handledReferences.has(p) || ts.isPropertyAccessExpression(p.parent) && reference(p.parent))) return;
                unclassified(p, 'unclassified modal member'); return;
            }
            if (ts.isVariableDeclaration(p) && p.initializer === node) return;
            let context = p; while (ts.isConditionalExpression(context) || ts.isParenthesizedExpression(context) || ts.isBinaryExpression(context)) context = context.parent;
            const handler = ts.isJsxExpression(context) && ts.isJsxAttribute(context.parent) ? context.parent.name.getText() : ts.isPropertyAssignment(context) ? context.name.getText() : null;
            if (handler && (/^on[A-Z]/.test(handler) || ['renderAddon','renderActions','openGroup'].includes(handler))) {
                const key = `${fileName(source)}:${owner(node)}:handler`; const ordinal = counts.get(key) ?? 0; counts.set(key, ordinal + 1);
                entries.push({ id: `${key}:${ordinal}`, file: fileName(source), owner: owner(node), launcher: reference(node), body: [node.text], category: 'handler', parent: handler, target: targetOf(node), fingerprint: fingerprint(context.getText()) }); return;
            }
            unclassified(node, 'unclassified modal reference');
        });
    }
    for (const mapping of reviewed) if (!usedMappings.has(mapping)) unresolved.push({ file: mapping.file, reason: 'stale reviewed mapping', fingerprint: mapping.fingerprint });
    return { entries, sections, unresolved };
}

// A finite symbol audit, independent of filenames and imported local names.
// Low-level exported delete APIs remain public; any UI reference is reviewed.
export function scanLifecycleReferences(program, sources) {
    const checker = program.getTypeChecker(); const references = [];
    const helpers = new Set(['deleteShortlink','deleteFileShare','deleteMessagingRow','deleteAssistantConversation','deleteAssistantSkill','deleteAssistantMemory','deleteDnsRecordSet','emptyBucket','purgeJobs','cleanupConsumers']);
    const original = (node, seen = new Set()) => {
        if (!node || seen.has(node)) return null; seen.add(node);
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return original(node.expression,seen);
        let symbol = checker.getSymbolAtLocation(node); if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        const d = symbol?.valueDeclaration;
        if (d && ts.isVariableDeclaration(d) && d.initializer && ts.isIdentifier(d.initializer)) return original(d.initializer,seen);
        return symbol?.name ?? null;
    };
    for (const source of sources) walk(source,node=>{
        let name;
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'useDelete' || ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'useDelete') name = `${original(node.expression)}.useDelete`;
        else if (ts.isIdentifier(node) && helpers.has(original(node))) {
            const p=node.parent;
            if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isFunctionDeclaration(p) && p.name===node || ts.isVariableDeclaration(p) && p.name===node) return;
            name=original(node);
        }
        if (name) { let context=node; while(context.parent && !ts.isFunctionDeclaration(context) && !ts.isArrowFunction(context))context=context.parent; references.push({file:source.fileName.replace(process.cwd()+'/',''), symbol:name, expression:node.getText(), fingerprint:fingerprint(context.getText())}); }
    });
    return references;
}

export function classifyModalEntries(entries, reviews) {
    const byOwner = new Map(); const problems = []; const used = new Set();
    for (const entry of entries) {
        const key=`${entry.file}:${entry.owner}`; if(!byOwner.has(key))byOwner.set(key,[]); byOwner.get(key).push(entry);
        entry.categories = [];
        if (['modal.open','modal.drawer','dialog'].includes(entry.launcher)) {
            const review=reviews.find(item=>item.id===entry.id && item.fingerprint===entry.fingerprint);
            if(review && ['record','editor','confirmation','action'].includes(review.category) && review.purpose) {entry.categories=[review.category];used.add(review);} else problems.push(`Unreviewed modal body: ${entry.id}`);
        } else if (['DetailView','modal.detail'].includes(entry.launcher)) entry.categories=['record'];
        else if(entry.launcher==='formModal')entry.categories=['editor'];
        else if(entry.launcher==='modal.confirm')entry.categories=['confirmation'];
        else if(entry.launcher==='import')entry.categories=['dependency'];
    }
    for(let changed=true;changed;) {changed=false;for(const entry of entries)if(entry.target){const categories=[...new Set((byOwner.get(entry.target)??[]).flatMap(item=>item.categories))].sort();if(categories.join()!==entry.categories.join()){entry.categories=categories;changed=true;}}}
    for(const entry of entries){if(!entry.categories.length)problems.push(`Unclassified forwarding target: ${entry.id} -> ${entry.target}`);entry.category=entry.categories.length===1?entry.categories[0]:'nested-flow';}
    for(const review of reviews)if(!used.has(review))problems.push(`Stale modal body review: ${review.id}`);
    return problems;
}
