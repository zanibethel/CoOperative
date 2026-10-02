using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CoOperative.Unison.Installer;

internal static class Program
{
    internal const string BaseUrl = "https://co-operative-mu.vercel.app";
    internal const string LocalChatUrl = "http://127.0.0.1:11436/";

    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        if (args.Any(arg => arg.Equals("--dashboard", StringComparison.OrdinalIgnoreCase)))
        {
            OpenUrl($"{BaseUrl}/unison/dashboard");
            return;
        }

        if (args.Any(arg => arg.Equals("--local-chat", StringComparison.OrdinalIgnoreCase)))
        {
            OpenUrl(LocalChatUrl);
            return;
        }

        if (args.Any(arg => arg.Equals("--tray", StringComparison.OrdinalIgnoreCase)))
        {
            using var mutex = new Mutex(true, "CoOperative.Unison.TrayAgent", out var createdNew);
            if (!createdNew) return;
            Application.Run(new UnisonTrayContext());
            return;
        }

        Application.Run(new InstallerForm());
    }

    internal static bool MachineWideConfigured =>
        !string.IsNullOrWhiteSpace(
            Environment.GetEnvironmentVariable("UNISON_NODE_ID", EnvironmentVariableTarget.Machine)
        );

    internal static EnvironmentVariableTarget NodeEnvironmentTarget =>
        MachineWideConfigured ? EnvironmentVariableTarget.Machine : EnvironmentVariableTarget.User;

    internal static string WorkerInstallDir =>
        MachineWideConfigured
            ? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "CoOperative",
                "Unison"
            )
            : Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CoOperative",
                "Unison"
            );

    internal static string? ReadNodeEnvironment(string name)
    {
        if (MachineWideConfigured)
        {
            return Environment.GetEnvironmentVariable(name, EnvironmentVariableTarget.Machine);
        }
        return Environment.GetEnvironmentVariable(name, EnvironmentVariableTarget.User);
    }

    internal static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
}

internal sealed class UnisonTrayContext : ApplicationContext
{
    private readonly NotifyIcon _notifyIcon = new();
    private readonly ToolStripMenuItem _statusItem;
    private readonly System.Windows.Forms.Timer _timer;
    private readonly string _shellDir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CoOperative", "Unison");
    private readonly string _workerDir = Program.WorkerInstallDir;
    private bool _refreshing;

