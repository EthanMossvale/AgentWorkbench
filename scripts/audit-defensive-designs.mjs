// Static inventory only: never imports or executes the inspected application.
import ts from 'typescript';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function extractTypescript(file, source) {
  const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),records=[];
  const txt=n=>n?.getText(tree)??'';
  const context=n=>{for(let p=n.parent;p;p=p.parent)if(ts.isFunctionLike(p))return txt(p.name)||txt(p.parent?.name)||'(anonymous)';return '(module)';};
  const guards=n=>{const out=[];for(let p=n.parent;p;p=p.parent){if(ts.isIfStatement(p)){const at=n.getStart(tree),then=p.thenStatement;out.push((at>=then.getStart(tree)&&at<then.end?'THEN: ':'ELSE/CONDITION: ')+txt(p.expression));}if(ts.isFunctionLike(p))break;}return out.reverse();};
  const add=(n,kind,condition='',effect='',extra={})=>{const start=n.getStart(tree),end=n.end,at=tree.getLineAndCharacterOfPosition(start);records.push({file,kind,line:at.line+1,column:at.character+1,endLine:tree.getLineAndCharacterOfPosition(end).line+1,start,end,condition,effect,code:source.slice(start,end),function:context(n),enclosingConditions:guards(n),...extra});};
  const atoms=(n,owner)=>{
    if(ts.isParenthesizedExpression(n))return atoms(n.expression,owner);
    if(ts.isBinaryExpression(n)&&[ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)){atoms(n.left,owner);atoms(n.right,owner);}
    else add(n,'condition-part',txt(n),'复合条件的一部分；需结合父条件及 && / || 判断，不能机械删除。',{parentStart:owner.getStart(tree)});
  };
  const visit=n=>{
    if(ts.isIfStatement(n)){add(n,'if',txt(n.expression),txt(n.thenStatement)+(n.elseStatement?'\nELSE '+txt(n.elseStatement):''));atoms(n.expression,n);}
    if(ts.isWhileStatement(n)||ts.isDoStatement(n)||ts.isForStatement(n)){const condition=n.expression??n.condition;if(condition)add(n,'loop-condition',txt(condition),'控制循环是否继续。');}
    if(ts.isCaseClause(n)||ts.isDefaultClause(n))add(n,'switch-branch',ts.isCaseClause(n)?txt(n.expression):'default',n.statements.map(txt).join('\n'));
    if(ts.isConditionalExpression(n)){add(n,'conditional',txt(n.condition),'TRUE '+txt(n.whenTrue)+'\nFALSE '+txt(n.whenFalse));atoms(n.condition,n);}
    if(ts.isBinaryExpression(n)&&[ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken,ts.SyntaxKind.QuestionQuestionToken].includes(n.operatorToken.kind))add(n,'short-circuit',txt(n.left),ts.tokenToString(n.operatorToken.kind)+' '+txt(n.right));
    if(ts.isThrowStatement(n))add(n,'throw','',txt(n.expression));
    if(ts.isReturnStatement(n))add(n,'return','',txt(n.expression)||'(empty return)');
    if(ts.isBreakStatement(n)||ts.isContinueStatement(n))add(n,'loop-exit','',txt(n));
    if(ts.isCatchClause(n))add(n,'catch',txt(n.variableDeclaration),txt(n.block));
    if(ts.isJsxAttribute(n)&&/^(disabled|readOnly|hidden|sandbox|allow|aria-disabled|maxLength|max|min|pattern|accept)$/.test(n.name.getText(tree)))add(n,'ui-constraint',txt(n.initializer),txt(n.name));
    if(ts.isCallExpression(n)||ts.isNewExpression(n)){
      const callee=txt(n.expression);
      if(/(?:assert|require|ensure|validat|authoriz|verif|confirm|deny|fail|reject|throwIfAborted|limit|budget|timeout|setTimeout|setInterval|Abort|\.catch$|\.filter$|\.slice$|\.subarray$|Math\.(min|max)$|\.has$|\.includes$|\.test$|\.match$|\.every$|\.some$|\.kill$|\.abort$|\.cancel$|\.race$|\.freeze$|sanitize|redact|escape|fallback|lock|mutex|semaphore|dedup|backoff|retry)/i.test(callee))add(n,'policy-call',(n.arguments??[]).map(txt).join(', '),callee);
    }
    if(ts.isPropertyAssignment(n)||ts.isVariableDeclaration(n)||ts.isPropertyDeclaration(n)){
      const name=txt(n.name);
      if(n.initializer&&/(?:max|min|limit|budget|timeout|deadline|allow|deny|block|safe|protect|secure|permission|sandbox|webSecurity|contextIsolation|nodeIntegration|redirect|retry|concurr|capacity|ttl|expires|readonly|disabled|whitelist|blacklist|policy|guard|cooldown|interval)/i.test(name))add(n,'policy-value','',name+' = '+txt(n.initializer));
    }
    if(ts.isStringLiteralLike(n)||ts.isTemplateExpression(n)){
      const raw=txt(n);
      if(!raw.includes('\n')&&raw.length>80&&/(?:must not|do not|never |only |不得|禁止|不允许)/i.test(raw))add(n,'instruction-policy','',raw);
      if(raw.includes('\n')&&/(?:def |raise |if |set -e|throw |exit |require\(|deny|allow|sandbox|chmod|ulimit|setrlimit|NoNewPrivileges)/i.test(raw)){
        const startLine=tree.getLineAndCharacterOfPosition(n.getStart(tree)).line+1;
        for(const [i,line]of raw.split('\n').entries())if(/(?:\bif\b|\bunless\b|\braise\b|\bthrow\b|\breturn\b|\bexit\b|\bbreak\b|\bcontinue\b|\bexcept\b|require\(|assert|deny|allow|limit|timeout|readonly|chmod|ulimit|setrlimit|NoNewPrivileges)/i.test(line))records.push({file,kind:'embedded-code',line:startLine+i,column:1,endLine:startLine+i,condition:'',effect:'嵌入式脚本/指令文本候选，未执行；须核实生成及调用链。',code:line,function:context(n),enclosingConditions:guards(n)});
      }
    }
    ts.forEachChild(n,visit);
  };visit(tree);
  return {records,diagnostics:tree.parseDiagnostics.map(d=>({line:tree.getLineAndCharacterOfPosition(d.start??0).line+1,message:ts.flattenDiagnosticMessageText(d.messageText,' ')}))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=process.cwd(),out=path.resolve(process.argv[2]??'build/qa/defensive-audit-expanded');mkdirSync(out,{recursive:true});
  const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8',maxBuffer:20*1024*1024}).split('\0').filter(Boolean),manifest=[],records=[],sources={};
  for(const file of files){
    const ext=path.extname(file).toLowerCase(),data=readFileSync(file),scope=/^(tests\/|scripts\/.*(?:test|probe|benchmark|check|verify|audit|qa))/i.test(file)?'verification':file.startsWith('scripts/')||file.startsWith('.github/')?'tooling':/^(apps|packages|services)\//.test(file)?'product':'repository';
    const supported=['.ts','.tsx','.js','.mjs','.cjs','.py','.cs','.ps1','.sh','.cmd','.bat','.nsh','.nsi','.html','.css','.yml','.yaml','.toml','.service','.json'].includes(ext)||['.gitignore','.gitattributes'].includes(file);
    const entry={file,sha256:createHash('sha256').update(data).digest('hex'),scope,bytes:data.length,method:supported?'pending':'not-executable-source'};manifest.push(entry);
    if(!supported)continue;
    const source=data.toString('utf8');entry.lines=source.split('\n').length;sources[file]=source;
    if(['.ts','.tsx','.js','.mjs','.cjs'].includes(ext)){
      const found=extractTypescript(file,source);entry.method='typescript-ast';entry.diagnostics=found.diagnostics;records.push(...found.records.map(r=>({...r,scope})));entry.count=found.records.length;
    }else if(ext==='.py'){entry.method='python-ast-pending';}
    else{
      entry.method='line-candidates';let count=0;
      for(const [i,line] of source.split('\n').entries())if(/(?:\bif\b|\belse\b|\bthrow\b|\breturn\b|\bexit\b|\babort\b|\bcatch\b|\bfinally\b|\bassert\b|\braise\b|\brequire\b|\bbreak\b|\bcontinue\b|allow|deny|block|safe|protect|secur|permission|sandbox|policy|timeout|limit|budget|retry|verify|validate|confirm|readonly|disabled|redirect|hash|checksum|integrity|concurr|capacity|expiry|expires|ttl|Content-Security|pointer-events|user-select|overflow|display\s*:\s*none|visibility\s*:\s*hidden)/i.test(line)){
        records.push({file,scope,kind:'line-candidate',line:i+1,endLine:i+1,column:1,condition:'',effect:'非 TS/Python 源码或配置候选；需人工核对。',code:line,function:'(file)',enclosingConditions:[]});count++;
      }entry.count=count;
    }
  }
  const result={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),manifest,records};
  writeFileSync(path.join(out,'ts-inventory.json'),JSON.stringify(result));writeFileSync(path.join(out,'sources.json'),JSON.stringify(sources));
  console.log(JSON.stringify({files:manifest.length,records:records.length,syntaxErrors:manifest.filter(f=>f.diagnostics?.length).map(f=>({file:f.file,diagnostics:f.diagnostics}))}));
}
