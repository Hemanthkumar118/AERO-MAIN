/**
 * AERO Emergency Platform — Enterprise Email Validation & Sanitization Utility
 *
 * Implements RFC 5322 syntax validation, length constraints, MX/domain heuristics,
 * bounce-prevention guards against reserved/fictitious domains, and common typo detection.
 */

// RFC 5322 compliant email regex pattern
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// RFC 2606 reserved and non-routable domains that always fail or bounce
const RESERVED_TEST_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'test.org',
  'invalid',
  'localhost',
  'fake.com',
  'sample.com',
]);

// Fictitious demo/placeholder domains that lack active MX records and trigger 550 bounces
const FICTITIOUS_PLACEHOLDER_DOMAINS = new Set([
  'ems.gov.in',
  'police.gov.in',
  'hospital.org',
  'aero.city.gov',
  'emergency.gov.in',
  'traffic.gov.in',
]);

// Common domain typos mapped to their intended providers
const COMMON_TYPOS: Record<string, string> = {
  'gamil.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmaik.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmaill.com': 'hotmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'outllok.com': 'outlook.com',
  'icoud.com': 'icloud.com',
};

export interface EmailValidationResult {
  isValid: boolean;
  normalizedEmail: string;
  error?: string;
  warning?: string;
  suggestion?: string;
}

export interface EmailValidationOptions {
  checkDeliverability?: boolean;
}

/**
 * Validates, normalizes, and checks an email address.
 * When checkDeliverability is true (default), blocks reserved/fictitious domains that cause bounce warnings.
 * When checkDeliverability is false (used during login), allows all syntactically valid emails to attempt sign-in.
 */
export function validateEmailAddress(
  rawEmail: string,
  options: EmailValidationOptions = { checkDeliverability: true }
): EmailValidationResult {
  if (!rawEmail || typeof rawEmail !== 'string') {
    return {
      isValid: false,
      normalizedEmail: '',
      error: 'Email address is required.',
    };
  }

  // 1. Normalization: strip leading/trailing whitespace and lowercase
  const normalized = rawEmail.trim().toLowerCase();

  if (normalized.length === 0) {
    return {
      isValid: false,
      normalizedEmail: '',
      error: 'Email address cannot be empty.',
    };
  }

  // 2. Total length check (RFC 5321: maximum 254 characters)
  if (normalized.length > 254) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email address exceeds maximum length of 254 characters.',
    };
  }

  // 3. Reject leading, trailing, or double dots
  if (normalized.startsWith('.') || normalized.endsWith('.') || normalized.includes('..')) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email address contains invalid dot placement.',
    };
  }

  // 4. Split into local part and domain
  const parts = normalized.split('@');
  if (parts.length !== 2) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email address must contain exactly one "@" symbol.',
    };
  }

  const [localPart, domainPart] = parts;

  // 5. Local part checks (RFC 5321: maximum 64 characters)
  if (localPart.length === 0) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email username cannot be empty.',
    };
  }

  if (localPart.length > 64) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email username exceeds maximum length of 64 characters.',
    };
  }

  // 6. Domain part checks
  if (domainPart.length < 3) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email domain is incomplete.',
    };
  }

  if (!domainPart.includes('.')) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email domain must contain a valid top-level domain (e.g., .com, .in).',
    };
  }

  const domainParts = domainPart.split('.');
  const tld = domainParts[domainParts.length - 1];

  // TLD must be at least 2 alpha characters
  if (!tld || tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: `Invalid top-level domain ".${tld}". Top-level domains must contain letters only.`,
    };
  }

  // 7. General RFC 5322 regex test
  if (!EMAIL_REGEX.test(normalized)) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email address format is invalid.',
    };
  }

  // 8. Prevent hard-bouncing reserved and test domains (only when deliverability checks are requested)
  if (options.checkDeliverability !== false) {
    if (RESERVED_TEST_DOMAINS.has(domainPart)) {
      return {
        isValid: false,
        normalizedEmail: normalized,
        error: `"${domainPart}" is a reserved test domain and cannot receive transactional emails. Please use a real email address.`,
      };
    }

    // 9. Prevent hard-bouncing fictitious UI placeholders
    if (FICTITIOUS_PLACEHOLDER_DOMAINS.has(domainPart)) {
      return {
        isValid: false,
        normalizedEmail: normalized,
        error: `"${domainPart}" is a sample demo domain without active mail servers. Please enter your genuine operator or department email to receive verification.`,
      };
    }
  }

  // 10. Check for common domain typos
  let suggestion: string | undefined;
  if (COMMON_TYPOS[domainPart]) {
    const correctedDomain = COMMON_TYPOS[domainPart];
    suggestion = `${localPart}@${correctedDomain}`;
  }

  return {
    isValid: true,
    normalizedEmail: normalized,
    suggestion,
    warning: suggestion ? `Did you mean ${suggestion}?` : undefined,
  };
}
