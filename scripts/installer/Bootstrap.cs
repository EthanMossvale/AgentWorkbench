using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;

// Stable online bootstrap. Application packages and profiles have separate owners.
internal sealed class Bootstrap : Form {
    const string Feed = "https://ethanmossvale.github.io/AgentWorkbench/updates/";
    readonly Label label = new Label { Dock = DockStyle.Top, Height = 65, Text = "正在获取最新版本…", Padding = new Padding(18) };
    readonly ProgressBar progress = new ProgressBar { Dock = DockStyle.Top, Height = 20 };
    readonly Button retry = new Button { Dock = DockStyle.Bottom, Text = "重试", Visible = false };
    readonly TextBox details = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Visible = false };
    CancellationTokenSource cancellation;
    bool working, closing, installerStarted;
    [STAThread] static void Main() { ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12; Application.EnableVisualStyles(); Application.Run(new Bootstrap()); }
    Bootstrap() {
        Text = "安装 AgentWorkbench"; ClientSize = new System.Drawing.Size(480,180);
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(details); Controls.Add(retry); Controls.Add(progress); Controls.Add(label);
        Shown += async (sender,e) => await Install(); retry.Click += async (sender,e) => await Install();
        FormClosing += (sender,e) => {
            if (!working) return;
            // Close the visible window immediately; keep its owner alive until cleanup finishes.
            e.Cancel = true; closing = true; Hide();
            if (!installerStarted) cancellation.Cancel();
        };
    }
    async Task Install() {
        if (working) return; working = true; closing = false; installerStarted = false;
        retry.Visible = false; details.Visible = false; progress.Value = 0;
        cancellation = new CancellationTokenSource();
        string stage = "获取更新清单";
        string directory = Path.Combine(Path.GetTempPath(), "AgentWorkbench-" + Guid.NewGuid().ToString("N"));
        try {
            Directory.CreateDirectory(directory);
            using (var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true })) {
                client.Timeout = System.Threading.Timeout.InfiniteTimeSpan; client.DefaultRequestHeaders.UserAgent.ParseAdd("AgentWorkbench-Installer/1.0");
                await BootstrapTransfer.Run(client, Feed, directory, cancellation.Token, (text,percent) => {
                    stage = text; if (!closing) { label.Text = text; progress.Value = percent; }
                }, async target => {
                    cancellation.Token.ThrowIfCancellationRequested();
                    using (var process = Process.Start(new ProcessStartInfo(target) { UseShellExecute = true })) {
                        if (process == null) throw new Exception("Installer did not start");
                        installerStarted = true;
                        label.Text = "安装程序已打开。可关闭此窗口，安装程序仍会继续运行。";
                        await Task.Run(() => process.WaitForExit());
                        if (process.ExitCode != 0) throw new Exception("Installer exited with code " + process.ExitCode);
                    }
                });
            }
            closing = true;
        } catch (OperationCanceledException error) {
            if (!closing) { label.Text = "下载已取消或超时，可重试。"; details.Text = stage + Environment.NewLine + BootstrapTransfer.Diagnostic(error); details.Visible = true; retry.Visible = true; ClientSize = new System.Drawing.Size(600,360); }
        } catch (Exception error) {
            string diagnostic = stage + Environment.NewLine + BootstrapTransfer.Diagnostic(error);
            if (!closing) {
                label.Text = "安装未完成。下方是具体原因，可选中复制后重试。";
                details.Text = diagnostic; details.Visible = true; retry.Visible = true; ClientSize = new System.Drawing.Size(600,360);
            } else if (!cancellation.IsCancellationRequested) {
                // A detached install can still fail. Keep a readable result after its owner closes.
                try { File.WriteAllText(Path.Combine(Path.GetTempPath(), "AgentWorkbench-install-error-" + Guid.NewGuid().ToString("N") + ".txt"), diagnostic); } catch { }
            }
        } finally {
            working = false; cancellation.Dispose();
            try { Directory.Delete(directory,true); } catch { }
            if (closing) Close();
        }
    }
}

// Production transfer entry: the form owns cancellation, launch and temporary cleanup.
internal static class BootstrapTransfer {
    internal static string Diagnostic(Exception error) {
        string text = error.ToString();
        text = Regex.Replace(text, @"(?i)\bBearer\s+[^\s""',;}]+", "Bearer [redacted]");
        text = Regex.Replace(text, @"(?i)((?:access_token|refresh_token|api_key|password|secret|cookie)\s*[=:]\s*)[^\s&;,]+", "$1[redacted]");
        return text;
    }
    internal static async Task Run(HttpClient client, string feed, string directory, CancellationToken token, Action<string,int> report, Func<string,Task> launch) {
        report("正在获取更新清单…", 0);
        string json;
        using (var response = await client.GetAsync(feed + "bootstrap-v2.json", token)) {
            response.EnsureSuccessStatusCode(); json = await response.Content.ReadAsStringAsync();
        }
        token.ThrowIfCancellationRequested();
        var item = new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(json);
        string name = (string)item["file"], expected = (string)item["sha512"];
        long size = Convert.ToInt64(item["size"]);
        if (!Regex.IsMatch(name, @"\A[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?\.exe\z") || size < 1 || Convert.FromBase64String(expected).Length != 64) throw new Exception("Invalid manifest");
        string target = Path.Combine(directory,name);
        report("正在下载安装包…（关闭窗口可取消下载）", 0);
        using (var response = await client.GetAsync(feed + name,HttpCompletionOption.ResponseHeadersRead,token)) {
            response.EnsureSuccessStatusCode();
            using (var input = await response.Content.ReadAsStreamAsync())
            using (var registration = token.Register(() => input.Dispose()))
            using (var output = new FileStream(target,FileMode.CreateNew,FileAccess.Write,FileShare.None,65536,true)) {
                byte[] buffer = new byte[65536]; long received = 0; int count;
                while ((count = await input.ReadAsync(buffer,0,buffer.Length,token)) != 0) {
                    received += count; if (received > size) throw new Exception("Invalid package size");
                    await output.WriteAsync(buffer,0,count,token); report("正在下载安装包…（关闭窗口可取消下载）", (int)(received*100/size));
                }
                if (received != size) throw new Exception("Incomplete download");
            }
        }
        token.ThrowIfCancellationRequested(); report("正在校验安装包…",100);
        string actual = await Task.Run(() => { using (var input = File.OpenRead(target)) using (var hash = SHA512.Create()) return Convert.ToBase64String(hash.ComputeHash(input)); });
        if (actual != expected) throw new Exception("Checksum mismatch");
        token.ThrowIfCancellationRequested(); report("正在启动安装程序…",100);
        await launch(target);
    }
}