    public UnisonTrayContext()
    {
        var iconPath = Path.Combine(_shellDir, "unison.ico");
        if (!File.Exists(iconPath))
        {
            Directory.CreateDirectory(_shellDir);
            InstallerForm.CreateUnisonIcon(iconPath);
        }

        _statusItem = new ToolStripMenuItem("Status: checking…") { Enabled = false };

        var menu = new ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Open CoOperativeLocalAI", null, (_, _) => Program.OpenUrl(Program.LocalChatUrl));
        menu.Items.Add("Open dashboard", null, (_, _) => Program.OpenUrl($"{Program.BaseUrl}/unison/dashboard"));
        menu.Items.Add("Restart node", null, (_, _) => RunControl("restart"));
        menu.Items.Add("Repair connection", null, (_, _) => RunControl("repair"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit tray", null, (_, _) =>
        {
            _notifyIcon.Visible = false;
            ExitThread();
        });

        _notifyIcon.Icon = new Icon(iconPath);
        _notifyIcon.Text = "CoOperative Unison";
        _notifyIcon.Visible = true;
        _notifyIcon.ContextMenuStrip = menu;
        _notifyIcon.DoubleClick += (_, _) => Program.OpenUrl($"{Program.BaseUrl}/unison/dashboard");

        _timer = new System.Windows.Forms.Timer { Interval = 20_000 };
        _timer.Tick += async (_, _) => await RefreshStatusAsync();
        _timer.Start();

        _ = RefreshStatusAsync();
    }

    private async Task RefreshStatusAsync()
    {
        if (_refreshing) return;
        _refreshing = true;

        try
        {
            var nodeId = Program.ReadNodeEnvironment("UNISON_NODE_ID");
            var nodeToken = Program.ReadNodeEnvironment("UNISON_NODE_TOKEN");
            if (Program.MachineWideConfigured && string.IsNullOrWhiteSpace(nodeToken))
            {
                SetStatus("Machine-wide");
                return;
            }
            if (string.IsNullOrWhiteSpace(nodeId) || string.IsNullOrWhiteSpace(nodeToken))
            {
                SetStatus("Not linked");
                return;
            }

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                $"{Program.BaseUrl}/api/unison/nodes/self-status"
            );
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", nodeToken);
            request.Content = new StringContent(
                JsonSerializer.Serialize(new { nodeId }),
                Encoding.UTF8,
                "application/json"
            );

            using var response = await http.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                SetStatus("Connection issue");
                return;
            }

            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var root = json.RootElement;
            var state = root.TryGetProperty("state", out var stateElement)
                ? stateElement.GetString() ?? "unknown"
                : "unknown";
            var workerVersion = root.TryGetProperty("workerVersion", out var versionElement)
                ? versionElement.GetString() ?? ""
                : "";

            if (workerVersion.StartsWith("starting-", StringComparison.OrdinalIgnoreCase))
            {
                SetStatus("Starting");
            }
            else if (workerVersion.StartsWith("startup-failed-", StringComparison.OrdinalIgnoreCase))
            {
                SetStatus("Error");
            }
            else
            {
                SetStatus(
                    string.IsNullOrWhiteSpace(state)
                        ? "Unknown"
                        : char.ToUpperInvariant(state[0]) + state[1..]
                );
            }
        }
        catch
        {
            SetStatus("Connection issue");
        }
        finally
        {
            _refreshing = false;
        }
    }

    private void SetStatus(string state)
    {
        if (_statusItem.Owner?.InvokeRequired == true)
        {
            _statusItem.Owner.Invoke(() => SetStatus(state));
            return;
        }

        _statusItem.Text = $"Status: {state}";
        _notifyIcon.Text = $"CoOperative Unison · {state}";
    }

    private void RunControl(string action)
    {
        var control = Path.Combine(_workerDir, "control-unison-windows.ps1");
        if (!File.Exists(control))
        {
            MessageBox.Show(
                "The Unison control helper is missing. Open the dashboard and run Repair connection.",
                "CoOperative Unison",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning
            );
            return;
        }

        var start = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        start.ArgumentList.Add("-NoProfile");
        start.ArgumentList.Add("-ExecutionPolicy");
        start.ArgumentList.Add("Bypass");
        start.ArgumentList.Add("-File");
        start.ArgumentList.Add(control);
        start.ArgumentList.Add(action);
        Process.Start(start);
    }

    protected override void ExitThreadCore()
    {
        _timer.Stop();
        _timer.Dispose();
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        base.ExitThreadCore();
    }
}

internal sealed class InstallerForm : Form
{
    private const string BaseUrl = Program.BaseUrl;
    private readonly Label _status = new();
    private readonly Label _detail = new();
    private readonly ProgressBar _progress = new();
    private readonly Button _dashboard = new();
    private readonly Button _close = new();
    private readonly string _installDir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CoOperative", "Unison");
    private string _logPath = "";

    public InstallerForm()
    {
        Text = "CoOperative Unison Setup";
        Width = 620;
        Height = 360;
        MinimumSize = new Size(620, 360);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(13, 23, 35);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10);

        var title = new Label
        {
            Text = "UNISON",
            Font = new Font("Segoe UI Semibold", 25, FontStyle.Bold),
            AutoSize = true,
            Left = 34,
            Top = 28,
        };

        var subtitle = new Label
        {
            Text = "CoOperative community compute",
            ForeColor = Color.FromArgb(158, 180, 199),
            AutoSize = true,
            Left = 37,
            Top = 72,
        };

        _status.Text = "Preparing secure setup…";
        _status.Font = new Font("Segoe UI Semibold", 16, FontStyle.Bold);
        _status.AutoSize = true;
        _status.Left = 37;
        _status.Top = 125;

        _detail.Text = "New installs run machine-wide. Windows will request one administrator approval after you link the contributor account.";
        _detail.ForeColor = Color.FromArgb(181, 198, 213);
        _detail.AutoSize = false;
        _detail.Width = 530;
        _detail.Height = 56;
        _detail.Left = 37;
        _detail.Top = 164;

