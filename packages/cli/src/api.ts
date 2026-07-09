import type { SubmissionPayload } from "@shibaita/schema";

/**
 * ★fetch使用はこのファイルのみ。他のパッケージ・ファイルからネットワーク通信を行ってはならない。
 */

/**
 * `http://` でのローカル開発を許可する例外ホスト(ポート付き可)。
 * それ以外は必ず `https://` でなければならない(平文通信での送信データ漏えいを防ぐ)。
 */
const HTTP_LOCALHOST_EXCEPTIONS = ["localhost", "127.0.0.1"];

function isAllowedHttpLocalhost(url: URL): boolean {
  return url.protocol === "http:" && HTTP_LOCALHOST_EXCEPTIONS.includes(url.hostname);
}

/**
 * 環境変数 `SHIBAITA_API_URL` からAPI URLを決定する。
 * `https://` 以外は拒否する。例外として `http://localhost` と `http://127.0.0.1`
 * (ポート付き可)のみ許可する(ローカル開発向け)。
 * 不正なURLが指定された場合はエラーを投げてプロセスを止める(平文送信の防止)。
 */
export function getApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SHIBAITA_API_URL;
  const url = raw && raw.trim().length > 0 ? raw.trim() : "https://shibaita.ai";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`SHIBAITA_API_URL が不正なURLです: ${url}`);
  }

  if (parsed.protocol !== "https:" && !isAllowedHttpLocalhost(parsed)) {
    throw new Error(
      `SHIBAITA_API_URL は https:// で指定してください(http:// が許されるのは localhost / 127.0.0.1 のみです): ${url}`,
    );
  }

  return url;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface PairClaimResponse {
  deviceToken: string;
}

/** POST {api}/api/v1/pairing/claim {code} -> {deviceToken} */
export async function claimPairing(code: string, apiUrl: string): Promise<PairClaimResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/v1/pairing/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  } catch (error) {
    throw new ApiError(`通信に失敗しました: ${(error as Error).message}`);
  }

  if (!response.ok) {
    throw new ApiError(`ペアリングに失敗しました (HTTP ${response.status})`, response.status);
  }

  const data = (await response.json()) as PairClaimResponse;
  if (!data || typeof data.deviceToken !== "string") {
    throw new ApiError("サーバーからの応答が不正です");
  }
  return data;
}

export interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
}

/** POST {api}/api/v1/device/start -> {deviceCode, userCode, verificationUrl} */
export async function startDeviceFlow(apiUrl: string): Promise<DeviceStartResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/v1/device/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    throw new ApiError(`通信に失敗しました: ${(error as Error).message}`);
  }

  if (!response.ok) {
    throw new ApiError(`連携の開始に失敗しました (HTTP ${response.status})`, response.status);
  }

  const data = (await response.json()) as Partial<DeviceStartResponse> | null;
  if (
    !data ||
    typeof data.deviceCode !== "string" ||
    typeof data.userCode !== "string" ||
    typeof data.verificationUrl !== "string"
  ) {
    throw new ApiError("サーバーからの応答が不正です");
  }
  return data as DeviceStartResponse;
}

export type DevicePollStatus = "pending" | "approved" | "expired";

export interface DevicePollResponse {
  status: DevicePollStatus;
  deviceToken?: string;
}

/**
 * POST {api}/api/v1/device/poll {deviceCode} -> {status, deviceToken?}
 * サーバは200(pending/approved)と410(expired)のいずれも正常系の応答として返す。
 */
export async function pollDeviceFlow(
  deviceCode: string,
  apiUrl: string,
): Promise<DevicePollResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/v1/device/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });
  } catch (error) {
    throw new ApiError(`通信に失敗しました: ${(error as Error).message}`);
  }

  if (response.status !== 200 && response.status !== 410) {
    throw new ApiError(`ポーリングに失敗しました (HTTP ${response.status})`, response.status);
  }

  const data = (await response.json()) as Partial<DevicePollResponse> | null;
  if (data?.status !== "pending" && data?.status !== "approved" && data?.status !== "expired") {
    throw new ApiError("サーバーからの応答が不正です");
  }
  if (data.status === "approved" && typeof data.deviceToken !== "string") {
    throw new ApiError("サーバーからの応答が不正です");
  }

  return data as DevicePollResponse;
}

export interface SubmitResponse {
  accepted: number;
  rejected: unknown[];
  profileUrl?: string;
}

/** POST {api}/api/v1/submissions (Bearer) */
export async function submitUsage(
  payload: SubmissionPayload,
  deviceToken: string,
  apiUrl: string,
): Promise<SubmitResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/v1/submissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new ApiError(`通信に失敗しました: ${(error as Error).message}`);
  }

  if (!response.ok) {
    throw new ApiError(`送信に失敗しました (HTTP ${response.status})`, response.status);
  }

  return (await response.json()) as SubmitResponse;
}
