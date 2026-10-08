// An error whose message is written for the user. Anything else is shown
// as an unexpected failure.
export class AppError extends Error {
  /**
   * @param {string} message Shown to the user as is.
   * @param {unknown} [cause] The underlying error, for the console.
   */
  constructor(message, cause) {
    super(message, { cause });
  }
}
