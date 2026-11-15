// ssh2-sftp-client is a CJS default export
import SftpClientDefault from "ssh2-sftp-client";
import { config } from "../../../../config.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SftpClient = (SftpClientDefault as any).default ?? SftpClientDefault;

export interface SkyJanaSftpConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  inboundPath: string; // Path on SFTP where Sky Jana drops files (GRN, invoices)
  outboundPath: string; // Path on SFTP where we upload PO acknowledgements
}

export function getSkyJanaSftpConfig(): SkyJanaSftpConfig {
  const cfg = config();
  const host = cfg.SKY_JANA_SFTP_HOST;
  const username = cfg.SKY_JANA_SFTP_USER;
  if (!host || !username) {
    throw new Error("SKY_JANA_SFTP_HOST and SKY_JANA_SFTP_USER env vars are required");
  }
  return {
    host,
    port: cfg.SKY_JANA_SFTP_PORT,
    username,
    password: cfg.SKY_JANA_SFTP_PASSWORD,
    privateKey: cfg.SKY_JANA_SFTP_PRIVATE_KEY,
    inboundPath: cfg.SKY_JANA_SFTP_INBOUND_PATH,
    outboundPath: cfg.SKY_JANA_SFTP_OUTBOUND_PATH
  };
}

export class SkyJanaSftpClientWrapper {
  private sftp: InstanceType<typeof SftpClient>;

  constructor(private readonly config: SkyJanaSftpConfig) {
    this.sftp = new SftpClient();
  }

  async connect(): Promise<void> {
    await this.sftp.connect({
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      password: this.config.password,
      privateKey: this.config.privateKey
    });
  }

  async disconnect(): Promise<void> {
    await this.sftp.end();
  }

  /** Lists inbound files. Default pattern matches .txt and .saf (SAF flat files). */
  async listInboundFiles(pattern?: RegExp): Promise<string[]> {
    const list: Array<{ type: string; name: string }> = await this.sftp.list(
      this.config.inboundPath
    );
    const files = list
      .filter((f: { type: string }) => f.type === "-")
      .map((f: { name: string }) => f.name);
    if (pattern) {
      return files.filter((name) => pattern.test(name));
    }
    return files;
  }

  async downloadFile(filename: string): Promise<string> {
    const remotePath = `${this.config.inboundPath}/${filename}`;
    const buffer = await this.sftp.get(remotePath);
    return buffer.toString("utf-8");
  }

  async uploadFile(filename: string, content: string): Promise<void> {
    const remotePath = `${this.config.outboundPath}/${filename}`;
    await this.sftp.put(Buffer.from(content, "utf-8"), remotePath);
  }

  async archiveFile(filename: string): Promise<void> {
    const remotePath = `${this.config.inboundPath}/${filename}`;
    const archivePath = `${this.config.inboundPath}/processed/${filename}`;
    try {
      await this.sftp.rename(remotePath, archivePath);
    } catch {
      // If archive dir doesn't exist, just delete the file
      await this.sftp.delete(remotePath);
    }
  }
}
