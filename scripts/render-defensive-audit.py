"""Produce a local, paged approval ledger. No product code or decisions are changed."""
import collections
import csv
import hashlib
import json
import pathlib
import re
import sys

out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'build/qa/defensive-audit-expanded')
data=json.loads((out/'inventory.json').read_text(encoding='utf-8'))
sources=json.loads((out/'sources.json').read_text(encoding='utf-8'))
old_file=pathlib.Path('scripts/defensive-design-reviews.json')
old=json.loads(old_file.read_text(encoding='utf-8')) if old_file.exists() else []
manual_rows=[]
unresolved_reviews=[]
for item in old:
    for ref in item.get('refs',[]):
        file,needle=ref['file'],ref['needle']
        if not needle or file not in sources:
            unresolved_reviews.append(dict(id=item['id'],file=file,needle=needle))
            continue
        for n,line in enumerate(sources[file].splitlines(),1):
            if needle in line:
                manual_rows.append(dict(file=file,scope=next(f['scope'] for f in data['manifest'] if f['file']==file),
                    kind='manual-review',line=n,column=line.index(needle)+1,endLine=n,condition=needle,
                    effect=item['behavior'],code=line,function='(reviewed source location)',enclosingConditions=[],review=item))
                break
        else:
            unresolved_reviews.append(dict(id=item['id'],file=file,needle=needle))

def assess(row):
    kind=row['kind']
    body=row['condition']+' '+row['effect']+' '+row['code']
    # AST sites are not the same as independently necessary designs.
    direct=kind in ('throw','catch','assert','ui-constraint','loop-exit')
    direct=direct or kind=='policy-call' and bool(re.search(r'assert|require|ensure|validat|authoriz|verif|confirm|deny|fail|reject|setTimeout|Abort|\.kill$|\.abort$|\.cancel$|sanitize|redact',row['effect'],re.I))
    direct=direct or kind=='if' and bool(re.search(r'throw\b|\braise\b|\breturn\s*(?:;|$)|\breturn (?:false|null|undefined|None)\b|deny\(|fail\(|reject\(',row['effect']))
    status='语法识别的拦截/保护动作候选' if direct else '条件/策略候选，必要性待核实'
    category='控制流候选'
    rank=500
    advice='未定：仅凭此语法点不能判断删留，需结合下方条件、父分支及调用方。'
    impact='删除这一行可能改变业务控制流；不授权按关键词机械删除。'
    if kind=='condition-part':
        status='复合条件子项'
        advice='单独列出以便审批；实际修改必须保持父条件剩余逻辑正确。'
        category='复合条件'
    elif kind=='return' and not row.get('enclosingConditions'):
        status='普通返回/辅助证据候选'
    elif kind in ('embedded-code','instruction-policy','line-candidate'):
        status='嵌入代码/文本/配置候选，调用链待核实'
    if re.search(r'PRIVATE KEY|Bearer|safeStorage|encrypt|redact|sanitize',body,re.I):
        category='凭据/脱敏';rank=900
        advice='静态初判：保护有必要；需排除整段吞错、误判普通内容。'
        impact='可能使敏感值外泄或损失诊断信息；要区分字段脱敏和内容禁用。'
    elif re.search(r'OWNER_MISMATCH|OTHER_OWNER|UNAUTHORIZED|ACCESS_DENIED|SO_PEERCRED|StrictHostKeyChecking|IPC 来源|contextIsolation|permissionMode|grant\.expires',body):
        category='身份/权限';rank=950
        advice='静态初判：倾向保留真实权限校验；额外路径限制不自动归入权限。'
        impact='可能改变实际主体、权限范围或设备边界，需核对完整调用链。'
    elif re.search(r'CONFLICT|CHANGED|UNCERTAIN|DUPLICATE|IDEMPOT|sourceHash|expectedVersion|sha256|sha512|checksum|revision\s*!==',body,re.I):
        category='完整性/防重复';rank=930
        advice='静态初判：倾向保留数据版本、内容和幂等约束；阈值可另审。'
        impact='可能重复执行或覆盖新数据；不能只因报错频繁就删除。'
    elif re.search(r'timeout|deadline|TOO_LARGE|LIMIT|MAX_|maxBytes|capacity|concurrency|\.slice\(|Math\.min|Math\.max',body,re.I):
        category='容量/时间/并发预算';rank=200
        advice='静态初判：优先审查固定阈值，倾向可配置或流式处理，不代表全部移除。'
        impact='放宽会改变时间、内存、磁盘或调用费用；终止副作用须另审。'
    elif re.search(r'PROTECTED|credentialPath|credentialSegments|whitelist|blacklist|allowlist|denylist',body,re.I):
        category='额外路径/名单限制';rank=100
        advice='静态初判：优先审查是否为额外拦截；不自动视为 OS 权限。'
        impact='可能开放原先拒绝的路径/选项，写入目标与数据完整性仍需保留。'
    elif kind=='ui-constraint':
        category='界面禁用/只读/隔离';rank=450
        advice='未定：检查是否与真实后台忙态或权限一致，排查无必要的 UI 门槛。'
    elif kind=='catch':
        category='异常处理/降级';rank=450
        advice='未定：区分有意恢复、清理和静默吞错，不能一律删 catch。'
    elif kind=='throw':
        category='显式拒绝';rank=400
        advice='未定：必须沿父条件判断属于额外拦截还是真实协议/业务失败。'
    matches=[row['review']] if row.get('review') else []
    if matches:
        item=min(matches,key=lambda i:(i['tier'],i['id']))
        rank={1:0,2:100,3:1000}[item['tier']]+int(item['id'][1:])/1000
        category=item['title']
        advice=item['judgment']
        impact=item['impact']
        status='已有人工设计判断的具体源码点（非动态验收）'
    return dict(rank=rank,category=category,evidence=status,advice=advice,impact=impact,
                prior=[item['id'] for item in matches],reviews=matches,decision='待审批')

