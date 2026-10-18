export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = "ログインが必要です") => new HttpError(401, m);
export const notFound = (m = "見つかりません") => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);
export const tooMany = (m = "操作が速すぎます。少し待ってから再度お試しください") => new HttpError(429, m);
