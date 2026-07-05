import type { SubmissionPayload } from "@shibaita/schema";

/**
 * ★fetch使用はこのファイルのみ。他のパッケージ・ファイルからネットワーク通信を行ってはならない。
 */

export function getApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.SHIBAITA_API_URL;
  return url && url.trim().length > 0 ? url : "https://shibaita.ai";
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
