/** Payload của Access Token (JWT) */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  sid: string;
}

/** Người dùng đã xác thực, được JwtAuthGuard gắn vào request.user */
export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
  session_id: string;
}

/** Thông tin thiết bị lấy từ request (không nhận từ body) */
export interface ClientContext {
  ip: string | null;
  userAgent: string | null;
}
