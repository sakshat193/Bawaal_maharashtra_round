export function turnstileOptions(sitekey, onToken) {
  const clearToken = () => onToken('');
  return {
    sitekey,
    action: 'enter',
    callback: token => onToken(token),
    'expired-callback': clearToken,
    'error-callback': clearToken
  };
}
