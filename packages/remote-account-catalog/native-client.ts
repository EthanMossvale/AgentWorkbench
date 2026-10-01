/** A fixed local Unix socket; only public metadata and native session control. */
export const NATIVE_OWNER_CLIENT=String.raw`
import json,os,socket,stat,struct
def native_owner_request(request):
    parent='/run/agent-workbench-accounts';endpoint=parent+'/broker.sock'
    base=os.lstat('/run');directory=os.lstat(parent);entry=os.lstat(endpoint)
    if not stat.S_ISDIR(base.st_mode) or base.st_uid!=0 or base.st_mode&0o022:raise ValueError()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid==0 or directory.st_mode&0o022:raise ValueError()
    if not stat.S_ISSOCK(entry.st_mode) or entry.st_uid!=directory.st_uid:raise ValueError()
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(90);connection.connect(endpoint)
        if struct.unpack('3i',connection.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))[1]!=directory.st_uid:raise ValueError()
        connection.sendall((json.dumps(request,separators=(',',':'))+'\n').encode())
        raw=connection.makefile('rb').readline(1048577)
        if len(raw)>1048576:raise ValueError()
        response=json.loads(raw)
        if not isinstance(response,dict):raise ValueError()
        return response
`;
