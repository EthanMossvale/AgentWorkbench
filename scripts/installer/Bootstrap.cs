using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Threading.Tasks;

// Stable online bootstrap. Application packages and profiles have separate owners.
internal sealed class Bootstrap : Form {
    const string Feed = "https://ethanmossvale.github.io/AgentWorkbench/updates/";
    readonly Label label = new Label { Dock = DockStyle.Top, Height = 65, Text = "正在获取最新版本…", Padding = new Padding(18) };
    readonly ProgressBar progress = new ProgressBar { Dock = DockStyle.Top, Height = 20 };
    readonly Button retry = new Button { Dock = DockStyle.Bottom, Text = "重试", Visible = false };
    bool working;
    [STAThread] static void Main() { ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12; Application.EnableVisualStyles(); Application.Run(new Bootstrap()); }
    Bootstrap() {
        Text = "安装 AgentWorkbench"; ClientSize = new System.Drawing.Size(410,145);
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(retry); Controls.Add(progress); Controls.Add(label);
        Shown += async (sender,e) => await Install(); retry.Click += async (sender,e) => await Install();
        FormClosing += (sender,e) => { if (working) e.Cancel = true; };
    }
    async Task Install() {
        if (working) return; working = true; retry.Visible = false;
        string stage = "获取更新清单";
        string directory = Path.Combine(Path.GetTempPath(), "AgentWorkbench-" + Guid.NewGuid().ToString("N"));
        try {
            Directory.CreateDirectory(directory);
            using (var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })) {
                client.Timeout = TimeSpan.FromMinutes(20); client.DefaultRequestHeaders.UserAgent.ParseAdd("AgentWorkbench-Installer/1.0");
                string json = await client.GetStringAsync(Feed + "bootstrap.json");
                if (json.Length > 16384) throw new Exception("Manifest too large");
                var item = new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(json);
                string name = (string)item["file"], expected = (string)item["sha512"];
                long size = Convert.ToInt64(item["size"]);
                if (!System.Text.RegularExpressions.Regex.IsMatch(name, @"\AAgentWorkbench-[0-9]+\.[0-9]+\.[0-9]+-x64-setup\.exe\z") || size < 1 || size > 800L*1024*1024 || Convert.FromBase64String(expected).Length != 64) throw new Exception("Invalid manifest");
                string target = Path.Combine(directory,name);
                stage = "下载安装包";
                label.Text = "正在下载最新版 AgentWorkbench…";
                using (var response = await client.GetAsync(Feed + name,HttpCompletionOption.ResponseHeadersRead)) {
                    response.EnsureSuccessStatusCode();
                    using (var input = await response.Content.ReadAsStreamAsync())
                    using (var output = new FileStream(target,FileMode.CreateNew,FileAccess.Write,FileShare.None,65536,true)) {
                        byte[] buffer = new byte[65536]; long received = 0; int count;
                        while ((count = await input.ReadAsync(buffer,0,buffer.Length)) != 0) {
                            received += count; if (received > size) throw new Exception("Invalid package size");
                            await output.WriteAsync(buffer,0,count); progress.Value = (int)(received*100/size);
                        }
                        if (received != size) throw new Exception("Incomplete download");
                    }
                }
                stage = "校验安装包"; label.Text = "正在校验安装包…";
                using (var input = File.OpenRead(target)) using (var hash = SHA512.Create())
                    if (Convert.ToBase64String(hash.ComputeHash(input)) != expected) throw new Exception("Checksum mismatch");
                stage = "运行安装程序"; label.Text = "请选择安装位置并完成安装…";
                using (var process = Process.Start(new ProcessStartInfo(target) { UseShellExecute = true })) {
                    if (process == null) throw new Exception("Installer did not start");
                    await Task.Run(() => process.WaitForExit()); if (process.ExitCode != 0) throw new Exception("Installer failed");
                }
            }
            working = false; Close();
        } catch { label.Text = stage + "失败。请检查连接或系统提示后重试；已有用户数据未删除。"; retry.Visible = true; }
        finally { working = false; try { Directory.Delete(directory,true); } catch {} }
    }
}
