import { spawn } from "node:child_process";
import { AppError } from "../utils/errors.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function runProcess(binary: string, args: string[], timeoutMs = 120_000): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const limit = 1024 * 1024;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-limit);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-limit);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new AppError(`Unable to start ${binary}`, "binary_not_found", undefined, { cause: error }));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(new AppError(`${binary} exited with code ${code}: ${stderr.slice(-1000)}`, "media_process_failed"));
      else resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}
