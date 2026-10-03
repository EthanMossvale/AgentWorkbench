"""Extend the static TS inventory with Python AST control points, without execution."""
import ast
import json
import pathlib
import re
import sys


def extract_python(file, source):
    tree = ast.parse(source, filename=file)
    records = []
    parents = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent

    def text(node):
        return ast.get_source_segment(source, node) or ast.unparse(node)

    def add(node, kind, condition='', effect='', **extra):
        owner = '(module)'
        guards = []
        parent = parents.get(node)
        child = node
        while parent:
            if isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef)):
                owner = parent.name
                break
            if isinstance(parent, ast.If):
                guards.append(('THEN: ' if child in parent.body else 'ELSE/CONDITION: ')+text(parent.test))
            child = parent
            parent = parents.get(parent)
        records.append(dict(file=file, kind=kind, line=node.lineno, column=node.col_offset+1,
                            endLine=node.end_lineno, code=text(node), condition=condition,
                            effect=effect, function=owner, enclosingConditions=guards[::-1], **extra))

    def atoms(node, parent):
        if isinstance(node, ast.BoolOp):
            for value in node.values:
                atoms(value, parent)
        else:
            add(node, 'condition-part', text(node), '复合条件子项；须结合父条件逻辑审批。',
                parentLine=parent.lineno, parentColumn=parent.col_offset+1)

    for node in ast.walk(tree):
        if isinstance(node, ast.If):
            add(node, 'if', text(node.test), '\n'.join(text(n) for n in node.body))
            atoms(node.test, node)
        elif isinstance(node, ast.While):
            add(node, 'loop-condition', text(node.test), '控制循环是否继续。')
        elif isinstance(node, ast.IfExp):
            add(node, 'conditional', text(node.test), 'TRUE '+text(node.body)+'\nFALSE '+text(node.orelse))
            atoms(node.test, node)
        elif isinstance(node, ast.BoolOp):
            add(node, 'short-circuit', text(node.values[0]), text(node))
        elif isinstance(node, ast.Raise):
            add(node, 'throw', effect=text(node))
        elif isinstance(node, ast.Return):
            add(node, 'return', effect=text(node))
        elif isinstance(node, (ast.Break, ast.Continue)):
            add(node, 'loop-exit', effect=text(node))
        elif isinstance(node, ast.ExceptHandler):
            add(node, 'catch', text(node.type) if node.type else '*', '\n'.join(text(n) for n in node.body))
        elif isinstance(node, ast.Assert):
            add(node, 'assert', text(node.test), text(node.msg) if node.msg else '')
            atoms(node.test, node)
        elif isinstance(node, ast.Call):
            callee = text(node.func)
            if re.search(r'assert|require|ensure|validat|authoriz|verif|confirm|deny|fail|reject|limit|budget|timeout|abort|cancel|kill|terminate|sanitize|redact|escape|fallback|lock|mutex|semaphore|retry|backoff|fullmatch|match|isinstance|^all$|^any$|^min$|^max$', callee, re.I):
                add(node, 'policy-call', ', '.join(text(n) for n in node.args), callee)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            names = node.targets if isinstance(node, ast.Assign) else [node.target]
            if node.value and any(re.search(r'max|min|limit|budget|timeout|deadline|allow|deny|block|safe|protect|secure|permission|sandbox|redirect|retry|concurr|capacity|ttl|expires|readonly|disabled|policy|guard|interval',text(n),re.I) for n in names):
                add(node, 'policy-value', effect=text(node))
        elif isinstance(node, ast.comprehension):
            for value in node.ifs:
                add(value, 'filter', text(value), '推导式过滤掉不匹配项。')
        elif isinstance(node, ast.Constant) and isinstance(node.value,str) and '\n' in node.value:
            for i, line in enumerate(node.value.splitlines()):
                if re.search(r'\bif\b|\braise\b|\bthrow\b|\breturn\b|\bexit\b|require\(|deny|allow|limit|timeout|sandbox|chmod|ulimit',line,re.I):
                    # String decoding can alter line offsets: point to the owning literal.
                    add(node,'embedded-code',effect='嵌入文本候选；定位为字符串所在行，内部行号见 literalLine。',literalLine=i+1)
                    records[-1]['code']=line
    return records


def main():
    output=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'build/qa/defensive-audit-expanded')
    data=json.loads((output/'ts-inventory.json').read_text(encoding='utf-8'))
    sources=json.loads((output/'sources.json').read_text(encoding='utf-8'))
    for entry in data['manifest']:
        if entry['method']!='python-ast-pending':
            continue
        try:
            found=extract_python(entry['file'],sources[entry['file']])
            entry['method']='python-ast'
            entry['count']=len(found)
            data['records'].extend(dict(row,scope=entry['scope']) for row in found)
        except SyntaxError as error:
            entry['method']='python-parse-failed'
            entry['diagnostics']=[dict(line=error.lineno,message=error.msg)]
    (output/'inventory.json').write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
    print(json.dumps(dict(files=len(data['manifest']),records=len(data['records']),
                         errors=[r['file'] for r in data['manifest'] if r.get('diagnostics')]),ensure_ascii=False))


if __name__=='__main__':
    main()
