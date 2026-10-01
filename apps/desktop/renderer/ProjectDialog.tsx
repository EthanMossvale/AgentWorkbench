import { Icon, Modal } from './ui';
import './ProjectDialog.css';

interface Props {
  editing:boolean; builtin?:boolean; name:string; paths:string[]; saving:boolean; picking:boolean;
  onName:(name:string)=>void; onPaths:(paths:string[])=>void; onAdd:()=>void;
  onClose:()=>void; onSave:()=>void; onRemove:()=>void;
}
const folderName=(path:string)=>path.replace(/[\\/]+$/,'').split(/[\\/]/).at(-1) || path;

export default function ProjectDialog({editing,builtin,name,paths,saving,picking,onName,onPaths,onAdd,onClose,onSave,onRemove}:Props) {
  return <Modal title={editing?'编辑项目':'创建项目'} className="project-dialog" onClose={onClose}>
    <form onSubmit={event=>{event.preventDefault();onSave();}}>
      <label className="project-name-field"><Icon name="folder" size={17}/><input autoFocus data-autofocus required aria-label="项目名称" data-testid="project-name" value={name} onChange={event=>onName(event.target.value)} placeholder="项目名称" disabled={saving}/></label>
      <div className="project-sources-label">源文件夹</div>
      <div className={`project-sources ${paths.length?'':'is-empty'}`}>
        {paths.length ? <>
          <div className="project-sources-list">{paths.map((path,index)=><div className="project-folder-row managed-folder" key={path} data-primary={index===0}>
            <Icon name="folder" size={17}/><div className="project-folder-name" title={path}><span>{folderName(path)}</span></div>
            {index===0?<span className="project-primary-badge">主要</span>:<button type="button" className="project-make-primary" aria-label={`设为主文件夹 ${path}`} disabled={saving} onClick={()=>onPaths([path,...paths.filter(item=>item!==path)])}>设为主要</button>}
            <button type="button" className="icon-button" aria-label={`移除文件夹 ${path}`} disabled={saving} onClick={()=>onPaths(paths.filter(item=>item!==path))}><Icon name="close" size={14}/></button>
          </div>)}</div>
          <button type="button" className="project-add-source" data-testid="project-add-folders" disabled={saving||picking} onClick={onAdd}><Icon name="plus" size={16}/>{picking?'正在选择…':'添加文件夹'}</button>
        </>:<div className="project-sources-empty"><span>在此电脑上添加文件夹</span><button type="button" data-testid="project-add-folders" disabled={saving||picking} onClick={onAdd}><Icon name="plus" size={15}/>{picking?'正在选择…':'添加'}</button></div>}
      </div>
      <div className="project-dialog-actions">
        {editing&&<button type="button" className="project-remove" disabled={saving} onClick={onRemove}>移除本地项目</button>}
        <button type="button" className="project-cancel" disabled={saving} onClick={onClose}>取消</button>
        <button type="submit" className="project-save" data-testid="save-dialog" disabled={saving||picking||!name.trim()||(!builtin&&!paths.length)}>{saving?'保存中…':editing?'保存':'创建项目'}</button>
      </div>
    </form>
  </Modal>;
}
