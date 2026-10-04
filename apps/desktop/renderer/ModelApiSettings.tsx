import {useUiPreference} from './ui-preferences';
import { modelUsageRevision } from '../../../packages/model-management/usage';
import { useState } from 'react';
import type { AppState, Protocol } from '../../../packages/contracts';
import type { ApiModel, ModelConnection } from '../../../packages/model-api/types';
import { nativeContextSettings } from '../../../packages/model-api/native-context';
import { isEmptyModelDraft, normalizeModelApiUrl, retainManualModelSettings } from '../../../packages/model-api/settings';
import { api } from './App';
import { Icon, Modal, Toggle, errorText } from './ui';
import './ModelApiSettings.css';
import LocalModelAccounts from './LocalModelAccounts';
import ModelUsageSummary from './ModelUsageSummary';
import ReasoningOptions from './ReasoningOptions';
import { availableReasoningEfforts, mergeReasoning, reasoningStatus } from '../../../packages/model-api/reasoning-info';

type Draft = Pick<ModelConnection, 'name' | 'baseUrl' | 'protocol' | 'models'> & { modelsUrl: string };
const empty = (): Draft => ({ name: '', baseUrl: '', modelsUrl: '', protocol: 'chat-completions', models: [] });
const protocols: Record<Protocol, string> = { 'chat-completions': 'Chat Completions', responses: 'Responses', 'anthropic-messages': 'Anthropic Messages' };
const capabilities = (model: ApiModel) => [model.contextWindow ? model.contextWindow.toLocaleString() + ' 上下文' : '', availableReasoningEfforts(model).length ? availableReasoningEfforts(model).length + ' 个思考档位' : ''].filter(Boolean).join(' · ');
function withDirectory(models: ApiModel[], directory: ApiModel[]) {
  return models.map(model => {
    const known = directory.find(item => item.model === model.model);
    return known && model.metadataSource !== 'manual' ? { ...known, ...mergeReasoning(model,known), id: model.id, model: model.model, name: model.name, enabled: model.enabled, ...(model.contextWindowSource==='manual'?{contextWindow:model.contextWindow,contextWindowSource:'manual' as const}:{}) } : model;
  });
}

