import * as fs from "fs";
import * as path from "path";
import * as tls from "tls";

export interface XDraftAttachment {
  filePath: string;
  filename?: string;
}

export interface XDraftMail {
  to: string;
  from: string;
  subject: string;
  text: string;
  attachments: XDraftAttachment[];
}

export interface SmtpOptions {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
}

function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

function chunkBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function escapeBoundaryValue(value: string): string {
  return value.replace(/"/g, "'");
}

export function isXDraftMailEnabled(env: NodeJS.ProcessEnv): boolean {
  return !!(env.X_DRAFT_EMAIL_TO && env.SMTP_USER && env.SMTP_PASS);
}

export function buildXDraftMail(mail: XDraftMail): string {
  const boundary = `x-draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const lines = [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    mail.text,
  ];

  for (const attachment of mail.attachments) {
    const filename = escapeBoundaryValue(attachment.filename ?? path.basename(attachment.filePath));
    const content = fs.readFileSync(attachment.filePath).toString("base64");
    lines.push(
      `--${boundary}`,
      "Content-Type: image/jpeg",
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      chunkBase64(content),
    );
  }

  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

function readResponse(socket: tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1);
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function expect(socket: tls.TLSSocket, code: number): Promise<void> {
  const response = await readResponse(socket);
  if (!response.startsWith(String(code))) {
    throw new Error(`SMTP expected ${code}, got ${response.trim()}`);
  }
}

async function command(socket: tls.TLSSocket, text: string, code: number): Promise<void> {
  socket.write(`${text}\r\n`);
  await expect(socket, code);
}

function dotStuff(message: string): string {
  return message.replace(/^\./gm, "..");
}

export async function sendXDraftMail(mail: XDraftMail, options: SmtpOptions = {}): Promise<void> {
  const host = options.host ?? process.env.SMTP_HOST ?? "smtp.gmail.com";
  const port = options.port ?? Number(process.env.SMTP_PORT ?? 465);
  const user = options.user ?? process.env.SMTP_USER ?? "";
  const pass = options.pass ?? process.env.SMTP_PASS ?? "";
  if (!user || !pass) throw new Error("SMTP_USER and SMTP_PASS are required");

  const socket = tls.connect({ host, port, servername: host });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });
    await expect(socket, 220);
    await command(socket, `EHLO ${host}`, 250);
    await command(socket, "AUTH LOGIN", 334);
    await command(socket, Buffer.from(user).toString("base64"), 334);
    await command(socket, Buffer.from(pass).toString("base64"), 235);
    await command(socket, `MAIL FROM:<${mail.from}>`, 250);
    await command(socket, `RCPT TO:<${mail.to}>`, 250);
    await command(socket, "DATA", 354);
    socket.write(`${dotStuff(buildXDraftMail(mail))}\r\n.\r\n`);
    await expect(socket, 250);
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
  }
}
