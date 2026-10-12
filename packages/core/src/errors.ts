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
    message = 'The outcome of the operation in the external system could not be verified. Review it before running it again.',
  ) {
    super(message);
  }
}
export const requireAdmin = (role: string | null) => {
  if (role !== 'admin')
    throw new HttpError(
      403,
      'ADMIN_REQUIRED',
      'This action requires business administrator permission.',
    );
};
