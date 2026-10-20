/**
 * 统一错误码。前端按 code 分支，不解析 message。
 */
const E = {
  OK: 0,
  BAD_PARAM: 40001,
  UNAUTH: 40101,
  FORBIDDEN: 40300,
  NO_QUOTA: 40301,
  ALREADY_VOTED: 40302,
  SELF_VOTE: 40303,
  NOT_ADMIN: 40304,
  NOT_FOUND: 40401,
  EXPIRED: 40901,
  RATE_LIMIT: 42901,
  CONTENT_REJECTED: 45101,
  INTERNAL: 50000
};

class AppError extends Error {
  constructor(code, message, extra) {
    super(message || '服务异常');
    this.name = 'AppError';
    this.code = code || E.INTERNAL;
    this.extra = extra || null;
  }
}

module.exports = { E, AppError };
