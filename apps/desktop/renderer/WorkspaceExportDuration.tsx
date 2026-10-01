import {workspaceExportDurations} from '../../../packages/workspace-control/export-policy';
import {Field} from './ui';

/** Transaction input: reset to 1h for each new authorization, never a saved preference. */
export default function WorkspaceExportDuration({value,onChange,disabled=false}:{value:number;onChange:(seconds:number)=>void;disabled?:boolean}){
 return <div data-workbench-workspace-export-duration><Field label="文件有效期"><select data-testid="workspace-export-duration" value={value} disabled={disabled} onChange={event=>onChange(Number(event.target.value))}>{workspaceExportDurations.map(option=><option key={option.seconds} value={option.seconds}>{option.label}</option>)}</select></Field><p className="inline-note">从服务器签发时开始计时，不受两端设备的时区或时钟偏差影响。到期或成功授权一台设备后，文件立即失效；已授权设备不受此期限影响。</p></div>;
}
