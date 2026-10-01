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
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new InstallerForm());
    }
}

internal sealed class InstallerForm : Form
{
    private const string BaseUrl = "https://co-operative-mu.vercel.app";
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

        _detail.Text = "This installer runs per-user and does not require administrator access.";
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
        _dashboard.Click += (_, _) => OpenUrl($"{BaseUrl}/unison/dashboard");

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
            var pairingCode = await ReceiveBrowserPairingAsync();

            SetStatus(
                "Installing Unison…",
                "Installing the worker and preserving your per-device credential. PowerShell stays hidden in the background."
            );

            await RunBootstrapAsync(pairingCode);

            SetStatus(
                "Starting local AI runtime…",
                "The worker is installed. Waiting for CoOperative to verify a fresh heartbeat from this PC."
            );

            await WaitForRealHeartbeatAsync();

            SetStatus(
                "Connected",
                "This PC is online in Unison. It will only accept new work after the configured Windows idle period."
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

        OpenUrl(link);

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

    private async Task RunBootstrapAsync(string pairingCode)
    {
        var bootstrap = Path.Combine(Path.GetTempPath(), "cooperative-unison-bootstrap.ps1");

        using (var http = new HttpClient())
        {
            var bytes = await http.GetByteArrayAsync($"{BaseUrl}/api/unison/download/windows");
            await File.WriteAllBytesAsync(bootstrap, bytes);
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
        start.ArgumentList.Add(bootstrap);
        start.ArgumentList.Add("-PairCode");
        start.ArgumentList.Add(pairingCode);
        start.ArgumentList.Add("-NodeName");
        start.ArgumentList.Add(Environment.MachineName);
        start.ArgumentList.Add("-IdleMinutes");
        start.ArgumentList.Add("5");

        using var process = Process.Start(start) ??
            throw new InvalidOperationException("Could not start the Unison bootstrap.");

        var outputTask = process.StandardOutput.ReadToEndAsync();
        var errorTask = process.StandardError.ReadToEndAsync();

        await process.WaitForExitAsync();

        var output = await outputTask;
        var error = await errorTask;
        await File.AppendAllTextAsync(
            _logPath,
            $"[{DateTimeOffset.Now:u}] Bootstrap exit {process.ExitCode}\r\n{output}\r\n{error}\r\n"
        );

        if (process.ExitCode != 0)
        {
            var detail = LastNonEmptyLine(error) ?? LastNonEmptyLine(output) ?? $"Exit code {process.ExitCode}";
            throw new InvalidOperationException($"Worker installation failed: {detail}");
        }
    }

    private async Task WaitForRealHeartbeatAsync()
    {
        var nodeId = Environment.GetEnvironmentVariable("UNISON_NODE_ID", EnvironmentVariableTarget.User);
        var nodeToken = Environment.GetEnvironmentVariable("UNISON_NODE_TOKEN", EnvironmentVariableTarget.User);

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

                    if (workerVersion.StartsWith("startup-failed-", StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidOperationException("The local worker reported a startup failure.");
                    }

                    if (fresh &&
                        !workerVersion.Equals("paired", StringComparison.OrdinalIgnoreCase) &&
                        !workerVersion.StartsWith("starting-", StringComparison.OrdinalIgnoreCase))
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

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

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
