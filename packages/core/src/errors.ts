export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export class OutcomeUnknown extends Error {
  constructor(
    message = 'İşlemin dış sistemdeki sonucu doğrulanamadı. Yeniden çalıştırmadan önce inceleme gerekiyor.',
  ) {
    super(message);
  }
}
export const requireAdmin = (role: string | null) => {
  if (role !== 'admin')
    throw new HttpError(
      403,
      'ADMIN_REQUIRED',
      'Bu işlem için işletme yöneticisi yetkisi gerekiyor.',
    );
};
