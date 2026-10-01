import {RememberedDetails} from './UiMemory';
import { useEffect, useRef, useState } from 'react';
import type { AppState, Protocol, TranslationProfile } from '../../../packages/contracts';
import { DEFAULT_MAX_OUTPUT_TOKENS, normalizeBaseUrl, reasoningOptions, validateReasoning } from '../../../packages/translation/config';
import { api } from './App';
import type { PageProps } from './Pages';
import { errorText, Field, Icon } from './ui';
import './TranslationSettings.css';
import ModelUsageSummary from './ModelUsageSummary';
import { modelUsageRevision } from '../../../packages/model-management/usage';
import type { TranslationTarget, TranslationSource } from '../../../packages/translation/types';
import { translationTargetLabel } from './translation-target-label';

const protocols: Record<Protocol, string> = { 'chat-completions': 'Chat Completions', responses: 'Responses', 'anthropic-messages': 'Anthropic Messages' };
const effortLabels: Record<string, string> = { none: '无 · none', minimal: '最少 · minimal', low: '低 · low', medium: '中 · medium', high: '高 · high', xhigh: '更高 · xhigh', max: '最高 · max' };
type Candidate = { protocol: Protocol; evidence: string };
type Reasoning = NonNullable<TranslationProfile['reasoning']>;
const copyProfile = (profile: TranslationProfile): TranslationProfile => ({ ...profile, verifiedEfforts: [...profile.verifiedEfforts], ...(profile.reasoning ? { reasoning: { ...profile.reasoning } } : {}) });