        _progress.Left = 37;
        _progress.Top = 223;
        _progress.Width = 530;
        _progress.Height = 18;
        _progress.Style = ProgressBarStyle.Marquee;
        _progress.MarqueeAnimationSpeed = 28;

        _dashboard.Text = "Open dashboard";
        _dashboard.Left = 37;
        _dashboard.Top = 265;
        _dashboard.Width = 145;
        _dashboard.Height = 36;
        _dashboard.Visible = false;
        _dashboard.Click += (_, _) => Program.OpenUrl($"{BaseUrl}/unison/dashboard");

        _close.Text = "Close";
        _close.Left = 194;
        _close.Top = 265;
        _close.Width = 110;
        _close.Height = 36;
        _close.Visible = false;
        _close.Click += (_, _) => Close();

        Controls.AddRange([title, subtitle, _status, _detail, _progress, _dashboard, _close]);

        Shown += async (_, _) => await RunInstallAsync();
    }

    private void SetStatus(string status, string detail)
    {
        if (InvokeRequired)
        {
            Invoke(() => SetStatus(status, detail));
            return;
        }

        _status.Text = status;
        _detail.Text = detail;
    }

    private void CompleteUi()
    {
        if (InvokeRequired)
        {
            Invoke(CompleteUi);
            return;
        }

        _progress.Style = ProgressBarStyle.Blocks;
        _progress.Value = 100;
        _dashboard.Visible = true;
        _close.Visible = true;
    }

    private async Task RunInstallAsync()
    {
        Directory.CreateDirectory(_installDir);
        _logPath = Path.Combine(_installDir, "installer.log");

        try
        {
            var machineNodeId = Environment.GetEnvironmentVariable(
                "UNISON_NODE_ID",
                EnvironmentVariableTarget.Machine
            );
            var existingMachineWide = !string.IsNullOrWhiteSpace(machineNodeId);

            if (existingMachineWide)
            {
                SetStatus(
                    "Existing machine-wide Unison node found",
                    "Refreshing the shared worker while preserving this PC's node identity."
                );

                await RunExistingRepairAsync(machineNodeId!, true);

                var machineShellNote = await InstallShellIntegrationAsync();
                SetStatus(
                    "Repaired and connected",
                    "This machine-wide Unison node kept its identity and runs independently of Windows profiles. " +
                    "CoOperativeLocalAI, desktop, Start Menu, and tray integration are ready." +
                    machineShellNote
                );
                CompleteUi();
                return;
            }

            var userNodeId = Environment.GetEnvironmentVariable(
                "UNISON_NODE_ID",
                EnvironmentVariableTarget.User
            );
            var userNodeToken = Environment.GetEnvironmentVariable(
                "UNISON_NODE_TOKEN",
                EnvironmentVariableTarget.User
            );
            var hasLegacyNode =
                !string.IsNullOrWhiteSpace(userNodeId) &&
                !string.IsNullOrWhiteSpace(userNodeToken);

            if (hasLegacyNode)
            {
                SetStatus(
                    "Existing legacy Unison node found",
                    "Checking this profile's current preview node before changing anything."
                );

                var healthy = await HasFreshRealHeartbeatAsync(userNodeId!, userNodeToken!);
                if (!healthy)
                {
                    SetStatus(
                        "Repairing existing Unison node…",
                        "The saved node identity will be preserved while the worker files and startup path are refreshed."
                    );
                    await RunExistingRepairAsync(userNodeId!, false);
                    await WaitForRealHeartbeatAsync(false);
                }

                var legacyShellNote = await InstallShellIntegrationAsync();
                SetStatus(
                    healthy ? "Updated" : "Repaired and connected",
                    "This legacy per-profile Unison node kept its identity. Desktop, Start Menu, and tray integration are ready." +
                    legacyShellNote
                );
                CompleteUi();
                return;
            }

            var pairingCode = await ReceiveBrowserPairingAsync();

            SetStatus(
                "Installing machine-wide Unison…",
                "Windows will request administrator approval. The compute worker will run for the whole PC, not just this Windows profile."
            );

            await RunBootstrapAsync(pairingCode);

            SetStatus(
                "Machine-wide local AI verified",
                "The elevated installer confirmed a fresh whole-PC-idle-capable heartbeat from this PC."
            );

            var shellNote = await InstallShellIntegrationAsync();

            SetStatus(
                "Connected",
                "This PC is online as a machine-wide Unison node. CoOperativeLocalAI is available while the PC is in use; contributed work only starts after every signed-in Windows session has been idle for the configured period." +
                shellNote
            );
            CompleteUi();
        }
        catch (Exception ex)
        {
            await File.AppendAllTextAsync(
                _logPath,
                $"[{DateTimeOffset.Now:u}] SETUP ERROR: {ex}\r\n"
            );

            SetStatus(
                "Setup needs attention",
                $"{ex.Message}\r\n\r\nLog: {_logPath}"
            );
            CompleteUi();
        }
    }

    private async Task<string> ReceiveBrowserPairingAsync()
    {
        SetStatus(
            "Linking your CoOperative account…",
            "Your browser will open so you can authorize this Windows PC. No pairing code needs to be copied."
        );

        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
        var link =
            $"{BaseUrl}/unison/install/connect?port={port}&nonce={Uri.EscapeDataString(nonce)}";

        Program.OpenUrl(link);

        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(10));

        while (!timeout.IsCancellationRequested)
        {
            using var client = await listener.AcceptTcpClientAsync(timeout.Token);
            using var stream = client.GetStream();

            var request = await ReadHttpRequestAsync(stream, timeout.Token);

            if (request.Method == "OPTIONS")
            {
                await WriteHttpResponseAsync(stream, 204, "{}", timeout.Token);
                continue;
            }

            if (request.Method != "POST")
            {
                await WriteHttpResponseAsync(stream, 405, "{\"error\":\"Method not allowed\"}", timeout.Token);
                continue;
            }

            try
            {
                using var document = JsonDocument.Parse(request.Body);
                var root = document.RootElement;
                var receivedNonce = root.GetProperty("nonce").GetString() ?? "";
                var pairingCode = root.GetProperty("pairingCode").GetString() ?? "";

                if (!string.Equals(receivedNonce, nonce, StringComparison.Ordinal) ||
                    pairingCode.Length < 8)
                {
                    await WriteHttpResponseAsync(stream, 403, "{\"error\":\"Invalid authorization\"}", timeout.Token);
                    continue;
                }

                await WriteHttpResponseAsync(stream, 200, "{\"ok\":true}", timeout.Token);
                listener.Stop();
                return pairingCode;
            }
            catch
            {
                await WriteHttpResponseAsync(stream, 400, "{\"error\":\"Invalid request\"}", timeout.Token);
            }
        }

        throw new TimeoutException("Browser authorization timed out. Reopen setup and try again.");
    }

    private async Task<bool> HasFreshRealHeartbeatAsync(
        string nodeId,
        string nodeToken
    )
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"{BaseUrl}/api/unison/nodes/self-status"
        );
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", nodeToken);
        request.Content = new StringContent(
            JsonSerializer.Serialize(new { nodeId }),
            Encoding.UTF8,
            "application/json"
        );

        try
        {
            using var response = await http.SendAsync(request);
            if (!response.IsSuccessStatusCode) return false;

            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var root = json.RootElement;
            var workerVersion =
                root.TryGetProperty("workerVersion", out var versionElement)
                    ? versionElement.GetString() ?? ""
                    : "";
            var fresh =
                root.TryGetProperty("fresh", out var freshElement) &&
                freshElement.ValueKind == JsonValueKind.True;

            var capabilities =
                root.TryGetProperty("capabilities", out var capabilitiesElement) &&
                capabilitiesElement.ValueKind == JsonValueKind.Array
                    ? capabilitiesElement
                        .EnumerateArray()
                        .Where(item => item.ValueKind == JsonValueKind.String)
                        .Select(item => item.GetString() ?? "")
                        .ToArray()
                    : [];

            var hasWindowsText =
                capabilities.Contains("text_generation", StringComparer.OrdinalIgnoreCase);
            var currentWindowsRuntime =
                workerVersion.StartsWith("windows-unison-0.9.", StringComparison.OrdinalIgnoreCase) ||
                workerVersion.StartsWith("windows-unison-1.", StringComparison.OrdinalIgnoreCase);

            return fresh &&
                !workerVersion.Equals("paired", StringComparison.OrdinalIgnoreCase) &&
                !workerVersion.StartsWith("starting-", StringComparison.OrdinalIgnoreCase) &&
                !workerVersion.StartsWith("startup-failed-", StringComparison.OrdinalIgnoreCase) &&
                hasWindowsText &&
                currentWindowsRuntime;
        }
        catch
        {
            return false;
        }
    }

    private async Task RunExistingRepairAsync(string expectedNodeId, bool machineWide)
    {
        var repairName = machineWide
            ? "repair-unison-windows-machine.ps1"
            : "repair-unison-windows.ps1";
        var repair = Path.Combine(Path.GetTempPath(), $"cooperative-{repairName}");
        using (var http = new HttpClient())
        {
            var bytes = await http.GetByteArrayAsync(
                $"https://raw.githubusercontent.com/zanibethel/CoOperative/main/workers/{repairName}"
            );
            await File.WriteAllBytesAsync(repair, bytes);
        }

        if (machineWide)
        {
            var arguments =
                $"-NoProfile -ExecutionPolicy Bypass -File \"{repair}\" -ExpectedNodeId \"{expectedNodeId}\"";
            var elevated = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                UseShellExecute = true,
                Verb = "runas",
                Arguments = arguments,
                WindowStyle = ProcessWindowStyle.Normal,
            };

            using var process = Process.Start(elevated)
                ?? throw new InvalidOperationException("Could not start the machine-wide Unison repair.");
            await process.WaitForExitAsync();
            await File.AppendAllTextAsync(
                _logPath,
                $"[{DateTimeOffset.Now:u}] Machine-wide repair exit {process.ExitCode}\r\n"
            );

            if (process.ExitCode != 0)
            {
                throw new InvalidOperationException(
                    $"Machine-wide Unison repair failed with exit code {process.ExitCode}."
                );
            }
            return;
        }

        var start = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add("-NoProfile");
        start.ArgumentList.Add("-ExecutionPolicy");
        start.ArgumentList.Add("Bypass");
        start.ArgumentList.Add("-File");
        start.ArgumentList.Add(repair);
        start.ArgumentList.Add("-ExpectedNodeId");
        start.ArgumentList.Add(expectedNodeId);

        using var legacyProcess = Process.Start(start)
            ?? throw new InvalidOperationException("Could not start the Unison repair.");

        var outputTask = legacyProcess.StandardOutput.ReadToEndAsync();
        var errorTask = legacyProcess.StandardError.ReadToEndAsync();
        await legacyProcess.WaitForExitAsync();

        var output = await outputTask;
        var error = await errorTask;
        await File.AppendAllTextAsync(
            _logPath,
            $"[{DateTimeOffset.Now:u}] Existing-node repair exit {legacyProcess.ExitCode}\r\n{output}\r\n{error}\r\n"
        );

        if (legacyProcess.ExitCode != 0)
        {
            var detail =
                LastNonEmptyLine(error) ??
                LastNonEmptyLine(output) ??
                $"Exit code {legacyProcess.ExitCode}";
            throw new InvalidOperationException($"Existing-node repair failed: {detail}");
        }
    }

    private async Task RunBootstrapAsync(string pairingCode)
    {
        var bootstrap = Path.Combine(Path.GetTempPath(), "cooperative-unison-machine-bootstrap.ps1");

        using (var http = new HttpClient())
        {
            var bytes = await http.GetByteArrayAsync(
                "https://raw.githubusercontent.com/zanibethel/CoOperative/main/workers/bootstrap-unison-windows-machine.ps1"
            );
            await File.WriteAllBytesAsync(bootstrap, bytes);
        }

        var arguments =
            $"-NoProfile -ExecutionPolicy Bypass -File \"{bootstrap}\" -PairCode \"{pairingCode}\" -NodeName \"{Environment.MachineName}\" -IdleMinutes 5";
        var start = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = true,
            Verb = "runas",
            Arguments = arguments,
            WindowStyle = ProcessWindowStyle.Normal,
        };

        using var process = Process.Start(start)
            ?? throw new InvalidOperationException("Could not start machine-wide Unison setup.");

        await process.WaitForExitAsync();
        await File.AppendAllTextAsync(
            _logPath,
            $"[{DateTimeOffset.Now:u}] Machine-wide bootstrap exit {process.ExitCode}\r\n"
        );

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"Machine-wide worker installation failed with exit code {process.ExitCode}."
            );
        }
    }

    private async Task WaitForRealHeartbeatAsync(bool machineWide)
    {
        var target = machineWide
            ? EnvironmentVariableTarget.Machine
            : EnvironmentVariableTarget.User;
        var nodeId = Environment.GetEnvironmentVariable("UNISON_NODE_ID", target);
        var nodeToken = Environment.GetEnvironmentVariable("UNISON_NODE_TOKEN", target);

        if (string.IsNullOrWhiteSpace(nodeId) || string.IsNullOrWhiteSpace(nodeToken))
        {
            throw new InvalidOperationException("Installation completed without a readable node credential.");
        }

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(12));

        while (!timeout.IsCancellationRequested)
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                $"{BaseUrl}/api/unison/nodes/self-status"
            );
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", nodeToken);
            request.Content = new StringContent(
                JsonSerializer.Serialize(new { nodeId }),
                Encoding.UTF8,
                "application/json"
            );

            try
            {
                using var response = await http.SendAsync(request, timeout.Token);
                if (response.IsSuccessStatusCode)
                {
                    using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
                    var root = json.RootElement;
                    var workerVersion =
                        root.TryGetProperty("workerVersion", out var versionElement)
                            ? versionElement.GetString() ?? ""
                            : "";
                    var fresh =
                        root.TryGetProperty("fresh", out var freshElement) &&
                        freshElement.ValueKind == JsonValueKind.True;

                    var capabilities =
                        root.TryGetProperty("capabilities", out var capabilitiesElement) &&
                        capabilitiesElement.ValueKind == JsonValueKind.Array
                            ? capabilitiesElement
                                .EnumerateArray()
                                .Where(item => item.ValueKind == JsonValueKind.String)
                                .Select(item => item.GetString() ?? "")
                                .ToArray()
                            : [];

                    if (workerVersion.StartsWith("startup-failed-", StringComparison.OrdinalIgnoreCase))
                    {
                        var startupError = capabilities
                            .FirstOrDefault(item => item.StartsWith("startup_error:", StringComparison.OrdinalIgnoreCase));
                        var detail = startupError is null
                            ? "The local worker reported a startup failure."
                            : "The local worker reported a startup failure: " +
                                startupError["startup_error:".Length..];
                        throw new InvalidOperationException(detail);
                    }

                    var hasWindowsText = capabilities.Contains(
                        "text_generation",
                        StringComparer.OrdinalIgnoreCase
                    );
                    var currentWindowsRuntime =
                        workerVersion.StartsWith("windows-unison-0.9.", StringComparison.OrdinalIgnoreCase) ||
                        workerVersion.StartsWith("windows-unison-1.", StringComparison.OrdinalIgnoreCase);
                    var hasMachineWideCapability =
                        capabilities.Contains("machine_wide", StringComparer.OrdinalIgnoreCase) &&
                        capabilities.Contains("whole_pc_idle", StringComparer.OrdinalIgnoreCase);

                    if (fresh &&
                        !workerVersion.Equals("paired", StringComparison.OrdinalIgnoreCase) &&
                        !workerVersion.StartsWith("starting-", StringComparison.OrdinalIgnoreCase) &&
                        hasWindowsText &&
                        currentWindowsRuntime &&
                        (!machineWide || hasMachineWideCapability))
                    {
                        return;
                    }

                    if (workerVersion.StartsWith("starting-", StringComparison.OrdinalIgnoreCase))
                    {
                        SetStatus(
                            "Preparing local AI runtime…",
                            "Python and AI dependencies are being prepared. CoOperative is receiving startup heartbeats from this PC."
                        );
                    }
                }
            }
            catch (HttpRequestException)
            {
                // The worker may still be finishing local setup. Retry until timeout.
            }

            await Task.Delay(TimeSpan.FromSeconds(4), timeout.Token);
        }

        throw new TimeoutException("The worker installed, but CoOperative did not receive a real heartbeat in time.");
    }

    private async Task<string> InstallShellIntegrationAsync()
    {
        try
        {
            var sourceExe = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(sourceExe) || !File.Exists(sourceExe))
            {
                throw new InvalidOperationException("Could not locate the running installer executable.");
            }

            var installedExe = Path.Combine(_installDir, "CoOperative-Unison.exe");
            if (!Path.GetFullPath(sourceExe).Equals(
                    Path.GetFullPath(installedExe),
                    StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(sourceExe, installedExe, overwrite: true);
            }

            var iconPath = Path.Combine(_installDir, "unison.ico");
            CreateUnisonIcon(iconPath);

            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            CreateShortcut(
                Path.Combine(desktop, "CoOperative Unison.lnk"),
                installedExe,
                "--dashboard",
                "Open your CoOperative Unison dashboard",
                iconPath
            );
            CreateShortcut(
                Path.Combine(desktop, "CoOperativeLocalAI.lnk"),
                installedExe,
                "--local-chat",
                "Open CoOperativeLocalAI on this PC",
                iconPath
            );

            var programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            var startMenuDir = Path.Combine(programs, "CoOperative");
            Directory.CreateDirectory(startMenuDir);
            CreateShortcut(
                Path.Combine(startMenuDir, "CoOperative Unison.lnk"),
                installedExe,
                "--dashboard",
                "Open your CoOperative Unison dashboard",
                iconPath
            );
            CreateShortcut(
                Path.Combine(startMenuDir, "CoOperativeLocalAI.lnk"),
                installedExe,
                "--local-chat",
                "Open CoOperativeLocalAI on this PC",
                iconPath
            );

            var startup = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
            CreateShortcut(
                Path.Combine(startup, "CoOperative Unison Tray.lnk"),
                installedExe,
                "--tray",
                "Start the CoOperative Unison tray controller",
                iconPath
            );

            Process.Start(new ProcessStartInfo
            {
                FileName = installedExe,
                Arguments = "--tray",
                UseShellExecute = true,
                WorkingDirectory = _installDir,
            });

            await File.AppendAllTextAsync(
                _logPath,
                $"[{DateTimeOffset.Now:u}] CoOperativeLocalAI + dashboard desktop/start-menu shortcuts and tray controller installed.\r\n"
            );

            return " Desktop shortcuts for Unison and CoOperativeLocalAI plus the tray controller are installed.";
        }
        catch (Exception ex)
        {
            await File.AppendAllTextAsync(
                _logPath,
                $"[{DateTimeOffset.Now:u}] SHELL INTEGRATION WARNING: {ex}\r\n"
            );
            return " The node is connected, but Windows shortcut/tray setup needs repair.";
        }
    }

    private static void CreateShortcut(
        string shortcutPath,
        string targetPath,
        string arguments,
        string description,
        string iconPath
    )
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell")
            ?? throw new InvalidOperationException("Windows shortcut service is unavailable.");
        dynamic shell = Activator.CreateInstance(shellType)
            ?? throw new InvalidOperationException("Could not create Windows shortcut service.");
        dynamic shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath = targetPath;
        shortcut.Arguments = arguments;
        shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
        shortcut.Description = description;
        shortcut.IconLocation = iconPath;
        shortcut.Save();
    }

    internal static void CreateUnisonIcon(string iconPath)
    {
        using var bitmap = new Bitmap(64, 64);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        graphics.Clear(Color.Transparent);

        using var outer = new Pen(Color.FromArgb(31, 218, 255), 7);
        using var inner = new Pen(Color.FromArgb(118, 239, 255), 3);
        graphics.DrawEllipse(outer, 8, 8, 48, 48);
        graphics.DrawArc(inner, 18, 17, 28, 30, 18, 144);
        graphics.DrawArc(inner, 18, 17, 28, 30, 198, 144);

        using var font = new Font("Segoe UI Semibold", 20, FontStyle.Bold, GraphicsUnit.Pixel);
        using var brush = new SolidBrush(Color.White);
        var text = "U";
        var size = graphics.MeasureString(text, font);
        graphics.DrawString(text, font, brush, 32 - size.Width / 2, 32 - size.Height / 2 - 1);

        var handle = bitmap.GetHicon();
        try
        {
            using var icon = Icon.FromHandle(handle);
            using var stream = File.Create(iconPath);
            icon.Save(stream);
        }
        finally
        {
            DestroyIcon(handle);
        }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr handle);

    private static string? LastNonEmptyLine(string value)
    {
        return value
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .LastOrDefault(line => line.Length > 0);
    }

    private static async Task<HttpRequest> ReadHttpRequestAsync(
        NetworkStream stream,
        CancellationToken cancellationToken
    )
    {
        var buffer = new byte[16 * 1024];
        var collected = new MemoryStream();
        var headerEnd = -1;

        while (headerEnd < 0 && collected.Length < 64 * 1024)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken);
            if (read <= 0) break;
            collected.Write(buffer, 0, read);
            var data = collected.ToArray();
            headerEnd = FindSequence(data, "\r\n\r\n"u8.ToArray());
        }

        if (headerEnd < 0)
        {
            throw new InvalidOperationException("Incomplete browser authorization request.");
        }

        var all = collected.ToArray();
        var headerText = Encoding.ASCII.GetString(all, 0, headerEnd);
        var lines = headerText.Split("\r\n");
        var requestLine = lines[0].Split(' ');
        var method = requestLine.Length > 0 ? requestLine[0].ToUpperInvariant() : "";

        var contentLength = 0;
        foreach (var line in lines.Skip(1))
        {
            var colon = line.IndexOf(':');
            if (colon <= 0) continue;
            var name = line[..colon].Trim();
            var value = line[(colon + 1)..].Trim();
            if (name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
            {
                _ = int.TryParse(value, out contentLength);
            }
        }

        var bodyOffset = headerEnd + 4;
        while (all.Length - bodyOffset < contentLength)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken);
            if (read <= 0) break;
            collected.Write(buffer, 0, read);
            all = collected.ToArray();
        }

        var bodyLength = Math.Min(contentLength, Math.Max(0, all.Length - bodyOffset));
        var body = bodyLength > 0
            ? Encoding.UTF8.GetString(all, bodyOffset, bodyLength)
            : "";

        return new HttpRequest(method, body);
    }

    private static async Task WriteHttpResponseAsync(
        NetworkStream stream,
        int status,
        string body,
        CancellationToken cancellationToken
    )
    {
        var statusText = status switch
        {
            200 => "OK",
            204 => "No Content",
            400 => "Bad Request",
            403 => "Forbidden",
            405 => "Method Not Allowed",
            _ => "Error",
        };

        var bodyBytes = Encoding.UTF8.GetBytes(body);
        var headers = new StringBuilder()
            .Append($"HTTP/1.1 {status} {statusText}\r\n")
            .Append("Access-Control-Allow-Origin: https://co-operative-mu.vercel.app\r\n")
            .Append("Access-Control-Allow-Methods: POST, OPTIONS\r\n")
            .Append("Access-Control-Allow-Headers: Content-Type\r\n")
            .Append("Access-Control-Allow-Private-Network: true\r\n")
            .Append("Cache-Control: no-store\r\n")
            .Append("Content-Type: application/json\r\n")
            .Append($"Content-Length: {(status == 204 ? 0 : bodyBytes.Length)}\r\n")
            .Append("Connection: close\r\n\r\n")
            .ToString();

        await stream.WriteAsync(Encoding.ASCII.GetBytes(headers), cancellationToken);
        if (status != 204)
        {
            await stream.WriteAsync(bodyBytes, cancellationToken);
        }
    }

    private static int FindSequence(byte[] haystack, byte[] needle)
    {
        for (var i = 0; i <= haystack.Length - needle.Length; i++)
        {
            var match = true;
            for (var j = 0; j < needle.Length; j++)
            {
                if (haystack[i + j] != needle[j])
                {
                    match = false;
                    break;
                }
            }

            if (match) return i;
        }

        return -1;
    }

    private sealed record HttpRequest(string Method, string Body);
}
