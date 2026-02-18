const REDACTION_PATTERNS: RegExp[] = [
  // Anthropic API keys
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  // OpenAI API keys
  /sk-[a-zA-Z0-9]{48}/g,
  // GitHub tokens
  /ghp_[a-zA-Z0-9]{36}/g,
  /ghu_[a-zA-Z0-9]{36}/g,
  /ghs_[a-zA-Z0-9]{36}/g,
  // AWS access keys
  /AKIA[0-9A-Z]{16}/g,
  // Generic password/secret/token/key patterns
  /(?:password|secret|token|key)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  // Environment variable assignments with secrets
  /(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY)\s*=\s*\S+/gi,
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of REDACTION_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}
