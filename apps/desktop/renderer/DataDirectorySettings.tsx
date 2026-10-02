import {useEffect,useState} from 'react';
import {api} from './App';
import {Icon,errorText} from './ui';

interface Location {directory:string;testOverride:boolean;canMigrate:boolean;preferred:string}
const errors:Record<string,string>={APP_DATA_RELOCATION_UNAVAILABLE:'安装版工作台才能更换资料位置。',APP_DATA_TASKS_ACTIVE:'请等待运行中或结果未确认的任务结束后再迁移。',APP_DATA_DESTINATION_CONFLICT:'目标目录已有内容，请选择新的空目录。',APP_DATA_PATH_INVALID:'请选择有效的独立目录。',APP_DATA_PATH_LINK:'目标路径包含链接目录，请选择普通目录。'};
export default function DataDirectorySettings(){
 const [location,setLocation]=useState<Location>(),[target,setTarget]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{void api<Location>('desktop/data-directory').then(value=>{setLocation(value);if(value.preferred!==value.directory)setTarget(value.preferred);}).catch(failure=>setError(errorText(failure)));},[]);
 const choose=async()=>{try{const value=await api<string|null>('desktop/data-directory/choose');if(value)setTarget(value);}catch(failure){setError(errorText(failure));}};
 const migrate=async()=>{if(!target||busy)return;setBusy(true);setError('');try{await api('desktop/data-directory/migrate',{target});}catch(failure){const message=errorText(failure);setError(Object.entries(errors).find(([code])=>message.includes(code))?.[1]??message);setBusy(false);}};
 return <section className="settings-section" data-testid="data-directory-settings" data-workbench-data-directory-settings><h2>工作台资料位置</h2><div className="settings-card"><div className="settings-action-row"><span style={{minWidth:0}}><strong>当前目录</strong><small style={{overflowWrap:'anywhere'}}>{location?.directory??'读取中…'}</small></span></div><div className="settings-action-row"><span style={{minWidth:0}}><strong>迁移到</strong><small style={{overflowWrap:'anywhere'}}>{target||'请选择目标目录'}</small></span><button aria-label="选择工作台资料目录" title="选择位置" onClick={()=>void choose()} disabled={!location||!location.canMigrate||busy}><Icon name="folder" size={16}/></button></div><div className="settings-action-row"><span><strong>迁移资料并重启</strong><small>会话、托管工作空间、附件和偏好将迁移；外部项目保持原位。</small></span><button onClick={()=>void migrate()} disabled={!target||busy||!location?.canMigrate}>迁移并重启</button></div></div>{error&&<p role="alert" className="inline-error">{error}</p>}</section>;
}
