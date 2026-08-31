import React, { useCallback, useState } from 'react';

// A temporary password, on screen for the only time it will ever be readable.
//
// The server returns it in the response that creates or reissues it and stores only a
// hash, so there is no endpoint that reads it back. Somebody who closes this without
// copying it has to issue another one. That is why the warning is a warning and not a
// footnote, and why the value is selectable text rather than a masked field.

export default function TempPasswordNotice({ tempPassword }: { tempPassword: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      window.setTimeout(() => { setCopied(false); }, 2000);
    } catch {
      // A blocked or absent clipboard is not a failure worth a message: the password
      // is already on screen and selectable, which is the fallback.
    }
  }, [tempPassword]);

  return (
    <div className="temp-password">
      <div className="temp-password-label">Temporary password</div>
      <div className="temp-password-row">
        <code className="temp-password-value">{tempPassword}</code>
        <button type="button" className="btn-ghost" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="temp-password-warning" role="alert">
        Write this down now. It is shown once and nothing can read it back. If it is
        lost, an administrator issues another one.
      </p>
    </div>
  );
}
