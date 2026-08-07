const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "admin123", "admin1234", "welcome1", "letmein1", "changeme",
  "iloveyou", "abc12345", "passw0rd", "p@ssw0rd", "admin@123", "byosemarket",
  "byose123", "administrator", "root1234", "default1"
]);

function hasSequentialChars(password) {
  const value = String(password || "").toLowerCase();
  if (value.length < 3) return false;
  const sequences = ["abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
  for (const sequence of sequences) {
    for (let index = 0; index <= sequence.length - 3; index += 1) {
      const forward = sequence.slice(index, index + 3);
      const reverse = forward.split("").reverse().join("");
      if (value.includes(forward) || value.includes(reverse)) return true;
    }
  }
  return false;
}

export function evaluatePasswordStrength(password, { currentPassword = "" } = {}) {
  const value = String(password || "");
  const checks = {
    length: value.length >= 10 && value.length <= 128,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
    number: /\d/.test(value),
    special: /[^A-Za-z0-9]/.test(value),
    notCommon: !COMMON_PASSWORDS.has(value.toLowerCase()),
    noRepeat: !/(.)\1{2,}/.test(value),
    noSequential: !hasSequentialChars(value),
    differentFromCurrent: !currentPassword || value !== String(currentPassword)
  };

  let score = 0;
  if (checks.length) score += 2;
  if (value.length >= 14) score += 1;
  if (checks.uppercase) score += 1;
  if (checks.lowercase) score += 1;
  if (checks.number) score += 1;
  if (checks.special) score += 2;
  if (checks.notCommon) score += 1;
  if (checks.noRepeat) score += 1;
  if (checks.noSequential) score += 1;

  let label = "Weak";
  if (score >= 10) label = "Very Strong";
  else if (score >= 8) label = "Strong";
  else if (score >= 5) label = "Medium";

  const errors = [];
  if (!checks.length) errors.push("Use 10–128 characters.");
  if (!checks.uppercase) errors.push("Add at least one uppercase letter.");
  if (!checks.lowercase) errors.push("Add at least one lowercase letter.");
  if (!checks.number) errors.push("Add at least one number.");
  if (!checks.special) errors.push("Add at least one special character.");
  if (!checks.notCommon) errors.push("Avoid common or blacklisted passwords.");
  if (!checks.noRepeat) errors.push("Avoid three or more repeated characters in a row.");
  if (!checks.noSequential) errors.push("Avoid sequential characters such as abc or 123.");
  if (!checks.differentFromCurrent) errors.push("New password must be different from the current password.");

  return {
    score,
    label,
    percent: Math.max(8, Math.min(100, Math.round((score / 11) * 100))),
    checks,
    errors,
    meetsPolicy: errors.length === 0 && (label === "Strong" || label === "Very Strong")
  };
}
