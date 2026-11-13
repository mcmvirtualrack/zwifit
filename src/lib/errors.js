// An error whose code, message and details are safe to send to clients.
class AppError extends Error {
	constructor(code, message, details) {
		super(message);
		this.name = 'AppError';
		this.code = code;
		if (details !== undefined) {
			this.details = details;
		}
	}
}

module.exports = { AppError };
