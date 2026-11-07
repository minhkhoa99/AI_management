import { execFile } from 'node:child_process';
import { ConflictError } from '../errors/app-error';
import type { AppLogger } from '../logging/app-logger';
import type { DirectoryPicker } from './directory-picker';

const DIALOG_TITLE = 'Chọn thư mục làm việc cho AI Team';
/** Below Node's 5-minute request timeout, so the HTTP request always gets an answer. */
const DIALOG_TIMEOUT_MS = 4 * 60 * 1000;

interface DialogCommand {
  executable: string;
  args: string[];
}

/** Each OS's own folder dialog; no shell, fixed arguments, the dialog title is a constant. */
function buildDialogCommand(platform: NodeJS.Platform): DialogCommand {
  switch (platform) {
    case 'win32':
      return {
        executable: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-Command',
          [
            '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
            'Add-Type -AssemblyName System.Windows.Forms',
            '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }',
            '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
            `$dialog.Description = '${DIALOG_TITLE}'`,
            '$dialog.ShowNewFolderButton = $true',
            'if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
          ].join('; '),
        ],
      };
    case 'darwin':
      return {
        executable: 'osascript',
        args: ['-e', `POSIX path of (choose folder with prompt "${DIALOG_TITLE}")`],
      };
    default:
      return {
        executable: 'zenity',
        args: ['--file-selection', '--directory', `--title=${DIALOG_TITLE}`],
      };
  }
}

export class NativeDirectoryPicker implements DirectoryPicker {
  constructor(private readonly logger: AppLogger) {}

  pickDirectory(): Promise<string | null> {
    const command = buildDialogCommand(process.platform);
    return new Promise((resolve, reject) => {
      execFile(
        command.executable,
        command.args,
        { timeout: DIALOG_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
        (error, stdout) => {
          if (error === null) {
            const picked = stdout.trim();
            resolve(picked === '' ? null : picked);
            return;
          }
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(
              new ConflictError(
                process.platform === 'linux'
                  ? 'Không mở được hộp chọn thư mục: cần cài zenity (sudo apt install zenity).'
                  : 'Không mở được hộp chọn thư mục trên máy này.',
                { code: 'DIRECTORY_PICKER_UNAVAILABLE', cause: error },
              ),
            );
            return;
          }
          // Cancelling the dialog exits with a non-zero code on macOS and Linux; a timeout too.
          this.logger.debug({ err: error }, 'directory dialog closed without a folder');
          resolve(null);
        },
      );
    });
  }
}
