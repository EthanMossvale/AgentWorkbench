using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Windows.Forms;

internal sealed class FixtureHttp : HttpMessageHandler {
    internal readonly byte[] Package = new byte[131072];
    internal string Mode = "success";
    internal readonly TaskCompletionSource<bool> Started = new TaskCompletionSource<bool>();
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
        Started.TrySetResult(true);
        if (Mode == "wait") await Task.Delay(-1,token);
        if (Mode == "http") return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        if (request.RequestUri.AbsolutePath.EndsWith(".json")) {
            string digest; using (var hash = SHA512.Create()) digest=Convert.ToBase64String(hash.ComputeHash(Mode=="checksum"?new byte[2]:Package));
            var data=new Dictionary<string,object> {{"file","1.2.3.exe"},{"size",Package.Length},{"sha512",digest}};
            return new HttpResponseMessage(HttpStatusCode.OK) { Content=new StringContent(new JavaScriptSerializer().Serialize(data)) };
        }
        return new HttpResponseMessage(HttpStatusCode.OK) { Content=new ByteArrayContent(Package) };
    }
}
internal static class BootstrapProbe {
    static void Check(bool condition,string message) {if(!condition)throw new Exception(message);}
    [STAThread] static void Main() {
        Run().GetAwaiter().GetResult();
        // Construct the actual form without showing it. Verify both close event paths.
        foreach(bool started in new[]{false,true}) using(var form=(Form)Activator.CreateInstance(typeof(Bootstrap),true)) using(var cancellation=new CancellationTokenSource()) {
            Action<string,object> set=(name,value)=>typeof(Bootstrap).GetField(name,BindingFlags.Instance|BindingFlags.NonPublic).SetValue(form,value);
            set("working",true);set("cancellation",cancellation);set("installerStarted",started);
            var args=new FormClosingEventArgs(CloseReason.UserClosing,false);
            typeof(Form).GetMethod("OnFormClosing",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(form,new object[]{args});
            Check(args.Cancel&&!form.Visible,"The cleanup owner must remain hidden until work settles");
            Check((bool)typeof(Bootstrap).GetField("closing",BindingFlags.Instance|BindingFlags.NonPublic).GetValue(form),"Close request not recorded");
            Check(cancellation.IsCancellationRequested==!started,"Close must cancel download but retain a started installer");
        }
        Console.WriteLine("PASS bootstrap close ownership, transfer cancellation, launch completion, HTTP/checksum diagnostics and redaction");
    }
    static async Task Run() {
        string root=Path.Combine(Path.GetTempPath(),"awb-bootstrap-probe-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        try {
            foreach(string mode in new[]{"success","wait","http","checksum"}) {
                string directory=Path.Combine(root,mode);Directory.CreateDirectory(directory);
                using(var handler=new FixtureHttp {Mode=mode}) using(var client=new HttpClient(handler)) using(var cancellation=new CancellationTokenSource()) {
                    int launches=0;var launchStarted=new TaskCompletionSource<bool>();var finish=new TaskCompletionSource<bool>();
                    var task=BootstrapTransfer.Run(client,"https://example.invalid/",directory,cancellation.Token,(stage,percent)=>{},async target=>{
                        launches++;Check(new FileInfo(target).Length==handler.Package.Length,"Launch bytes changed");launchStarted.SetResult(true);await finish.Task;
                    });
                    if(mode=="success") {await launchStarted.Task;cancellation.Cancel();Check(!task.IsCompleted,"Started installer must remain owned");finish.SetResult(true);await task;Check(launches==1,"One launch required");}
                    else if(mode=="wait") {await handler.Started.Task;cancellation.Cancel();try{await task;throw new Exception("Cancelled request completed");}catch(OperationCanceledException){}Check(launches==0,"Cancelled request launched");}
                    else {try{await task;throw new Exception("Expected failure");}catch(Exception error){string detail=BootstrapTransfer.Diagnostic(error);Check(detail.Contains(mode=="http"?"503":"Checksum mismatch"),"Useful error lost");}Check(launches==0,"Failed request launched");}
                }
            }
            string redacted=BootstrapTransfer.Diagnostic(new Exception("DNS failure; access_token=fixture-secret; Bearer another-secret"));
            Check(redacted.Contains("DNS failure")&&!redacted.Contains("fixture-secret")&&!redacted.Contains("another-secret"),"Diagnostic values were not redacted");
        } finally {Directory.Delete(root,true);}
    }
}
