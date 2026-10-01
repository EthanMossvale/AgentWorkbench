import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import {scanCheckout,createArchive,readArchive,type WorktreeArchive} from './archive';

const execute = promisify(execFile);
export interface WorktreeRecord {
  id: string; path: string; cwd: string; sourceDirectory: string; repositoryRoot: string;
  head: string; createdAt: string; status: 'ready' | 'failed' | 'missing' | 'archived';
  lastUsedAt?:string; archive?:WorktreeArchive; archiveError?:string;
  copiedTrackedChanges: boolean; copiedUntrackedFiles: number;
}
export interface WorktreeInspection {
  available: boolean; reason?: string; repositoryRoot?: string; cwd?: string; head?: string;
  branch?: string; dirty?: boolean; untrackedFiles?: number;
}
interface Snapshot { staged: Buffer; unstaged: Buffer; untracked: {name: string; data: Buffer}[]; digest: string }
interface Saved { version: 1; root?: string; autoDelete?:boolean; limit?:number; records: WorktreeRecord[] }
const contained = (root: string, target: string) => { const relative = path.relative(root,target); return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..'+path.sep)); };
const hash = (...values: (string | Buffer)[]) => { const h=createHash('sha256'); for(const value of values){h.update(String(Buffer.byteLength(value)));h.update(':');h.update(value);} return h.digest('hex'); };

/** Local Git only. Creation never fetches, commits, changes source HEAD or runs a model. */
export class WorktreeService {
  private loaded?: Promise<void>;
  private saved: Saved = {version:1,records:[]};
  private busy = false;
  constructor(private directory: string) {}
  private load() { return this.loaded ??= (async()=>{
    try { const saved=JSON.parse(await readFile(path.join(this.directory,'worktree-state.json'),'utf8')); if(saved.version!==1||!Array.isArray(saved.records))throw Error('WORKTREE_STATE_INVALID');this.saved=saved; }
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  })(); }
  private async save() { await mkdir(this.directory,{recursive:true});const file=path.join(this.directory,'worktree-state.json'),temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(this.saved,null,2));await rename(temp,file); }
  private git(cwd: string, args: string[], input?: Buffer): Promise<Buffer> {
    const env:NodeJS.ProcessEnv={...process.env,GIT_TERMINAL_PROMPT:'0'};
    for(const key of Object.keys(env))if(/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*)$/.test(key))delete env[key];
    const command=['--no-pager','-c','core.hooksPath='+path.join(this.directory,'disabled-hooks'),...args];
    if(!input)return execute('git',command,{cwd,env,encoding:'buffer',maxBuffer:64*1024*1024,timeout:120000,windowsHide:true}).then(result=>result.stdout);
    return new Promise((resolve,reject)=>{
      const child=execFile('git',command,{cwd,env,encoding:'buffer',maxBuffer:64*1024*1024,timeout:120000,windowsHide:true},(error,stdout)=>error?reject(error):resolve(stdout));
      child.stdin?.on('error',()=>{});child.stdin?.end(input);
    });
  }
  async inspect(directory: string): Promise<WorktreeInspection> {
    if(!directory||!path.isAbsolute(directory))return {available:false,reason:'请先选择本机 Git 项目目录。'};
    let reason='当前会话目录不存在或不可读取，请检查绑定的本机工作目录。';
    let repositoryRoot:string|undefined;
    try {
      const cwd=await realpath(directory);
      reason='当前会话目录不在 Git 仓库中；请选择 Git 项目后再创建工作树。';
      repositoryRoot=await realpath((await this.git(cwd,['rev-parse','--show-toplevel'])).toString().trim());
      if(!contained(repositoryRoot,cwd))return {available:false,reason:'会话目录不在 Git 工作区内。'};
      reason='此 Git 仓库尚无提交，请先创建首个提交后再使用工作树。';
      const head=(await this.git(cwd,['rev-parse','--verify','HEAD'])).toString().trim();
      reason='无法读取 Git 工作区状态，请检查仓库和文件权限。';
      if((await this.git(cwd,['ls-files','--unmerged','-z'])).length)return {available:false,repositoryRoot,reason:'请先解决 Git 合并冲突，再创建工作树。'};
      if((await this.git(cwd,['ls-files','--stage'])).toString().split('\n').some(line=>line.startsWith('160000 ')))return {available:false,repositoryRoot,reason:'此版本尚不支持复制含子模块的工作树。'};
      const branch=(await this.git(cwd,['branch','--show-current'])).toString().trim();
      const dirty=(await this.git(cwd,['status','--porcelain=v1','-z'])).length>0;
      const untrackedFiles=(await this.git(repositoryRoot,['ls-files','--others','--exclude-standard','-z'])).toString().split('\0').filter(Boolean).length;
      return {available:true,cwd,repositoryRoot,head,branch,dirty,untrackedFiles};
    }catch(error){return {available:false,...(repositoryRoot?{repositoryRoot}:{}),reason:(error as NodeJS.ErrnoException).code==='ENOENT'&&String((error as Error).message).includes('spawn git')?'未找到 Git，请安装 Git 后重试。':reason};}
  }
  async list() {
    await this.load();
    const records=await Promise.all(this.saved.records.map(async item=>{if(item.status==='archived')return {...item};try{await access(path.join(item.path,'.git'));return {...item};}catch{return {...item,status:item.archive?'archived' as const:'missing' as const};}}));
    return {root:this.saved.root??path.join(this.directory,'worktrees'),defaultRoot:path.join(this.directory,'worktrees'),autoDelete:this.saved.autoDelete??false,limit:this.saved.limit??15,records};
  }
  async configure(root?: string,settings:{autoDelete?:boolean;limit?:number}={}) {
    await this.load();if(this.busy)throw Error('WORKTREE_BUSY');
    if(root!==undefined&&(!path.isAbsolute(root)||root.includes('\0')))throw Error('WORKTREE_ROOT_INVALID');
    if(root&&path.resolve(root)!==path.join(this.directory,'worktrees')&&contained(this.directory,path.resolve(root)))throw Error('WORKTREE_ROOT_IS_CONTROL_DIRECTORY');
    if(settings.autoDelete!==undefined&&typeof settings.autoDelete!=='boolean'||settings.limit!==undefined&&(!Number.isSafeInteger(settings.limit)||settings.limit<1||settings.limit>100))throw Error('WORKTREE_SETTINGS_INVALID');
    this.saved.root=root?path.resolve(root):undefined;if(settings.autoDelete!==undefined)this.saved.autoDelete=settings.autoDelete;if(settings.limit!==undefined)this.saved.limit=settings.limit;await this.save();return this.list();
  }
  async validate(record: WorktreeRecord) {
    await this.load();
    const owned=this.saved.records.find(item=>item.id===record.id&&item.path===record.path&&item.cwd===record.cwd&&item.status==='ready');
    if(!owned)throw Error('WORKTREE_UNAVAILABLE');
    try{
      const root=await realpath(owned.path),cwd=await realpath(owned.cwd);
      const gitRoot=await realpath((await this.git(cwd,['rev-parse','--show-toplevel'])).toString().trim());
      const expected=await realpath((await this.git(owned.repositoryRoot,['rev-parse','--path-format=absolute','--git-common-dir'])).toString().trim()),actual=await realpath((await this.git(root,['rev-parse','--path-format=absolute','--git-common-dir'])).toString().trim());
      const registered=(await this.git(owned.repositoryRoot,['worktree','list','--porcelain','-z'])).toString().split('\0').filter(v=>v.startsWith('worktree '));
      if(!contained(root,cwd)||root!==gitRoot||expected!==actual||!await Promise.all(registered.map(async value=>realpath(value.slice(9)).catch(()=>''))).then(values=>values.includes(root)))throw Error('WORKTREE_IDENTITY_CHANGED');
    }catch{throw Error('WORKTREE_UNAVAILABLE: The managed checkout is missing or changed; no directory was recreated.');}
  }
  private async snapshot(root: string): Promise<Snapshot> {
    const staged=await this.git(root,['diff','--cached','--binary','--no-ext-diff','--no-textconv','HEAD','--']);
    const unstaged=await this.git(root,['diff','--binary','--no-ext-diff','--no-textconv','--']);
    const names=(await this.git(root,['ls-files','--others','--exclude-standard','-z'])).toString().split('\0').filter(Boolean).sort();
    const untracked:Snapshot['untracked']=[];let bytes=staged.length+unstaged.length;
    if(names.length>10000)throw Error('WORKTREE_TOO_MANY_FILES');
    for(const name of names){
      const file=path.resolve(root,name);if(!contained(root,file)||name.split(/[\\/]/).includes('.git'))throw Error('WORKTREE_UNSAFE_PATH');
      for(let current=file;current!==root;current=path.dirname(current)){const stat=await lstat(current);if(stat.isSymbolicLink())throw Error('WORKTREE_UNTRACKED_SYMLINK');}
      const stat=await lstat(file);if(!stat.isFile()||stat.size>32*1024*1024)throw Error('WORKTREE_UNSUPPORTED_UNTRACKED_FILE');
      bytes+=stat.size;if(bytes>128*1024*1024)throw Error('WORKTREE_SNAPSHOT_TOO_LARGE');
      untracked.push({name,data:await readFile(file)});
    }
    return {staged,unstaged,untracked,digest:hash(staged,unstaged,...untracked.flatMap(file=>[file.name,file.data]))};
  }
  async create(sourceDirectory: string): Promise<WorktreeRecord> {
    await this.load();if(this.busy)throw Error('WORKTREE_BUSY');this.busy=true;
    let record:WorktreeRecord|undefined,created=false;
    try {
      const info=await this.inspect(sourceDirectory);if(!info.available)throw Error(info.reason);
      const source=info.repositoryRoot!,head=info.head!,snapshot=await this.snapshot(source);
      const root=this.saved.root??path.join(this.directory,'worktrees');await mkdir(root,{recursive:true});const resolvedRoot=await realpath(root);
      if(contained(source,resolvedRoot)||contained(this.directory,resolvedRoot)&&resolvedRoot!==await realpath(path.join(this.directory,'worktrees')).catch(()=>''))throw Error('WORKTREE_ROOT_MUST_BE_OUTSIDE_REPOSITORY');
      const id=randomUUID(),target=path.join(resolvedRoot,id),cwd=path.join(target,path.relative(source,info.cwd!));
      record={id,path:target,cwd,sourceDirectory:info.cwd!,repositoryRoot:source,head,createdAt:new Date().toISOString(),status:'failed',copiedTrackedChanges:!!(snapshot.staged.length||snapshot.unstaged.length),copiedUntrackedFiles:snapshot.untracked.length};
      this.saved.records.push(record);await this.save();
      await this.git(source,['worktree','add','--detach',target,head]);created=true;
      if(snapshot.staged.length)await this.git(target,['apply','--binary','--index','--whitespace=nowarn','-'],snapshot.staged);
      if(snapshot.unstaged.length)await this.git(target,['apply','--binary','--whitespace=nowarn','-'],snapshot.unstaged);
      for(const file of snapshot.untracked){const destination=path.join(target,file.name);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,file.data,{flag:'wx'});}
      await mkdir(cwd,{recursive:true});
      if((await this.git(source,['rev-parse','HEAD'])).toString().trim()!==head||(await this.snapshot(source)).digest!==snapshot.digest)throw Error('WORKTREE_SOURCE_CHANGED');
      // Compare checkout bytes through Git's normalization, including staged state.
      if((await this.snapshot(target)).digest!==snapshot.digest)throw Error('WORKTREE_COPY_VERIFICATION_FAILED');
      record.status='ready';await this.save();return {...record};
    }catch(error){
      if(record&&created){try{await this.git(record.repositoryRoot,['worktree','remove',record.path]);this.saved.records=this.saved.records.filter(item=>item.id!==record!.id);await this.save();}catch{/* Dirty or externally changed copies are retained for recovery, never forced away. */}}
      throw error;
    }finally{this.busy=false;}
  }
  /** Failed session persistence releases only a clean checkout; changed files are retained. */
  async abandon(record: WorktreeRecord) {
    await this.load();const owned=this.saved.records.find(item=>item.id===record.id&&item.path===record.path);if(!owned)return;
    try{await this.git(owned.repositoryRoot,['worktree','remove',owned.path]);this.saved.records=this.saved.records.filter(item=>item.id!==owned.id);}
    catch{owned.status='failed';}
    await this.save();
  }
  async touch(id:string){await this.load();if(this.busy)return;const record=this.saved.records.find(r=>r.id===id);if(record?.status==='ready'){record.lastUsedAt=new Date().toISOString();await this.save();}}
  /** Keep the newest N active checkouts; protected IDs are never archived. Failed snapshots retain files. */
  async cleanup(protectedIds:string[]=[],protectedNow:(id:string)=>boolean=()=>false){
    await this.load();if(this.busy)throw Error('WORKTREE_BUSY');if(!this.saved.autoDelete)return {archived:[],failed:[]};this.busy=true;
    const archived:string[]=[],failed:{id:string;code:string}[]=[];
    try{const active=(await this.list()).records.filter(r=>r.status==='ready'),target=Math.max(0,active.length-(this.saved.limit??15));
      for(const candidate of active.filter(r=>!protectedIds.includes(r.id)).sort((a,b)=>(a.lastUsedAt??a.createdAt).localeCompare(b.lastUsedAt??b.createdAt))){
        if(archived.length>=target)break;if(protectedNow(candidate.id))continue;const record=this.saved.records.find(r=>r.id===candidate.id)!;
        try{
          await this.validate(record);
          if((await this.git(record.path,['ls-files','--stage'])).toString().split('\n').some(line=>line.startsWith('160000 '))||(await this.git(record.path,['ls-files','--unmerged'])).length||(await this.git(record.path,['ls-files','-v'])).toString().split('\n').some(line=>/^[a-zS] /.test(line)))throw Error('WORKTREE_ARCHIVE_UNSUPPORTED_INDEX');
          const head=(await this.git(record.path,['rev-parse','HEAD'])).toString().trim(),index=await this.git(record.path,['diff','--cached','--binary','--no-ext-diff','--no-textconv','HEAD','--']),manifest=await scanCheckout(record.path);
          const archive=await createArchive(record.path,path.join(this.directory,'worktree-archives'),head,index,manifest);archive.ref='refs/workbench/archive/'+record.id;
          await this.git(record.repositoryRoot,['update-ref',archive.ref,head]);record.archive=archive;delete record.archiveError;await this.save();
          await this.validate(record);
          if((await scanCheckout(record.path)).digest!==manifest.digest||(await this.git(record.path,['rev-parse','HEAD'])).toString().trim()!==head||!(await this.git(record.path,['diff','--cached','--binary','--no-ext-diff','--no-textconv','HEAD','--'])).equals(index))throw Error('WORKTREE_CHANGED_DURING_ARCHIVE');
          if(protectedNow(record.id))continue;
          await this.git(record.repositoryRoot,['worktree','remove','--force',record.path]);record.status='archived';record.head=head;await this.save();archived.push(record.id);
        }catch(error){const code=error instanceof Error&&/^WORKTREE_[A-Z_]+$/.test(error.message)?error.message:'WORKTREE_ARCHIVE_FAILED';record.archiveError=code;failed.push({id:record.id,code});await this.save();}
      }return {archived,failed};
    }finally{this.busy=false;}
  }
  async restore(id:string):Promise<WorktreeRecord>{
    await this.load();if(this.busy)throw Error('WORKTREE_BUSY');const record=this.saved.records.find(r=>r.id===id);if(!record?.archive)throw Error('WORKTREE_ARCHIVE_NOT_FOUND');this.busy=true;
    try{
      try{await lstat(record.path);throw Error('WORKTREE_RESTORE_TARGET_EXISTS');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      const archived=await readArchive(record.archive);
      await this.git(record.repositoryRoot,['worktree','add','--detach','--no-checkout',record.path,record.archive.head]);
      record.status='failed';await this.save();
      await this.git(record.path,['read-tree',record.archive.head]);if(archived.index.length)await this.git(record.path,['apply','--cached','--binary','--whitespace=nowarn','-'],archived.index);
      await readArchive(record.archive,await realpath(record.path));
      if((await scanCheckout(record.path)).digest!==archived.manifest.digest||!(await this.git(record.path,['diff','--cached','--binary','--no-ext-diff','--no-textconv','HEAD','--'])).equals(archived.index))throw Error('WORKTREE_RESTORE_VERIFICATION_FAILED');
      record.status='ready';record.head=record.archive.head;record.lastUsedAt=new Date().toISOString();delete record.archiveError;await this.save();return {...record};
    }finally{this.busy=false;}
  }
}
