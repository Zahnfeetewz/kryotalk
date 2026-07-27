const CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789_';
const CHARSET_SIZE = CHARSET.length;

// Erlaubte Zeichen für Benutzernamen: Buchstaben, Zahlen, Unterstrich
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

const RARITY_TIERS = [
  { maxLength: 1, key: 'legendary', label: 'Legendär' },
  { maxLength: 2, key: 'epic', label: 'Episch' },
  { maxLength: 3, key: 'rare', label: 'Selten' },
  { maxLength: 5, key: 'uncommon', label: 'Ungewöhnlich' },
  { maxLength: Infinity, key: 'common', label: 'Gewöhnlich' },
];

function getRarityForLength(length) {
  return RARITY_TIERS.find((tier) => length <= tier.maxLength);
}

// Wie viele Namen dieser Länge sind theoretisch möglich (a-z0-9_)
function maxPossibleForLength(length) {
  return Math.pow(CHARSET_SIZE, length);
}

function validateUsernameFormat(username) {
  if (!username || username.length < 1 || username.length > 20) {
    return { ok: false, reason: 'Benutzername muss zwischen 1 und 20 Zeichen lang sein.' };
  }
  if (!USERNAME_REGEX.test(username)) {
    return { ok: false, reason: 'Nur Buchstaben, Zahlen und Unterstrich sind erlaubt.' };
  }
  return { ok: true };
}

// existingUsernames: Array aller bereits vergebenen Namen (für Verfügbarkeits-Check)
function checkAvailability(username, existingUsernames) {
  const length = username.length;
  const takenOfSameLength = existingUsernames.filter((u) => u.length === length).length;
  const max = maxPossibleForLength(length);
  const remaining = Math.max(max - takenOfSameLength, 0);
  return { length, takenOfSameLength, max, remaining };
}

module.exports = {
  getRarityForLength,
  maxPossibleForLength,
  validateUsernameFormat,
  checkAvailability,
  RARITY_TIERS,
};