export default function ModelApiSettings({ state, refresh, notify }: { state: AppState; refresh: () => Promise<unknown>; notify: (text: string) => void }) {
  const [editing, setEditing] = useState<ModelConnection | null | undefined>();
  const [draft, setDraft] = useState<Draft>(empty), [key, setKey] = useState<string | undefined>('');
  const [directory, setDirectory] = useState<ApiModel[]>([]), [busy, setBusy] = useState<'save' | 'discover' | 'change' | null>(null);
  const [error, setError] = useState(''), [search, setSearch] = useState(''), [mapping, setMapping] = useState<string>();
  const [deleting, setDeleting] = useState<ModelConnection | null>(null);
  const [expanded, setExpanded] = useUiPreference<string[]>('models.expanded','api');
  const open = (connection: ModelConnection | null) => {
    setEditing(connection); setDraft(connection ? { name: connection.name, baseUrl: connection.baseUrl, modelsUrl: connection.modelsUrl ?? '', protocol: connection.protocol, models: connection.models } : empty());
    setDirectory(connection?.discoveredModels ?? []); setKey(connection ? undefined : ''); setError(''); setSearch(''); setMapping(undefined);
  };
  const payload = () => ({ id: editing?.id, revision: editing?.revision, connection: { ...draft, baseUrl: normalizeModelApiUrl(draft.baseUrl), modelsUrl: draft.modelsUrl.trim() ? normalizeModelApiUrl(draft.modelsUrl) : undefined, models: draft.models.filter(model => !isEmptyModelDraft(model)) }, ...(key !== undefined ? { key } : {}) });
  const save = async () => {
    if (busy) return; setBusy('save'); setError('');
    try {
      const saved = await api<ModelConnection>('model-api/save', payload());
      setDraft({ ...saved, modelsUrl: saved.modelsUrl ?? '' }); setKey(undefined); setDirectory(saved.discoveredModels); await refresh();
      setEditing(undefined);
      notify('连接已保存');
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const discover = async () => {
    if (busy) return; setBusy('discover'); setError('');
    try {
      const request = payload();
      const models = await api<ApiModel[]>('model-api/discover', { ...request, connection: { ...request.connection, name: draft.name || '模型连接', models: [] } });
      setDirectory(models); setDraft(previous => ({ ...previous, baseUrl: request.connection.baseUrl, modelsUrl: request.connection.modelsUrl ?? '', models: withDirectory(previous.models, models) }));
      if (!models.length) setError('服务返回了空目录，可手动添加模型。');
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const remove = async () => {
    if (!deleting || busy) return; setBusy('change');
    try { await api('model-api/delete', { id: deleting.id, revision: deleting.revision, confirm: true }); await refresh(); setDeleting(null); notify('已移除连接，会话历史仍然保留'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const toggle = async (connection: ModelConnection, enabled: boolean) => {
    if (busy) return; setBusy('change'); setError('');
    try { await api('model-api/set-enabled', { id: connection.id, revision: connection.revision, enabled }); await refresh(); notify(enabled ? '已开启，会话和 Subagent 可使用此连接' : '已关闭，会话和 Subagent 不再使用此连接'); }
    catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const editModel = (model: ApiModel, patch: Partial<ApiModel>) => setDraft(previous => ({ ...previous, models: previous.models.some(item => item.id === model.id) ? previous.models.map(item => item.id === model.id ? { ...item, ...patch } : item) : [...previous.models, { ...model, ...patch }] }));
  const manualReasoning=(model:ApiModel,levels?:string[])=>{
    const known=directory.find(item=>item.model===model.model);
    const updated={...model,manualEfforts:levels,effortCandidates:undefined,...(!levels?{efforts:known?.efforts}: {})};
    const efforts=availableReasoningEfforts(updated);
    editModel(model,{manualEfforts:levels,effortCandidates:undefined,efforts:efforts.length?efforts:undefined,defaultEffort:efforts.includes(model.defaultEffort??'')?model.defaultEffort:efforts.includes('medium')?'medium':efforts[0]});
  };
  const changeSource = (patch: Partial<Draft>) => {
    setDirectory([]); setError('');
    setDraft(previous => ({ ...previous, ...patch, models: previous.models.map(retainManualModelSettings) }));
  };
  const changeUpstream = (model: ApiModel, id: string) => {
    const known = directory.find(item => item.model === id);
    editModel(model, withDirectory([{ ...retainManualModelSettings(model), model: id }], known ? [known] : [])[0]!);
  };
  const addMapping = () => {
    const id = crypto.randomUUID(); setSearch(''); setMapping(id);
    setDraft(previous => ({ ...previous, models: [{ id, name: '', model: '', enabled: true }, ...previous.models] }));
  };
  const removeMapping = (id: string) => {
    setDraft(previous => ({ ...previous, models: previous.models.filter(model => model.id !== id) }));
    setDirectory(previous => previous.filter(model => model.id !== id));
    setMapping(previous => previous === id ? undefined : previous); setError('');
  };
  const completeUrl = (field: 'baseUrl' | 'modelsUrl') => {
    if (!draft[field].trim()) return;
    try { const value = normalizeModelApiUrl(draft[field]); setDraft(previous => ({ ...previous, [field]: value })); }
    catch { /* Incomplete input is validated on discovery or save. */ }
  };
  const directoryIds = new Set(directory.map(model => model.id));
  const edits = new Map(draft.models.map(model => [model.id, model]));
  const all = [...draft.models.filter(model => !directoryIds.has(model.id)), ...directory.map(model => edits.get(model.id) ?? model)];
  const visible = all.filter(model => (model.name + ' ' + model.model).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selectable = all.filter(model => !isEmptyModelDraft(model));
  const allSelected = selectable.length > 0 && selectable.every(model => model.enabled);
  const selected = draft.models.filter(item => item.enabled && !isEmptyModelDraft(item)).length;
  const toggleAll = () => setDraft(previous => ({ ...previous, models: all.map(model => isEmptyModelDraft(model) ? model : { ...model, enabled: !allSelected }) }));

  return <section className="settings-section model-api-settings" data-testid="model-api-settings">
    <div className="model-api-heading"><h2>API</h2><button className="text-button" data-testid="model-api-add" onClick={() => open(null)}><Icon name="plus" size={14} />添加连接</button></div>
    {error && editing === undefined && !deleting && <p className="model-api-error" role="alert">{error}</p>}
    <div className="model-api-connections">{(state.modelConnections ?? []).map(connection => <article className="model-api-source" key={connection.id} data-testid={'model-api-' + connection.id}>
      <div className="model-api-source-row"><button type="button" className="model-row-disclosure" aria-label={'展开 '+connection.name} aria-expanded={expanded.includes(connection.id)} onClick={()=>setExpanded(old=>old.includes(connection.id)?old.filter(id=>id!==connection.id):[...old,connection.id])}><Icon name="chevron" size={13}/><span><strong>{connection.name}</strong><small>{new URL(connection.baseUrl).host} · {connection.models.filter(model => model.enabled).length} 个模型</small>{connection.discoveryError && <small className="model-api-source-warning" title={connection.discoveryError}>模型目录暂未读取</small>}</span></button>
      <button className="text-button" disabled={!!busy} onClick={() => open(connection)}>编辑</button><button className="icon-button" disabled={!!busy} aria-label={'删除 ' + connection.name} onClick={() => { setError(''); setDeleting(connection); }}><Icon name="trash" size={15} /></button>
      <fieldset className="model-api-toggle resource-fieldset" disabled={!!busy}><Toggle label={'启用 ' + connection.name} checked={connection.enabled !== false} onChange={enabled => void toggle(connection, enabled)} /></fieldset></div>
      {expanded.includes(connection.id)&&<ModelUsageSummary scope={{kind:'api',id:connection.id}} refreshKey={modelUsageRevision(state,{kind:'api',id:connection.id})}/>}
    </article>)}</div>
    {!state.modelConnections?.length && <div className="model-api-empty"><Icon name="sparkle" size={23} /><p>从一个连接开始。</p><small>支持兼容接口与本地服务。</small></div>}
    <LocalModelAccounts state={state} refresh={refresh} notify={notify}/>
    {editing !== undefined && <Modal title={editing ? '编辑模型连接' : '添加模型连接'} subtitle="接入一个来源，选好常用的模型。" onClose={() => { if (!busy) setEditing(undefined); }} className="model-api-modal" dismissible={!busy}>
      <div className="model-api-editor" data-testid="model-api-editor"><div className="model-api-scroll"><fieldset disabled={!!busy}>
        <div className="model-api-fields">
          <label>连接名称<input data-autofocus aria-label="连接名称" placeholder="例如：我的书房" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>接口协议<select aria-label="接口协议" value={draft.protocol} onChange={e => changeSource({ protocol: e.target.value as Protocol })}>{Object.entries(protocols).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <label>API 地址<input aria-label="API 地址" placeholder="https://example.com/v1" spellCheck={false} value={draft.baseUrl} onChange={e => changeSource({ baseUrl: e.target.value })} onBlur={() => completeUrl('baseUrl')} /></label>
        <label className="model-api-models-url"><span>模型列表地址<small>选填</small></span><input aria-label="模型列表地址" placeholder="留空则从 API 地址读取模型" spellCheck={false} value={draft.modelsUrl} onChange={e => changeSource({ modelsUrl: e.target.value })} onBlur={() => completeUrl('modelsUrl')} /></label>
        <label className="model-api-key"><span>API 密钥<small>{editing?.hasKey && key === undefined ? '已加密保存' : '选填'}</small></span><span className="model-api-key-input"><input type="password" autoComplete="new-password" aria-label="API 密钥" placeholder={editing?.hasKey && key === undefined ? '已保存，填写可替换' : '粘贴 API Key'} value={key ?? ''} onChange={e => setKey(e.target.value)} />{editing?.hasKey && key === undefined && <button type="button" className="text-button" onClick={() => setKey('')}>清除</button>}{editing?.hasKey && key !== undefined && <button type="button" className="text-button" onClick={() => setKey(undefined)}>保留原密钥</button>}</span></label>
        <section className="model-api-catalog" aria-label="可用模型">
          <div className="model-api-heading"><h3>选择模型{selected > 0 && <small>{selected} 已选</small>}</h3><div className="model-api-catalog-actions">{selectable.length > 0 && <button type="button" className="text-button" data-testid="model-api-select-all" title="切换此连接的全部模型，包括搜索范围外的模型" onClick={toggleAll}>{allSelected ? '取消全选' : '全选'}</button>}<button type="button" className="text-button" data-testid="model-api-discover" onClick={discover}><Icon name="refresh" size={13} />{busy === 'discover' ? '读取中…' : directory.length ? '刷新模型' : '读取模型'}</button></div></div>
          {all.length > 0 ? <>
            <div className="model-api-search"><Icon name="search" size={14} /><input aria-label="搜索模型" placeholder="搜索名称或模型 ID" value={search} onChange={e => setSearch(e.target.value)} /></div>
            <div className="model-api-models">{visible.slice(0, 100).map(model => <div className={'model-api-model' + (model.enabled ? ' selected' : '')} key={model.id}>
              <div className="model-api-model-row"><label className="model-api-choice"><input type="checkbox" aria-label={'使用 ' + (model.name || model.model || '新映射')} checked={model.enabled} onChange={e => editModel(model, { enabled: e.target.checked })} /><span><strong>{model.name || model.model || '新映射'}</strong>{model.model && model.name !== model.model && <small>{model.model}</small>}{capabilities(model) && <small>{capabilities(model)}</small>}{model.enabled&&<small className="model-probe-state">{reasoningStatus(model)}</small>}</span></label><button type="button" className="text-button model-api-mapping-button" aria-label={'编辑映射 ' + model.id} aria-expanded={mapping === model.id} onClick={() => setMapping(mapping === model.id ? undefined : model.id)}>{mapping === model.id ? '收起' : '详情'}</button>{!directory.some(item => item.id === model.id) && <button type="button" className="icon-button model-api-remove-mapping" aria-label={'移除模型 ' + (model.name || model.model || '新映射')} title="移除映射" onClick={() => removeMapping(model.id)}><Icon name="trash" size={14} /></button>}</div>
              {mapping === model.id && <div className="model-api-mapping"><div className="model-api-fields"><label>显示名称<input aria-label={'模型名称 ' + model.id} placeholder="留空使用上游模型 ID" value={model.name} onChange={e => editModel(model, { name: e.target.value })} /></label><label>上游模型 ID<input aria-label={'上游模型 ' + model.id} placeholder="服务提供的模型 ID" spellCheck={false} value={model.model} onChange={e => changeUpstream(model, e.target.value)} /></label></div><div className="model-api-fields"><label>上下文上限（tokens）<input type="number" min={1} max={100000000} step={1} aria-label={'上下文上限 '+model.id} placeholder="上游未提供时，可按模型文档填写" value={model.contextWindow??''} onChange={e=>editModel(model,{contextWindow:e.target.value===''?undefined:Number(e.target.value),contextWindowSource:e.target.value===''?undefined:'manual'})}/></label><label>自动压缩预算（90%）<input aria-label={'自动压缩预算 '+model.id} readOnly value={nativeContextSettings(model)?.compactAt??''} placeholder="待填写上下文上限" /></label></div><p className="model-api-note">按上限的 90% 自动计算，保存后用于新启动的原生会话。原生安全预留可能让压缩更早触发，90% 不代表精确触发点。容量留空表示未知。</p><ReasoningOptions model={model} onManual={levels=>manualReasoning(model,levels)} onDefault={effort=>editModel(model,{defaultEffort:effort})}/><div className="model-api-mapping-actions"><button type="button" className="text-button" onClick={() => removeMapping(model.id)}>移除映射</button><button className="text-button" onClick={() => setMapping(undefined)}>完成</button></div></div>}
            </div>)}</div>
            {!visible.length && <p className="model-api-note model-api-no-results">没有匹配的模型</p>}
            {visible.length > 100 && <p className="model-api-note">显示前 100 项，可搜索更多模型。</p>}
          </> : <div className="model-api-catalog-empty"><Icon name="sparkle" size={20} /><p>把常用的模型，请到这里。</p><small>填写地址与密钥后读取，也可手动添加。</small></div>}
          <button className="text-button model-api-add-mapping" data-testid="model-api-add-mapping" onClick={addMapping}><Icon name="plus" size={13} />手动添加模型</button>
        </section>
      </fieldset></div>
        {error && <p className="model-api-error" role="alert">{error}</p>}
        <div className="model-api-probe-notice"><p className="model-api-note">档位来自模型目录或手动配置；读取和保存不发送推理请求。</p></div><footer className="model-api-editor-footer"><small>{selected ? selected + ' 个模型可用于会话与子任务' : '可稍后继续添加模型'}</small><div><button className="button secondary" disabled={!!busy} onClick={() => setEditing(undefined)}>取消</button><button className="button primary" data-testid="model-api-save" disabled={!!busy} onClick={save}>{busy === 'save' ? '保存中…' : '保存连接'}</button></div></footer>
      </div>
    </Modal>}
    {deleting && <Modal title="删除模型连接" onClose={() => { if (!busy) setDeleting(null); }} dismissible={!busy}><p>删除「{deleting.name}」及其密钥？会话历史保留，之后可选择其他模型继续。</p>{error && <p role="alert">{error}</p>}<footer className="modal-actions"><button className="button secondary" disabled={!!busy} onClick={() => setDeleting(null)}>取消</button><button className="button danger" disabled={!!busy} onClick={remove}>确认删除</button></footer></Modal>}
  </section>;
}
