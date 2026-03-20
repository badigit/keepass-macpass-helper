/* Shared OTP field resolution — used by both worker.js and popup (cmd/index.js).
 *
 * Globals required: `engine` (with .otp() and .asyncOTP()).
 * Optional callback `decryptSOTP` for encrypted OTP fields (popup-only). */

// eslint-disable-next-line no-unused-vars
const OTPResolve = {
  keys: {
    otp: ['KPH: otp', 'KPH:otp', 'otp', 'KPOTP'],
    sotp: ['KPH: sotp', 'KPH:sotp', 'sotp'],
    botp: ['TimeOtp-Secret-Base32']
  },

  _fields(entry) {
    return entry?.stringFields || entry?.StringFields || [];
  },

  _find(fields, keys) {
    return fields.find(f => keys.includes(f?.Key));
  },

  /** Check whether the entry has any OTP source. Returns Promise<boolean>. */
  includes(entry) {
    const fields = this._fields(entry);
    const has = [this.keys.otp, this.keys.sotp, this.keys.botp]
      .some(keys => fields.some(f => keys.includes(f?.Key)));

    if (has) return Promise.resolve(true);
    if (entry?.uuid) {
      return engine.asyncOTP(entry.uuid).then(v => v !== '');
    }
    return Promise.resolve(false);
  },

  /**
   * Resolve OTP value for entry.
   * @param {object} entry
   * @param {function} [decryptSOTP] — async fn(encryptedValue) => plainValue.
   *   Required only when sotp fields are present (popup context).
   * @returns {Promise<string>} OTP code or empty string.
   */
  async get(entry, decryptSOTP) {
    const fields = this._fields(entry);

    // Encrypted OTP (sotp) — popup only
    const sotp = this._find(fields, this.keys.sotp);
    if (sotp?.Value) {
      if (!decryptSOTP) return '';
      return engine.otp(await decryptSOTP(sotp.Value));
    }

    // Plain OTP
    const otp = this._find(fields, this.keys.otp);
    if (otp?.Value) {
      return engine.otp(otp.Value);
    }

    // Built-in KeePass OTP fields
    const secret = this._find(fields, this.keys.botp);
    if (secret?.Value) {
      const period = this._find(fields, ['TimeOtp-Period'])?.Value || 30;
      const digits = this._find(fields, ['TimeOtp-Length'])?.Value || 6;
      const args = new URLSearchParams();
      args.set('secret', secret.Value);
      args.set('period', period);
      args.set('digits', digits);
      return engine.otp(args.toString());
    }

    // KeePassXC built-in OTP via native messaging
    if (entry?.uuid) {
      const v = await engine.asyncOTP(entry.uuid);
      if (v) return v;
    }

    return '';
  }
};