seen=collections.Counter()
records=[]
for raw in data['records']+manual_rows:
    row=dict(raw)
    key='\0'.join([row['file'],row['kind'],re.sub(r'\s+',' ',row['code']).strip()])
    if row.get('review'):key+='\0'+row['review']['id']
    seen[key]+=1
    row['id']='F'+hashlib.sha256((key+'\0'+str(seen[key])).encode()).hexdigest()[:12]
    row.update(assess(row))
    row.pop('review',None)
    row['layer']='condition' if row['kind']=='condition-part' else 'action' if row['evidence'].startswith(('语法识别','已有人工')) else 'candidate'
    records.append(row)
assert len({r['id'] for r in records})==len(records)
parents={}
offset_parents={}
for r in records:
    if r['kind'] in ('if','conditional','assert'):
        parents[(r['file'],r.get('start'),r['line'],r.get('column'))]=r['id']
        if 'start' in r:
            offset_parents[(r['file'],r['start'])]=r['id']
for r in records:
    if r['kind']=='condition-part':
        if 'parentStart' in r:
            r['parent']=offset_parents.get((r['file'],r['parentStart']))
        else:
            r['parent']=parents.get((r['file'],None,r.get('parentLine'),r.get('parentColumn')))
records.sort(key=lambda r:(r['rank'],r['file'],r['line'],r.get('column',0),r['kind']))
scope_counts=collections.Counter(r['scope'] for r in records)
kind_counts=collections.Counter(r['kind'] for r in records)
drift=[]
for f in data['manifest']:
    current=pathlib.Path(f['file'])
    if not current.exists() or hashlib.sha256(current.read_bytes()).hexdigest()!=f['sha256']:
        drift.append(f['file'])
summary=dict(head=data['head'],files=len(data['manifest']),records=len(records),scopes=dict(scope_counts),kinds=dict(kind_counts),
             parseErrors=[f['file'] for f in data['manifest'] if f.get('diagnostics')],changedSinceScan=drift,
             unresolvedReviews=unresolved_reviews,
             directProductSites=sum(r['scope']=='product' and r['evidence']=='语法识别的拦截/保护动作候选' for r in records),
             manuallyAssociatedSites=sum(r['scope']=='product' and bool(r['prior']) for r in records))
summary['productLayers']=dict(collections.Counter(r['layer'] for r in records if r['scope']=='product'))
ledger=dict(summary=summary,manifest=data['manifest'],records=records)
(out/'ledger.json').write_text(json.dumps(ledger,ensure_ascii=False),encoding='utf-8')
(out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
with (out/'approval.csv').open('w',encoding='utf-8-sig',newline='') as stream:
    writer=csv.writer(stream)
    keys=['id','scope','rank','category','evidence','file','line','column','function','kind','parent','condition','effect','code','advice','impact','decision']
    writer.writerow(keys)
    for r in records:
        writer.writerow([("'"+str(r.get(k,''))) if str(r.get(k,'')).startswith(('=','+','-','@')) else r.get(k,'') for k in keys])
# Keep the payload separate so the HTML remains small and reviewable. Both files are local.
payload=dict(summary=summary,manifest=data['manifest'],records=records,sources=sources)
(out/'review-data.js').write_text('window.AUDIT_DATA='+json.dumps(payload,ensure_ascii=False).replace('\u2028','\\u2028').replace('\u2029','\\u2029')+';',encoding='utf-8')
template=pathlib.Path('scripts/defensive-audit-review.html').read_text(encoding='utf-8')
(out/'review.html').write_text(template,encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