export default function TranslationSettings({ state, refresh, report, notify, moduleEnabled }: PageProps & { moduleEnabled?: boolean }) {
  const [profile, setProfile] = useState(() => copyProfile(state.translation));
  const [key, setKey] = useState('');
  const [usageWarning,setUsageWarning]=useState(false);
  useEffect(()=>{let live=true;void api<{pendingReceipts?:number}>('translation/usage').then(v=>{if(live)setUsageWarning(!!v.pendingReceipts);}).catch(()=>{});return()=>{live=false;};},[state]);
  const [targets,setTargets]=useState<TranslationTarget[]>([]),[targetError,setTargetError]=useState('');
  const sourceKind=profile.source?.kind??'custom';
  const selectedTarget=targets.find(t=>t.id===profile.source?.targetId);
  const catalogKey=JSON.stringify([state.modelConnections,state.localModelAccounts]);
  useEffect(()=>{let live=true;const load=()=>{void api<TranslationTarget[]>('translation/targets').then(v=>{if(live){setTargets(v);setTargetError('');}},e=>{if(live)setTargetError(errorText(e));});};load();const stop=window.workbench?.onExtensions?.(load);return()=>{live=false;stop?.();};},[catalogKey]);



  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [modelSource, setModelSource] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateError, setCandidateError] = useState('');
  const [saveError, setSaveError] = useState('');

  const form = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const modelEpoch = useRef(0);
  const candidateEpoch = useRef(0);
  const enabled = moduleEnabled ?? state.plugins?.translation?.enabled !== false;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  useEffect(() => {
    mounted.current = true;

    return () => { mounted.current = false; modelEpoch.current++; candidateEpoch.current++; };
  }, []);
  const invalidateModels = () => {
    modelEpoch.current++; setModels([]); setModelSource(''); setModelSearch(''); setModelError(''); setLoadingModels(false);
  };
  const invalidateCandidates = () => { candidateEpoch.current++; setCandidates([]); setCandidateError(''); setLoadingCandidates(false); };
  const invalidateDiscovery = () => { invalidateModels(); invalidateCandidates(); };
  useEffect(() => { if (!enabled) invalidateDiscovery(); }, [enabled]);
  const patch = (changes: Partial<TranslationProfile>) => { setSaveError(''); setProfile(value => ({ ...value, ...changes })); };
  const resetReasoning = { reasoning: { mode: 'default' } as Reasoning, effort: undefined, verifiedEfforts: [] };
  const setProtocol = (protocol: Protocol) => { invalidateDiscovery(); patch({ protocol, ...resetReasoning }); };
  const setModel = (model: string) => { patch({ model, ...resetReasoning }); };
  const changed = JSON.stringify(profile) !== JSON.stringify(state.translation) || !!key;
  const connectionUnsaved = profile.baseUrl !== state.translation.baseUrl || profile.protocol !== state.translation.protocol || profile.consent !== state.translation.consent || !!key;
  const reasoning: Reasoning = profile.reasoning ?? (profile.effort ? { mode: 'effort', effort: profile.effort, confirmed: profile.verifiedEfforts.includes(profile.effort) } : { mode: 'default' });
  const anthropic = profile.protocol === 'anthropic-messages';
  const efforts = reasoningOptions(profile.protocol);
  let normalizedEndpoint = '';
  try { normalizedEndpoint = normalizeBaseUrl(profile.baseUrl); } catch { /* Invalid drafts remain editable. */ }
  let reasoningError = '';
  try { if(sourceKind==='custom')validateReasoning(profile); } catch (error) { reasoningError = errorText(error); }
  const filteredModels = models.filter(model => model.toLocaleLowerCase().includes(modelSearch.trim().toLocaleLowerCase()));

  const persist = async (): Promise<AppState | null> => {
    if (savingRef.current || !form.current?.reportValidity()) return null;
    if (reasoningError) { setSaveError(reasoningError); return null; }
    savingRef.current = true; setSaving(true); setSaveError('');
    const requestKey = key;
    try {
      const pending = api('translation/settings', { profile, translateInput:true, translateProgress:false, translateFinal:true, ...(sourceKind==='custom'&&requestKey ? { key: requestKey } : {}) });
      setKey('');
      await pending;
      const next = await refresh();
      if (!mounted.current) return null;
      setProfile(copyProfile(next.translation));

      return next;
    } catch (error) {
      if (mounted.current) setSaveError(errorText(error));
      return null;
    } finally { savingRef.current = false; if (mounted.current) { setKey(''); setSaving(false); } }
  };
  const save = async () => {
    const next = await persist();
    if (next) notify('翻译设置已保存；没有启动模型测试');
  };
  const loadModels = async () => {
    if (!enabledRef.current || savingRef.current || loadingModels) return;
    if (!form.current?.reportValidity()) return;
    const epoch = ++modelEpoch.current;
    const current = () => mounted.current && enabledRef.current && epoch === modelEpoch.current;
    setLoadingModels(true); setModelError(''); setModels([]); setModelSource(''); setModelSearch('');
    try {
      if (changed) {
        const next = await persist();
        if (!next || !current()) return;
      }
      if (!current()) return;
      const result = await api<{ models: string[]; source: string }>('translation/models');
      if (!current()) return;
      const choices = [...new Set(result.models.filter(model => typeof model === 'string' && model.trim()))];
      setModels(choices); setModelSource(result.source);
      if (!choices.length) setModelError('目录没有返回模型。仍可手动填写准确的模型 ID；空目录不代表模型不存在。');
    } catch (error) { if (current()) setModelError(errorText(error)); }
    finally { if (current()) setLoadingModels(false); }
  };
  const candidateLookup = async () => {
    if (!enabledRef.current || loadingCandidates) return;
    const epoch = ++candidateEpoch.current;
    const current = () => mounted.current && enabledRef.current && epoch === candidateEpoch.current;
    setLoadingCandidates(true); setCandidateError(''); setCandidates([]);
    try { const result = await api<Candidate[]>('translation/candidates', { baseUrl: profile.baseUrl }); if (current()) setCandidates(result); }
    catch (error) { if (current()) setCandidateError(errorText(error)); }
    finally { if (current()) setLoadingCandidates(false); }
  };
  const setReasoningMode = (mode: Reasoning['mode']) => {
    let next: Reasoning = { mode };
    if (mode === 'effort') next = { mode, effort: efforts.includes('medium') ? 'medium' : efforts[0], confirmed: false };
    if (mode === 'adaptive') next = { mode, confirmed: false };
    if (mode === 'budget') next = { mode, budgetTokens: 1024, confirmed: false };
    patch({ reasoning: next, effort: undefined, verifiedEfforts: [] });
  };
  const patchReasoning = (changes: Partial<Reasoning>) => patch({ reasoning: { ...reasoning, ...changes }, effort: undefined, verifiedEfforts: [] });

  return <div className="translation-settings" data-workbench-translation-settings>
    {!enabled && <p className="translation-disabled-note" data-testid="translation-disabled-note">翻译已关闭，配置仍可编辑和保存。</p>}
    <form ref={form} onInvalidCapture={event => { const details = (event.target as HTMLElement).closest('details'); if (details) details.open = true; }} onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="translation-config-fields" disabled={saving}>
        <div className="translation-source-tabs skill-tabs" role="tablist" aria-label="翻译模型来源" data-workbench-translation-source>{([{id:'model',label:'已启用模型'},{id:'custom',label:'自定义 API'}] as const).map(tab=><button type="button" role="tab" key={tab.id} id={'translation-source-'+tab.id} tabIndex={sourceKind===tab.id?0:-1} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'model':event.key==='End'?'custom':sourceKind==='model'?'custom':'model';(event.currentTarget.parentElement?.querySelector('#translation-source-'+next) as HTMLButtonElement)?.click();(event.currentTarget.parentElement?.querySelector('#translation-source-'+next) as HTMLButtonElement)?.focus();}}} aria-selected={sourceKind===tab.id} aria-controls="translation-source-panel" onClick={()=>{invalidateDiscovery();setKey('');patch({source:{...profile.source,kind:tab.id,...(tab.id==='model'?{targetId:profile.source?.targetId??''}:{})} as TranslationSource});}}>{tab.label}</button>)}</div>
        {sourceKind==='model'?<section className="settings-section" id="translation-source-panel" role="tabpanel" aria-labelledby={'translation-source-'+sourceKind} data-workbench-translation-model>
          <Field label="翻译模型" hint="使用已启用的 API 或官方账号；独立执行翻译，不加入主会话。"><select required data-testid="translation-target" value={profile.source?.targetId??''} onChange={e=>patch({source:{kind:'model',targetId:e.target.value}})}><option value="" disabled>选择用来翻译的模型</option>{profile.source?.targetId&&!selectedTarget&&<option value={profile.source.targetId}>已选模型暂不可用 · {profile.source.targetId}</option>}{targets.map(target=><option key={target.id} value={target.id} disabled={!target.ready}>{translationTargetLabel(target)}{!target.ready?' · 暂不可用':''}</option>)}</select></Field>
          {!!selectedTarget?.efforts.length&&<Field label="思考强度"><select data-testid="translation-target-effort" value={profile.source?.effort??''} onChange={e=>patch({source:{kind:'model',targetId:profile.source!.targetId!,...(e.target.value?{effort:e.target.value}:{})}})}><option value="">服务默认</option>{selectedTarget.efforts.map(e=><option key={e} value={e}>{effortLabels[e]??e}</option>)}</select></Field>}
          {(!targets.length||selectedTarget&&!selectedTarget.ready||profile.source?.targetId&&!selectedTarget)&&<p className="inline-note">请在模型设置中启用 API 或登录账号。模型暂不可用时保留选择，不自动切换。</p>}
          {targetError&&<p role="alert" className="inline-error">{targetError}</p>}
        </section>:<section className="settings-section" id="translation-source-panel" role="tabpanel" aria-labelledby={'translation-source-'+sourceKind} data-workbench-translation-custom>
          <div className="form-grid"><Field label="服务名称"><input required value={profile.name} placeholder="我的翻译服务" onChange={event => patch({ name: event.target.value })} /></Field><Field label="协议类型"><select data-testid="translation-protocol" value={profile.protocol} onChange={event => setProtocol(event.target.value as Protocol)}>{Object.entries(protocols).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field></div>
          <Field label="服务 URL" hint="填写 API 基础地址或完整请求地址。"><div className="input-with-action"><input data-testid="translation-endpoint" required type="url" placeholder="https://api.example.com/v1" value={profile.baseUrl} onChange={event => { invalidateDiscovery(); patch({ baseUrl: event.target.value, consent: false, hasKey: event.target.value === state.translation.baseUrl && state.translation.hasKey, ...resetReasoning }); }} /><button type="button" className="button secondary" data-testid="translation-protocol-candidates" disabled={!enabled || loadingCandidates} onClick={() => void candidateLookup()}>{loadingCandidates ? '读取中…' : '识别协议候选'}</button></div></Field>
          {normalizedEndpoint && normalizedEndpoint !== profile.baseUrl.replace(/\/$/, '') && <p className="translation-normalized-endpoint" data-testid="translation-normalized-endpoint">保存为 API 基础地址：<code>{normalizedEndpoint}</code></p>}
          {!!candidates.length && <div className="candidate-list" data-testid="translation-candidates"><small>根据地址给出候选，不发送 key 或试探模型；点击选择后仍需保存。</small>{candidates.map(candidate => <button type="button" key={candidate.protocol} onClick={() => setProtocol(candidate.protocol)}><span>{protocols[candidate.protocol]}</span><small>{candidate.evidence}</small><Icon name="chevron" size={14} /></button>)}</div>}
          {candidateError && <div className="inline-error" role="alert">{candidateError}</div>}
          <Field label="翻译专属 API key" hint={profile.hasKey ? '已加密保存，留空保持不变。' : '保存后加密存储，不在界面回显。'}><div className="credential-input"><input data-testid="translation-key" type="password" autoComplete="new-password" spellCheck={false} placeholder={profile.hasKey ? '已安全保存 · 输入新 key 可替换' : '输入翻译服务的独立 key'} value={key} onChange={event => { invalidateModels(); setSaveError(''); setKey(event.target.value); }} /><Icon name="shield" size={16} /></div></Field>
          <div className="translation-model-actions"><button type="button" data-testid="translation-load-models" className="button secondary" disabled={!enabled || loadingModels} onClick={() => void loadModels()}>{loadingModels ? (saving ? '保存设置中…' : '读取模型中…') : connectionUnsaved || changed ? '保存并读取模型' : '刷新模型目录'}</button><small>{!enabled ? '开启翻译后可读取目录' : '使用此 key 读取模型列表，不发送消息正文或运行翻译。'}</small></div>
          {!!models.length && <div className="translation-model-catalog" data-testid="translation-model-catalog"><header><strong data-testid="translation-model-count">发现 {models.length} 个模型</strong><small>目录来源：{modelSource}</small></header><Field label="搜索模型"><input type="search" data-testid="translation-model-search" value={modelSearch} placeholder="输入模型名称或 ID 筛选" onChange={event => setModelSearch(event.target.value)} /></Field><select aria-label="选择目录中的翻译模型" data-testid="translation-model-list" size={Math.min(6, Math.max(3, filteredModels.length + 1))} value={filteredModels.includes(profile.model) ? profile.model : ''} onChange={event => setModel(event.target.value)}><option value="" disabled>{filteredModels.length ? '请选择一个模型' : '没有匹配的模型'}</option>{filteredModels.map(model => <option key={model} value={model}>{model}</option>)}</select><p className="inline-note">目录只说明模型 ID 可见，不证明翻译质量、思考参数支持或实际生效情况。</p></div>}
          {modelError && <div className="inline-error" data-testid="translation-model-error" role="alert">{modelError}</div>}
          <Field label="模型 ID"><input data-testid="translation-model" value={profile.model} placeholder="从目录选择，或手动填写模型 ID" onChange={event => setModel(event.target.value)} /></Field>
          <div className="translation-consent"><label className="checkbox-label"><input data-testid="translation-consent" type="checkbox" checked={profile.consent} onChange={event => patch({ consent: event.target.checked })} /><span>允许将待翻译文本发送至 <strong>{normalizedEndpoint || '所填服务地址'}</strong>，并确认该服务的数据政策与费用。</span></label><small>仅发送选中的输入和公开输出，不上传完整会话、仓库、SSH 配置或原生账号凭据；更换地址需重新确认。</small></div>
        </section>}
        <p className="inline-note translation-behavior">开启模块即翻译输入和回复；中途消息可在会话顶部切换。已有译文始终保留。</p>
        <RememberedDetails memoryId="TranslationSettings.details.1" className="translation-advanced" data-testid="translation-advanced"><summary>高级设置<span>思考参数与调用预算</span><Icon name="chevron-down" size={15} /></summary>
        {sourceKind==='custom'&&<section className="settings-section">
          <div className="section-heading"><div><h2>翻译模型的思考参数</h2><p>按所选协议发送请求值；模型是否支持，需要依据上游说明确认。</p></div><span className="outline-label">请求配置</span></div>
          <div className="form-grid"><Field label="思考方式"><select data-testid="translation-reasoning-mode" value={reasoning.mode} onChange={event => setReasoningMode(event.target.value as Reasoning['mode'])}><option value="default">服务默认 · 不发送思考参数</option>{anthropic ? <><option value="adaptive">自适应思考 · adaptive</option><option value="budget">手动思考预算 · budget</option></> : <option value="effort">指定思考强度 · effort</option>}</select></Field><Field label="最大输出 tokens（可选）" hint={`未填写时使用 ${DEFAULT_MAX_OUTPUT_TOKENS}；思考预算需小于该值。`}><input data-testid="translation-max-output-tokens" type="number" min={256} max={128000} step={1} value={profile.maxOutputTokens ?? ''} placeholder={`默认 ${DEFAULT_MAX_OUTPUT_TOKENS}`} onChange={event => patch({ maxOutputTokens: event.target.value === '' ? undefined : Number(event.target.value) })} /></Field></div>
          {(reasoning.mode === 'effort' || reasoning.mode === 'adaptive') && <Field label="思考强度" hint="档位来自协议映射，模型可能仅支持其中一部分。"><select data-testid="translation-reasoning-effort" value={reasoning.effort ?? ''} onChange={event => patchReasoning({ effort: event.target.value || undefined, confirmed: false })}>{reasoning.mode === 'adaptive' && <option value="">服务默认强度</option>}{efforts.map(effort => <option key={effort} value={effort}>{effortLabels[effort] ?? effort}</option>)}</select></Field>}
          {reasoning.mode === 'budget' && <Field label="思考预算 tokens" hint="Anthropic 手动预算模式；至少 1024，且小于最大输出 tokens。"><input data-testid="translation-reasoning-budget" type="number" min={1024} max={127999} step={1} required value={reasoning.budgetTokens ?? 1024} onChange={event => patchReasoning({ budgetTokens: Number(event.target.value), confirmed: false })} /></Field>}
          {reasoning.mode !== 'default' && <><p className="translation-reasoning-note">更换服务、协议或模型会重置这项选择。模型目录不能证明思考能力；保存参数也不代表上游已实际采用。</p><label className="checkbox-label translation-reasoning-confirm"><input type="checkbox" required data-testid="translation-reasoning-confirm" checked={reasoning.confirmed === true} onChange={event => patchReasoning({ confirmed: event.target.checked })} /><span>我已确认当前模型支持所选思考方式与档位，并接受可能增加的耗时和费用。</span></label></>}
        </section>}
        <section className="settings-section"><div className="section-heading"><div><h2>可选限制</h2><p>0 表示不限制；取消等待不会撤销上游已产生的用量，也不会自动重试。</p></div></div><div className="form-grid three"><Field label="待译原文字符上限" hint="包含中英文、标点和换行；发送前检查，不截断主模型回复。"><input data-testid="translation-max-characters" type="number" min={0} max={10000000} step={1} value={profile.maxCharacters} onChange={event => patch({ maxCharacters: Number(event.target.value) })} /></Field><Field label="会话内调用上限" hint="0 为不限；每个会话单独计数，达到上限后暂停该会话新的翻译请求。"><input data-testid="translation-max-calls" type="number" min={0} max={1000000} value={profile.maxCalls} onChange={event => patch({ maxCalls: Number(event.target.value) })} /></Field><Field label="等待上限（秒）" hint="0 为不设时限；需要时可临时暂停翻译以取消等待。"><input data-testid="translation-timeout" type="number" min={0} max={86400} value={profile.timeoutMs / 1000} onChange={event => patch({ timeoutMs: Number(event.target.value) * 1000 })} /></Field></div></section>
        </RememberedDetails>
      </fieldset>
      {saveError && <div className="inline-error" data-testid="translation-save-error" role="alert">{saveError==='TRANSLATION_SETTINGS_CHANGED'?'设置已在其他位置更新；请重新读取后保存。':saveError}{saveError==='TRANSLATION_SETTINGS_CHANGED'&&<button type="button" className="text-button" onClick={()=>{setProfile(copyProfile(state.translation));setSaveError('');}}>重新读取</button>}</div>}
      <div className="settings-save"><small>{changed ? '有尚未保存的设置' : '所有更改已保存'} · 保存不会启动付费测试</small><button data-testid="save-translation" className="button primary" disabled={saving || loadingModels || !changed}>{saving ? '保存中…' : '保存翻译设置'}</button></div>
    </form>
    <section className="translation-usage" data-workbench-translation-usage><ModelUsageSummary scope={{kind:'translation',id:'translation'}} refreshKey={modelUsageRevision(state,{kind:'translation',id:'translation'})}/><small>仅统计翻译请求，与主会话分开；按已收到的回执累计。</small>{usageWarning&&<p role="alert" className="inline-error">部分翻译用量尚未写入磁盘，当前仅保存在内存中。请检查存储空间和写入权限；不要为补统计重新翻译。</p>}</section>
  </div>;
}
